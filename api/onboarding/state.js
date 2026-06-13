// GET /api/onboarding/state
//
// "Where am I in the onboarding flow?" — drives resume on both clients.
// Returns the current step + any persisted data + a list of completed steps,
// or { step: 'complete' } if the parent already finished.
//
// Auth-required: it's tied to the signed-in user.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ORDER, ensureProgress } from '../_lib/onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

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
