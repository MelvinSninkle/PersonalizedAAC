// GET /api/media?key=<pathname>[&w=<px>] — auth-gated proxy for private blobs.
// The client passes the bearer token; we stream the bytes back so <img>/<audio>
// elements can use a same-origin URL (after the client wraps the response in
// an object URL).
//
// ?w= asks for a resized copy (images only; audio ignores it). Requests snap
// UP to a fixed ladder so every image has at most |SIZES| cached variants;
// the resized webp is stored back to blob storage under thumbs/<w>/<key>.webp
// so each variant is built exactly once, ever. Resize is an OPTIMIZATION,
// never a gate: any failure (sharp unavailable, decode error, blob write
// refused) falls through to streaming the original bytes.
import { get, put } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key) {
    res.status(400).json({ error: 'key required' });
    return;
  }

  // PUBLIC shared-library prefixes — the ONLY unauthenticated media reads.
  // These hold generic default tile art, folder icons, and the pre-rendered
  // practice-board audio: effectively marketing material with no child data.
  // Everything else keeps the full auth + per-child ownership gate below.
  const PUBLIC_PREFIXES = ['taxonomy-defaults/', 'category-defaults/', 'style-defaults/', 'demo-audio/'];
  const isPublic = PUBLIC_PREFIXES.some((p) => key.startsWith(p)) && !key.includes('..');

  if (!isPublic) {
    const auth = await checkAuth(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

  // Ownership: a key found in any child-scoped table is private to those
  // children — the caller must have access to at least one (admins pass).
  // A key found nowhere is a shared library asset (taxonomy / style guides)
  // and any authenticated user may load it. One round-trip; on DB error we
  // fail OPEN (log + serve) so a hiccup never blanks the child's board.
  try {
    const db = sql();
    const owners = await db`
      SELECT DISTINCT child_id FROM (
        SELECT child_id FROM items WHERE image_key = ${key} OR sound_key = ${key}
        UNION ALL SELECT child_id FROM categories WHERE image_key = ${key}
        UNION ALL SELECT child_id FROM persons WHERE reference_key = ${key} OR voice_key = ${key}
        UNION ALL SELECT child_id FROM reference_images WHERE blob_key = ${key}
        UNION ALL SELECT child_id FROM pending_tiles WHERE source_key = ${key} OR image_key = ${key} OR sound_key = ${key}
        UNION ALL SELECT child_id FROM item_image_history WHERE blob_key = ${key}
        UNION ALL SELECT child_id FROM tile_jobs WHERE source_key = ${key} OR image_key = ${key} OR sound_key = ${key}
      ) t WHERE child_id IS NOT NULL LIMIT 20`;
    if (owners.length) {
      let allowed = false;
      for (const o of owners) {
        if (await canAccessChild(auth.user, o.child_id, db)) { allowed = true; break; }
      }
      if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return; }
    }
  } catch (err) {
    console.error('media ownership check failed:', String(err.message || err));
  }
  }

  // Cache policy. Private blob keys are IMMUTABLE — every write path mints a
  // fresh `${kind}/${uuid}` key (tile regenerate = new key, old one goes to
  // item_image_history) and the TTS cache is content-addressed — so browsers
  // may keep them for a year and never revalidate. The public shared-library
  // prefixes stay on the shorter policy because two of them (demo-audio
  // regenerates, default-art republish) can rewrite content behind a key.
  const privateCache = 'private, max-age=31536000, immutable';
  const publicCache = 'public, s-maxage=86400, max-age=3600';

  // ── Resized variant (?w=) ─────────────────────────────────────────────────
  const wReq = parseInt(String(req.query.w || ''), 10);
  const SIZES = [256, 640, 1024];
  const wantW = Number.isFinite(wReq) && wReq > 0 ? (SIZES.find((s) => s >= wReq) || 1024) : 0;
  if (wantW && /\.(png|jpe?g|webp)$/i.test(key)) {
    const variantKey = `thumbs/${wantW}/${key}.webp`;
    // The variant inherits the ORIGINAL key's access decision (already made
    // above) — clients never pass thumbs/ keys directly, and thumbs/ is not a
    // public prefix, so the only road to these bytes runs through this check.
    const variantCache = isPublic ? 'public, s-maxage=31536000, max-age=31536000, immutable' : privateCache;
    try {
      const v = await get(variantKey, { access: 'private' });
      if (v.statusCode === 200 && v.stream) {
        res.setHeader('Content-Type', 'image/webp');
        if (v.blob.size) res.setHeader('Content-Length', v.blob.size);
        res.setHeader('Cache-Control', variantCache);
        await pipeOut(v.stream, res);
        return;
      }
    } catch (_) { /* not built yet — build it below */ }
    try {
      const orig = await get(key, { access: 'private' });
      if (orig.statusCode === 200 && orig.stream) {
        const chunks = [];
        const reader = orig.stream.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        const sharp = (await import('sharp')).default;
        const out = await sharp(Buffer.concat(chunks))
          .rotate()
          .resize(wantW, wantW, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        // Store-back failure only means the next request rebuilds — still serve.
        try {
          await put(variantKey, out, { access: 'private', contentType: 'image/webp', addRandomSuffix: false });
        } catch (err) {
          console.error('media variant store failed:', String(err.message || err));
        }
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Length', out.length);
        res.setHeader('Cache-Control', variantCache);
        res.end(out);
        return;
      }
    } catch (err) {
      console.error('media resize failed (serving original):', String(err.message || err));
    }
  }

  let result;
  try {
    result = await get(key, { access: 'private' });
  } catch (err) {
    res.status(404).json({ error: 'Blob not found', detail: String(err.message || err) });
    return;
  }
  if (result.statusCode !== 200 || !result.stream) {
    res.status(502).json({ error: 'Unexpected blob response' });
    return;
  }

  res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
  if (result.blob.size) res.setHeader('Content-Length', result.blob.size);
  res.setHeader('Cache-Control', isPublic ? publicCache : privateCache);
  await pipeOut(result.stream, res);
}

async function pipeOut(stream, res) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Stream failed', detail: String(err.message || err) });
    } else {
      res.end();
    }
  }
}
