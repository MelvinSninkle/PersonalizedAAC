// /api/admin/lab?action=spend-guard  (admin only)
//
// The credit velocity guard's admin console (see spendCredits in
// _lib/credits.js: ≥400 credits/hr or ≥800/day auto-pauses an account's
// spends until cleared here; ≥200/hr is flagged for review without a block).
//
//   GET                       → { blocked: [...], hot: [...] }
//     blocked — accounts currently paused (who, when, why, balance)
//     hot     — top spenders in the trailing 24h at or over the review
//               threshold (200 in the hour or 400 in the day)
//   POST { op:'unblock', userId }   → clears the pause
//   POST { op:'block',   userId, reason? } → manual pause (same flag)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { VELOCITY } from '../_lib/credits.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();

  try {
    if (req.method === 'GET') {
      let blocked = [];
      try {
        blocked = await db`
          SELECT u.id, u.email, u.child_slug, u.spend_blocked_at, u.spend_block_reason,
                 COALESCE((SELECT SUM(delta) FROM credit_ledger l WHERE l.user_id = u.id), 0) AS balance
          FROM users u WHERE u.spend_blocked_at IS NOT NULL
          ORDER BY u.spend_blocked_at DESC LIMIT 50`;
      } catch (_) { /* pre-migration */ }
      const hot = await db`
        SELECT u.id, u.email, u.child_slug,
               COALESCE(SUM(CASE WHEN l.created_at > NOW() - INTERVAL '1 hour' THEN -l.delta ELSE 0 END), 0) AS hour_spend,
               COALESCE(SUM(-l.delta), 0) AS day_spend
        FROM credit_ledger l JOIN users u ON u.id = l.user_id
        WHERE l.delta < 0 AND l.created_at > NOW() - INTERVAL '24 hours'
        GROUP BY u.id, u.email, u.child_slug
        HAVING COALESCE(SUM(CASE WHEN l.created_at > NOW() - INTERVAL '1 hour' THEN -l.delta ELSE 0 END), 0) >= ${VELOCITY.hourFlag}
            OR COALESCE(SUM(-l.delta), 0) >= ${VELOCITY.hourBlock}
        ORDER BY hour_spend DESC, day_spend DESC LIMIT 20`;
      res.status(200).json({ ok: true, thresholds: VELOCITY, blocked, hot });
      return;
    }

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const userId = Number(b.userId) || 0;
      if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
      if (b.op === 'unblock') {
        await db`UPDATE users SET spend_blocked_at = NULL, spend_block_reason = NULL WHERE id = ${userId}`;
        res.status(200).json({ ok: true, userId, unblocked: true });
        return;
      }
      if (b.op === 'block') {
        const reason = String(b.reason || 'manual admin pause').slice(0, 200);
        await db`UPDATE users SET spend_blocked_at = NOW(), spend_block_reason = ${reason} WHERE id = ${userId}`;
        res.status(200).json({ ok: true, userId, blocked: true });
        return;
      }
      res.status(400).json({ error: 'unknown op' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'spend-guard failed', detail: String(err.message || err) });
  }
}
