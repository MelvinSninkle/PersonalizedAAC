// POST /api/exposure-tick — record one exposure of a skill for a child and
// recompute the schedule. Called by SlideshowView (each session's dominant
// skill), and any other future surface that delivers a canonical stimulus.
// Game sessions tick internally inside /api/game-log (no separate roundtrip).
//
// Body: { childId, skillSlug, source?, sessionId? }
//   source = 'slideshow' (default) | 'game' | 'free_use'
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { tickExposure } from './_lib/exposure.js';
import { canAccessChild } from './_lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = typeof b.childId === 'string' && b.childId ? b.childId.slice(0, 64) : 'fletcherpeterson';
  const skillSlug = typeof b.skillSlug === 'string' && b.skillSlug ? b.skillSlug.slice(0, 200) : null;
  if (!skillSlug) { res.status(400).json({ error: 'skillSlug required' }); return; }
  const source = (b.source === 'game' || b.source === 'free_use') ? b.source : 'slideshow';
  const sessionId = Number.isFinite(b.sessionId) ? Math.trunc(b.sessionId) : null;

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    const protocol = await tickExposure(db, { childId, skillSlug, source, sessionId });
    res.status(200).json({ ok: true, protocol });
  } catch (err) {
    res.status(500).json({ error: 'Tick failed', detail: String(err.message || err) });
  }
}
