// GET /api/access/invite-probe?t=<token>
// Public, but gated by holding a valid invite token (which already carries the
// email). Returns { email, hasAccount, childId, childName }. The accept-invite
// page uses this to render Sign-In vs Sign-Up — we deliberately don't have a
// generic "does this email exist" endpoint.
import { sql } from '../_lib/db.js';
import { verifySession } from '../../lib/session.js';

function prettyName(childId) {
  return String(childId || '').replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase()) || childId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const token = String((req.query && req.query.t) || '');
  if (!token) { res.status(400).json({ error: 'token required' }); return; }
  const secret = process.env.SESSION_SECRET;
  const payload = secret ? await verifySession(token, secret) : null;
  if (!payload || payload.kind !== 'invite' || !payload.email || !payload.requestId) {
    res.status(400).json({ error: 'Invalid or expired token' }); return;
  }
  const email = String(payload.email).toLowerCase();

  try {
    const db = sql();
    // Confirm the invite is still actionable (not declined / accepted / cancelled).
    const live = await db`
      SELECT id, status FROM access_requests WHERE id = ${payload.requestId} LIMIT 1`;
    if (!live.length || live[0].status !== 'pending') {
      res.status(410).json({ error: 'This invite is no longer pending.' }); return;
    }
    const u = await db`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      email,
      hasAccount: u.length > 0,
      childId: payload.childId || null,
      childName: payload.childId ? prettyName(payload.childId) : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Probe failed', detail: String(err.message || err) });
  }
}
