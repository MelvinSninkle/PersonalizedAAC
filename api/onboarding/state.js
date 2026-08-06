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
// POST /api/onboarding/state  { op:'add-child' }   (multi-child, dark launch)
//
// "Add a Child": points the account's onboarding cursor at a FRESH generated
// board slug and rewinds the step to 'child', so the flow runs again from the
// child's name onward (the account step is done forever). Nothing about the
// existing children is touched — their boards, rosters, settings, and history
// all key on their own child_id. Gated by multiChildAllowed while dark.
//
// Auth-required: it's tied to the signed-in user.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ORDER, ensureProgress, childrenOf, newChildSlug, multiChildAllowed } from '../_lib/onboarding.js';
import { ensureCredits, grantCredits, creditBalance } from '../_lib/credits.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  if (req.method === 'POST') {
    const b = (typeof req.body === 'object' && req.body) || {};
    if (b.op === 'add-child') {
      if (!multiChildAllowed(auth.user)) {
        res.status(403).json({ error: 'not_available', detail: 'Multi-child accounts are in testing.' });
        return;
      }
      const uid = Number(auth.user.uid || auth.user.id) || null;
      if (!uid) { res.status(400).json({ error: 'no account' }); return; }
      try {
        const db = sql();
        await ensureProgress(db, auth.user);   // guarantees the row exists
        const childId = newChildSlug();
        // Fresh cursor: new slug, rewound to the child step, cleared flow
        // data (drafts from the previous run must not bleed into this one).
        await db`UPDATE onboarding_progress
                    SET child_id = ${childId}, step = 'child', data = '{}'::jsonb, updated_at = NOW()
                  WHERE user_id = ${uid}`;
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ ok: true, childId, step: 'child' });
      } catch (err) {
        res.status(500).json({ error: 'add-child failed', detail: String(err.message || err) });
      }
      return;
    }
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
    // Multi-child: every board this account parents, plus whether the
    // Add-a-Child affordance should show (dark-launch gate). Single-child
    // accounts get a one-entry list — clients show the switcher only at 2+.
    const children = await childrenOf(db, Number(auth.user.uid || auth.user.id));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      step: p.step,
      completed: ORDER.slice(0, Math.max(0, completedIdx)),
      childId: p.child_id || null,
      data: p.data || {},
      children,
      multiChild: multiChildAllowed(auth.user),
    });
  } catch (err) {
    res.status(500).json({ error: 'state failed', detail: String(err.message || err) });
  }
}
