// POST /api/invite { code } — the private-preview gate. If the code matches an
// active row in invite_codes (managed from the admin), set a signed `mw_invite`
// cookie so the edge middleware lets this device through for 30 days. Public
// (no auth) — this is how an un-logged-in visitor gets past the gate.
import { signSession, SESSION_MAX_AGE } from '../lib/session.js';
import { sql } from './_lib/db.js';

const INVITE_COOKIE = 'mw_invite';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      uses INTEGER NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secret = process.env.SESSION_SECRET;
  if (!secret) { res.status(500).json({ error: 'SESSION_SECRET not set' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const code = typeof b.code === 'string' ? b.code.trim() : '';
  if (!code) { res.status(400).json({ error: 'Code required' }); return; }

  try {
    const db = sql();
    await ensureTable(db);
    // Match + count the use in one statement; rows is non-empty only on success.
    const rows = await db`
      UPDATE invite_codes SET uses = uses + 1, last_used_at = NOW()
      WHERE lower(code) = lower(${code}) AND active = TRUE
      RETURNING id`;
    if (!rows.length) { res.status(401).json({ error: 'Invalid invite code' }); return; }

    const token = await signSession({ inv: true, exp: Date.now() + SESSION_MAX_AGE * 1000 }, secret);
    const cookie = [
      `${INVITE_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure',
      `Max-Age=${SESSION_MAX_AGE}`,
    ].join('; ');
    res.setHeader('Set-Cookie', cookie);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Invite check failed', detail: String(err.message || err) });
  }
}
