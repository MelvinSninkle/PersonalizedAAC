// POST /api/access/respond — accept or decline a pending invite.
// Body: { requestId, action: 'accept' | 'decline', token? }
//   - token (optional) = signed invite token from the email link. When present
//     it lets a user accept by email even if the invite predates their signup
//     (the token authorizes; we still verify the email matches their account).
// On accept: creates a child_access row (relation='therapist', status='active').
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { verifySession } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.id == null) { res.status(403).json({ error: 'Sign in required' }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  const requestId = Number(body.requestId);
  const action = body.action === 'decline' ? 'decline' : (body.action === 'accept' ? 'accept' : null);
  const tokenStr = typeof body.token === 'string' ? body.token : '';
  if (!Number.isFinite(requestId) || !action) {
    res.status(400).json({ error: 'requestId and action required' }); return;
  }

  try {
    const db = sql();
    const rows = await db`
      SELECT id, child_id, therapist_user_id, therapist_email, status, direction
      FROM access_requests WHERE id = ${requestId} LIMIT 1`;
    if (!rows.length) { res.status(404).json({ error: 'Invite not found' }); return; }
    const r = rows[0];
    if (r.status !== 'pending') { res.status(409).json({ error: 'Already responded' }); return; }
    if (r.direction !== 'invite') { res.status(400).json({ error: 'Not an invite' }); return; }

    // Authorization: this user is the explicit target OR the email matches.
    const myEmail = (auth.user.email || '').toLowerCase();
    const inviteEmail = (r.therapist_email || '').toLowerCase();
    let authorized = (r.therapist_user_id != null && Number(r.therapist_user_id) === Number(auth.user.id))
                  || (r.therapist_user_id == null && myEmail && myEmail === inviteEmail);

    // Fallback: a signed token (from the email link) can authorize when the
    // invite was created before the user signed up — it still must match the
    // user's verified email.
    if (!authorized && tokenStr) {
      const secret = process.env.SESSION_SECRET;
      const payload = secret ? await verifySession(tokenStr, secret) : null;
      if (payload && payload.kind === 'invite' && Number(payload.requestId) === requestId
          && (payload.email || '').toLowerCase() === myEmail) {
        authorized = true;
      }
    }
    if (!authorized) { res.status(403).json({ error: 'This invite is not for your account.' }); return; }

    if (action === 'decline') {
      await db`UPDATE access_requests SET status='declined', decided_at=NOW() WHERE id=${requestId}`;
      res.status(200).json({ ok: true, action: 'declined' });
      return;
    }

    // Accept: create child_access (idempotent) + close the request. The user's
    // role stays whatever it was, but their relation TO THIS CHILD is therapist.
    await db`
      INSERT INTO child_access (user_id, child_id, relation, status)
      VALUES (${auth.user.id}, ${r.child_id}, 'therapist', 'active')
      ON CONFLICT (user_id, child_id) DO UPDATE SET status = 'active'`;
    // Also link the request to the now-known user id (helps audit / search).
    await db`
      UPDATE access_requests SET status='accepted', decided_at=NOW(), therapist_user_id=${auth.user.id}
      WHERE id=${requestId}`;

    res.status(200).json({ ok: true, action: 'accepted', childId: r.child_id });
  } catch (err) {
    res.status(500).json({ error: 'Respond failed', detail: String(err.message || err) });
  }
}
