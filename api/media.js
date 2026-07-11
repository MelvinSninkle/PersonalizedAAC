// GET /api/media?key=<pathname> — auth-gated proxy for private blobs.
// The client passes the bearer token; we stream the bytes back so <img>/<audio>
// elements can use a same-origin URL (after the client wraps the response in
// an object URL).
import { get } from '@vercel/blob';
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
  // Private, short-lived browser cache — the bytes are sensitive. The public
  // shared-library prefixes CDN-cache instead (generic art, no child data).
  res.setHeader('Cache-Control', isPublic ? 'public, s-maxage=86400, max-age=3600' : 'private, max-age=300');

  const reader = result.stream.getReader();
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
