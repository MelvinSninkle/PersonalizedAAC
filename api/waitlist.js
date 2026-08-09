// /api/waitlist — the landing-page waitlist, now the front door of the
// Founding Family concierge funnel.
//
//   POST                    { email, style?, note?, source?, consent? }
//                           → { ok, id, token }  (token authorizes ?action=photo)
//   POST ?action=photo      { id, token, image: dataURL, name? }
//                           → { ok, count }      (consented family photos)
//   GET                     admin-only review: rows + paid state + photo keys
//
// POST is intentionally open — it's the public form. Photo uploads are the
// SENSITIVE part (families upload pictures of their kids before any account
// or COPPA consent screen exists), so they are fenced four ways:
//   1. CONSENT — the row must carry the form's parent/guardian consent
//      checkbox before a single photo is accepted, and the consent text
//      version is stored with it.
//   2. TOKEN — photos attach only via an HMAC token minted by THAT row's
//      POST (2-hour expiry), so nobody can spray photos onto other rows.
//   3. CAPS — max 8 photos per signup, ~4MB each, image content-types only.
//   4. PRIVATE — blobs live under waitlist/<id>/, which /api/media serves
//      to ADMINS ONLY (not the usual any-authenticated-user library rule).
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const WAITLIST_CONSENT_VERSION = '2026-08';

export async function ensureWaitlist(db) {
  await db`
    CREATE TABLE IF NOT EXISTS waitlist (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      style TEXT,
      note TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS waitlist_email_idx   ON waitlist(email)`;
  await db`CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist(created_at DESC)`;
  // Concierge funnel columns (additive — pre-migration rows read as unpaid).
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS photo_consent TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS paid_sku TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invite_code TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS linked_user_id BIGINT`;
  await db`
    CREATE TABLE IF NOT EXISTS waitlist_photos (
      id BIGSERIAL PRIMARY KEY,
      waitlist_id BIGINT NOT NULL,
      blob_key TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS waitlist_photos_row_idx ON waitlist_photos(waitlist_id)`;
}

// ── Row token: lets the JUST-SUBMITTED form attach photos to its own row and
//    start its own checkout — nothing else. HMAC over the row id + expiry
//    with SESSION_SECRET (same secret the session cookies trust).
function tokenSecret() { return process.env.SESSION_SECRET || ''; }

export function mintWaitlistToken(id, exp = Date.now() + TOKEN_TTL_MS) {
  const secret = tokenSecret();
  if (!secret) return null;
  const sig = createHmac('sha256', secret).update(`wl:${id}:${exp}`).digest('hex').slice(0, 40);
  return `${id}.${exp}.${sig}`;
}

export function verifyWaitlistToken(token, id) {
  const secret = tokenSecret();
  if (!secret || typeof token !== 'string') return false;
  const [tid, texp, sig] = token.split('.');
  if (String(tid) !== String(id)) return false;
  const exp = Number(texp);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = createHmac('sha256', secret).update(`wl:${id}:${exp}`).digest('hex').slice(0, 40);
  try { return timingSafeEqual(Buffer.from(expect), Buffer.from(String(sig || ''))); } catch (_) { return false; }
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  if (req.method === 'GET') return list(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (action === 'photo') return photo(req, res);
  return join(req, res);
}

async function join(req, res) {
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }
  const style  = typeof body.style  === 'string' ? body.style.slice(0, 60)  : null;
  const note   = typeof body.note   === 'string' ? body.note.slice(0, 1000) : null;
  const source = typeof body.source === 'string' ? body.source.slice(0, 60) : 'landing';
  // The photo-consent checkbox. Stored as the consent VERSION so a future
  // wording change is distinguishable from an old agreement.
  const consent = body.consent === true ? WAITLIST_CONSENT_VERSION : null;

  try {
    const db = sql();
    await ensureWaitlist(db);
    const ins = await db`
      INSERT INTO waitlist (email, style, note, source, photo_consent)
      VALUES (${email}, ${style}, ${note}, ${source}, ${consent})
      RETURNING id
    `;
    const id = Number(ins[0].id);
    res.status(200).json({ ok: true, id, token: mintWaitlistToken(id) });
  } catch (err) {
    res.status(500).json({ error: 'Save failed', detail: String(err.message || err) });
  }
}

// dataURL → { buffer, contentType } for the three image types we accept.
function decodeImageDataURL(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[2], 'base64');
    return buffer.length ? { buffer, contentType: m[1] } : null;
  } catch (_) { return null; }
}

async function photo(req, res) {
  const body = (typeof req.body === 'object' && req.body) || {};
  const id = Number(body.id) || 0;
  if (!id || !verifyWaitlistToken(body.token, id)) {
    res.status(401).json({ error: 'bad or expired token' });
    return;
  }
  const img = decodeImageDataURL(body.image);
  if (!img) { res.status(400).json({ error: 'image must be a jpeg/png/webp data URL' }); return; }
  if (img.buffer.length > MAX_PHOTO_BYTES) {
    res.status(400).json({ error: 'photo too large (4MB max — the form downscales, so this should not happen)' });
    return;
  }
  try {
    const db = sql();
    await ensureWaitlist(db);
    const row = (await db`SELECT id, photo_consent FROM waitlist WHERE id = ${id} LIMIT 1`)[0];
    if (!row) { res.status(404).json({ error: 'signup not found' }); return; }
    // No consent on the row → no photos, full stop.
    if (!row.photo_consent) {
      res.status(403).json({ error: 'consent_required',
        detail: 'Photos need the parent/guardian consent box checked on the form.' });
      return;
    }
    const count = Number((await db`SELECT COUNT(*)::int AS n FROM waitlist_photos WHERE waitlist_id = ${id}`)[0]?.n) || 0;
    if (count >= MAX_PHOTOS) { res.status(400).json({ error: `photo limit reached (${MAX_PHOTOS})` }); return; }
    const ext = img.contentType === 'image/png' ? 'png' : img.contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `waitlist/${id}/${randomUUID()}.${ext}`;
    await put(key, img.buffer, { access: 'private', contentType: img.contentType, addRandomSuffix: false });
    const name = typeof body.name === 'string' ? body.name.slice(0, 120) : null;
    await db`INSERT INTO waitlist_photos (waitlist_id, blob_key, name) VALUES (${id}, ${key}, ${name})`;
    res.status(200).json({ ok: true, count: count + 1 });
  } catch (err) {
    res.status(500).json({ error: 'photo save failed', detail: String(err.message || err) });
  }
}

async function list(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  if (auth.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin role required' });
    return;
  }
  try {
    const db = sql();
    await ensureWaitlist(db);
    const rows = await db`
      SELECT id, email, style, note, source, created_at, photo_consent,
             paid_at, paid_sku, invite_code, linked_user_id
      FROM waitlist ORDER BY created_at DESC LIMIT 500`;
    const photos = await db`
      SELECT waitlist_id, blob_key FROM waitlist_photos
      WHERE waitlist_id = ANY(${rows.map((r) => Number(r.id))})
      ORDER BY id`;
    const byRow = new Map();
    for (const p of photos) {
      const k = Number(p.waitlist_id);
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(p.blob_key);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      waitlist: rows.map((r) => ({ ...r, photos: byRow.get(Number(r.id)) || [] })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Load failed', detail: String(err.message || err) });
  }
}
