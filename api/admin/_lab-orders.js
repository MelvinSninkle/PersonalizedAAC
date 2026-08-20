// /api/admin/lab?action=orders  (admin only)
//
// The founding-fulfillment queue — every family moving through funnel v2
// (survey → account → photos → deposit), one row per order, so the owner can
// work each board to done: who paid (and their rank), who reserved without
// paying (account + photos held, deposit later), how far their setup is
// (photos uploaded, tiles rendered, jobs queued/failed), and where to go
// next (the family's board tools).
//
//   GET → {
//     caps:   { priorityCap, orderCap } — the admin-adjustable thresholds
//     paid:   count of paid deposits (the capacity number)
//     orders: [{ surveyId, email, userId, childSlug, rank, priority, paid,
//                paidAt, reservedAt, photos, tiles, personalized,
//                jobsQueued, jobsFailed }]
//   }
// Rank/priority per the caps; "reserved" = linked account with no deposit.
// Rows are paid-first by rank, then reservations newest-first.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const db = sql();
  try {
    const { ensureSurvey, foundingCaps, foundingPaidCount } = await import('../waitlist.js');
    try { await ensureSurvey(db); } catch (_) {}
    const caps = await foundingCaps(db);
    const paid = await foundingPaidCount(db);

    const rows = await db`
      SELECT s.id, s.email, s.linked_user_id, s.payment_status, s.paid_at,
             s.founding_rank, s.created_at, s.founding_purchase_interest,
             u.email AS account_email, u.child_slug
      FROM survey_responses s
      LEFT JOIN users u ON u.id = s.linked_user_id
      WHERE s.payment_status = 'paid' OR s.linked_user_id IS NOT NULL
      ORDER BY (s.payment_status = 'paid') DESC, s.founding_rank ASC NULLS LAST,
               s.created_at DESC
      LIMIT 500`;

    // Per-board progress in three grouped scans (photos, tiles, jobs).
    const slugs = [...new Set(rows.map((r) => r.child_slug).filter(Boolean))];
    const photoN = new Map(), tileN = new Map(), persN = new Map(), jobQ = new Map(), jobF = new Map();
    if (slugs.length) {
      try {
        for (const r of await db`SELECT child_id, COUNT(*)::int AS n FROM reference_images
                                 WHERE child_id = ANY(${slugs}) GROUP BY child_id`) {
          photoN.set(r.child_id, r.n);
        }
      } catch (_) {}
      try {
        for (const r of await db`
          SELECT child_id, COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE image_key IS NOT NULL
                   AND image_key NOT LIKE 'taxonomy-defaults/%'
                   AND image_key NOT LIKE 'style-defaults/%')::int AS pers
          FROM items WHERE child_id = ANY(${slugs}) GROUP BY child_id`) {
          tileN.set(r.child_id, r.n); persN.set(r.child_id, r.pers);
        }
      } catch (_) {}
      try {
        for (const r of await db`
          SELECT child_id,
                 COUNT(*) FILTER (WHERE status IN ('queued', 'processing'))::int AS q,
                 COUNT(*) FILTER (WHERE status = 'failed')::int AS f
          FROM tile_jobs WHERE child_id = ANY(${slugs}) GROUP BY child_id`) {
          jobQ.set(r.child_id, r.q); jobF.set(r.child_id, r.f);
        }
      } catch (_) {}
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, caps, paid,
      orders: rows.map((r) => ({
        surveyId: Number(r.id),
        email: r.account_email || r.email,
        userId: r.linked_user_id ? Number(r.linked_user_id) : null,
        childSlug: r.child_slug || null,
        paid: r.payment_status === 'paid',
        paidAt: r.paid_at,
        rank: r.founding_rank || null,
        priority: !!(r.founding_rank && r.founding_rank <= caps.priorityCap),
        interest: r.founding_purchase_interest || null,
        reservedAt: r.created_at,
        photos: photoN.get(r.child_slug) || 0,
        tiles: tileN.get(r.child_slug) || 0,
        personalized: persN.get(r.child_slug) || 0,
        jobsQueued: jobQ.get(r.child_slug) || 0,
        jobsFailed: jobF.get(r.child_slug) || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'orders failed', detail: String(err.message || err) });
  }
}
