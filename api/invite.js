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
    // Launch-group limits: a code with max_uses caps ACCOUNTS CREATED with it
    // (users.invite_code attribution — set at signup), not gate unlocks, so a
    // family can re-enter their code on a second device freely. A full code is
    // turned away here too — no point letting someone browse to a signup that
    // will refuse them.
    try {
      await db`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER`;
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT`;
      const cap = await db`
        SELECT ic.max_uses,
               (SELECT COUNT(*)::int FROM users u WHERE lower(u.invite_code) = lower(ic.code)) AS signups
        FROM invite_codes ic
        WHERE lower(ic.code) = lower(${code}) AND ic.active = TRUE LIMIT 1`;
      if (cap.length && cap[0].max_uses != null && Number(cap[0].signups) >= Number(cap[0].max_uses)) {
        res.status(401).json({ error: 'That invite code’s launch group is full — join the waitlist on the home page and we’ll email you a fresh code when spots open.' });
        return;
      }
    } catch (_) { /* pre-users-table bootstrap: no accounts yet, nothing to cap */ }
    // Match + count the use in one statement; rows is non-empty only on success.
    const rows = await db`
      UPDATE invite_codes SET uses = uses + 1, last_used_at = NOW()
      WHERE lower(code) = lower(${code}) AND active = TRUE
      RETURNING id`;
    if (!rows.length) { res.status(401).json({ error: 'Invalid invite code' }); return; }

    // Carry WHICH code opened the gate inside the signed payload — signup
    // reads it to apply the code's perks (comped tier + credit grant) to the
    // brand-new account. The middleware still only checks `inv`.
    const token = await signSession(
      { inv: true, code: code.toLowerCase(), exp: Date.now() + SESSION_MAX_AGE * 1000 }, secret);
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
