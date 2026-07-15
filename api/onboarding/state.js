// GET  /api/onboarding/state
//
// "Where am I in the onboarding flow?" — drives resume on both clients.
// Returns the current step + any persisted data + a list of completed steps,
// or { step: 'complete' } if the parent already finished.
//
// POST /api/onboarding/state  { op:'bonus', step:'foods'|'toys' }
//
// The onboarding "personal touches" bonuses: ⭐3 land when the favorite-foods
// step appears and ⭐3 at toys. Idempotent by ledger reason (onboard:foods /
// onboard:toys) — refreshes and replays can never double-grant.
//
// Auth-required: it's tied to the signed-in user.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ORDER, ensureProgress } from '../_lib/onboarding.js';
import { ensureCredits, grantCredits, creditBalance } from '../_lib/credits.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  if (req.method === 'POST') {
    const b = (typeof req.body === 'object' && req.body) || {};
    if (b.op !== 'bonus') { res.status(400).json({ error: 'unknown op' }); return; }
    const step = b.step === 'toys' ? 'toys' : 'foods';
    const uid = Number(auth.user.uid || auth.user.id) || null;
    if (!uid) { res.status(400).json({ error: 'no account' }); return; }
    try {
      const db = sql();
      await ensureCredits(db);
      const reason = 'onboard:' + step;
      const has = await db`SELECT 1 FROM credit_ledger WHERE user_id = ${uid} AND reason = ${reason} LIMIT 1`;
      const balance = has.length
        ? await creditBalance(db, uid)
        : await grantCredits(db, { userId: uid, credits: 3, reason });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, granted: has.length ? 0 : 3, balance });
    } catch (err) {
      res.status(500).json({ error: 'bonus failed', detail: String(err.message || err) });
    }
    return;
  }

  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = sql();
    const p = await ensureProgress(db, auth.user);
    const completedIdx = ORDER.indexOf(p.step);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      step: p.step,
      completed: ORDER.slice(0, Math.max(0, completedIdx)),
      childId: p.child_id || null,
      data: p.data || {},
    });
  } catch (err) {
    res.status(500).json({ error: 'state failed', detail: String(err.message || err) });
  }
}
