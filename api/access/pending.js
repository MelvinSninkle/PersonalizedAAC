// GET /api/access/pending — pending invites the signed-in user can act on.
// Matches by therapist_user_id when known, or by email otherwise (so an invite
// sent to an email that later signs up is still visible to that account).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';

function prettyName(childId) {
  return String(childId || '').replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase()) || childId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.id == null && !auth.user.email) { res.status(200).json({ invites: [] }); return; }

  try {
    const db = sql();
    const email = (auth.user.email || '').toLowerCase();
    const uid = auth.user.id || null;
    const rows = await db`
      SELECT ar.id, ar.child_id, ar.created_at, ar.therapist_email,
             u.email AS inviter_email
      FROM access_requests ar
      LEFT JOIN users u ON u.id = ar.created_by
      WHERE ar.status = 'pending' AND ar.direction = 'invite'
        AND (
          (${uid}::bigint IS NOT NULL AND ar.therapist_user_id = ${uid})
          OR (ar.therapist_user_id IS NULL AND LOWER(ar.therapist_email) = ${email})
        )
      ORDER BY ar.created_at DESC`;

    const portraits = rows.length
      ? await db`
          SELECT DISTINCT ON (child_id) child_id, image_key
          FROM items
          WHERE child_id = ANY(${rows.map(r => r.child_id)}) AND section = 'people' AND image_key IS NOT NULL
          ORDER BY child_id, pinned DESC, display_order ASC, id ASC`
      : [];
    const pmap = new Map(portraits.map(r => [r.child_id, r.image_key]));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      invites: rows.map(r => ({
        id: Number(r.id),
        childId: r.child_id,
        childName: prettyName(r.child_id),
        imageKey: pmap.get(r.child_id) || null,
        inviterEmail: r.inviter_email || null,
        invitedAt: r.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load invites', detail: String(err.message || err) });
  }
}
