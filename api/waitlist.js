// POST /api/waitlist — captures email signups from the landing page.
// Body: { email, style?, note?, source? }
// Inserts a row into the `waitlist` table. Returns { ok: true }.
//
// POST is intentionally open — it's the public-facing form submission. GET is
// admin-only (bearer token) so the admin hub can review signups.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method === 'GET') return list(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }
  const style  = typeof body.style  === 'string' ? body.style.slice(0, 60)  : null;
  const note   = typeof body.note   === 'string' ? body.note.slice(0, 1000) : null;
  const source = typeof body.source === 'string' ? body.source.slice(0, 60) : 'landing';

  try {
    const db = sql();
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
    await db`
      INSERT INTO waitlist (email, style, note, source)
      VALUES (${email}, ${style}, ${note}, ${source})
    `;
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Save failed', detail: String(err.message || err) });
  }
}

async function list(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  try {
    const db = sql();
    const rows = await db`
      SELECT id, email, style, note, source, created_at
      FROM waitlist ORDER BY created_at DESC LIMIT 500`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ waitlist: rows });
  } catch (err) {
    res.status(500).json({ error: 'Load failed', detail: String(err.message || err) });
  }
}
