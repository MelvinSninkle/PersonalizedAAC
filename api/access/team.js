// GET    /api/access/team?childId=X — list a child's team: active members +
//                                     pending invites the parent has sent.
// DELETE /api/access/team?childId=X&userId=Y — remove a team member (parent
//                                     authority; same gate as canEditContent
//                                     for the broader trust model).
// Both endpoints require parent-of-child or admin.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { isParentOf } from '../_lib/access.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId, db))) {
      res.status(403).json({ error: 'Only a parent of this child can manage the team.' }); return;
    }

    if (req.method === 'GET') {
      const members = await db`
        SELECT ca.user_id, ca.relation, ca.status, ca.created_at,
               u.email, u.role
        FROM child_access ca
        JOIN users u ON u.id = ca.user_id
        WHERE ca.child_id = ${childId} AND ca.status = 'active'
        ORDER BY ca.relation, u.email`;
      const pending = await db`
        SELECT id, therapist_email, therapist_user_id, created_at
        FROM access_requests
        WHERE child_id = ${childId} AND status = 'pending' AND direction = 'invite'
        ORDER BY created_at DESC`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        members: members.map(m => ({
          userId: Number(m.user_id), email: m.email, role: m.role,
          relation: m.relation, joinedAt: m.created_at,
        })),
        pending: pending.map(p => ({
          requestId: Number(p.id), email: p.therapist_email,
          hasAccount: p.therapist_user_id != null, invitedAt: p.created_at,
        })),
      });
      return;
    }

    if (req.method === 'DELETE') {
      const userId = Number(req.query && req.query.userId);
      const requestId = Number(req.query && req.query.requestId);
      if (Number.isFinite(requestId)) {
        // Cancel a pending invite
        await db`
          UPDATE access_requests SET status='declined', decided_at=NOW()
          WHERE id=${requestId} AND child_id=${childId} AND status='pending'`;
        res.status(200).json({ ok: true, cancelled: 'invite' });
        return;
      }
      if (!Number.isFinite(userId)) { res.status(400).json({ error: 'userId or requestId required' }); return; }
      // Parent can't remove themselves via this endpoint (would orphan the child).
      if (Number(userId) === Number(auth.user.id) && auth.user.role !== 'admin') {
        res.status(400).json({ error: 'You cannot remove yourself from the team.' }); return;
      }
      await db`
        UPDATE child_access SET status='revoked'
        WHERE child_id=${childId} AND user_id=${userId} AND status='active'`;
      res.status(200).json({ ok: true, removed: userId });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Team request failed', detail: String(err.message || err) });
  }
}
