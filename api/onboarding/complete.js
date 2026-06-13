// POST /api/onboarding/complete
//
// Marks onboarding done explicitly (idempotent). Most flows reach 'complete'
// via /api/onboarding/seed-core, but this endpoint exists so the parent app
// can short-circuit during dev / testing OR continue without generating the
// core seed (rare but supported).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, setStep } from '../_lib/onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  try {
    const db = sql();
    await ensureProgress(db, auth.user);
    await setStep(db, Number(auth.user.uid), 'complete');
    res.status(200).json({ ok: true, step: 'complete' });
  } catch (err) {
    res.status(500).json({ error: 'complete failed', detail: String(err.message || err) });
  }
}
