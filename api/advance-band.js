// GET  /api/advance-band?childId=  → { current, natural, advanced, next, readyToAdvance, mastery }
// POST /api/advance-band            { childId, to?, reason? }   parent or mastery unlock
//
// Manual ("parent"): omit `to` to advance one rung, or pass an explicit band id.
// Auto ("mastery"): the SAME endpoint is the writer. The GET path computes
// readyToAdvance from recent game_attempts and the caller can act on it (a
// front-end button, or a cron that POSTs without parent involvement).
//
// Mastery rule (deliberately strict): in the last 30 days, the child has
// >= 10 game_attempts whose tile sits inside the current band, AND every
// one of those attempts was correct (i.e. 100% accuracy on >= 10 trials).
// That mirrors the parent's stated bar — "100% for 10 consecutive assessments"
// — without requiring true session-streaks (data sparsity).
import { checkAuth } from './_lib/auth.js';
import { canAccessChild, isParentOf } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { AGE_BANDS, bandForBirthDate, higherBand, nextBand } from './_lib/age-band.js';

const MASTERY_MIN_ATTEMPTS = 10;
const MASTERY_LOOKBACK_DAYS = 30;
const VALID_REASONS = new Set(['parent', 'mastery']);

async function loadBandState(db, childId) {
  const me = (await db`SELECT id, birth_date, advanced_to_band, advanced_at, advanced_reason
                       FROM persons WHERE child_id = ${childId} AND is_self = TRUE LIMIT 1`)[0];
  const natural = me && me.birth_date ? bandForBirthDate(me.birth_date) : null;
  const advanced = me ? (me.advanced_to_band || null) : null;
  const current = higherBand(natural, advanced) || AGE_BANDS[0];
  return { me, natural, advanced, current, next: nextBand(current) };
}

async function masterySignal(db, childId, currentBand) {
  if (!currentBand) return { correct: 0, total: 0, ready: false };
  const rows = await db`
    SELECT a.correct
    FROM game_attempts a
    JOIN taxonomy t ON t.id = a.taxonomy_slug
    WHERE a.child_id = ${childId}
      AND a.occurred_at > NOW() - (${MASTERY_LOOKBACK_DAYS} || ' days')::interval
      AND t.acquisition_age = ${currentBand}`;
  const total = rows.length;
  const correct = rows.reduce((n, r) => n + (r.correct ? 1 : 0), 0);
  const ready = total >= MASTERY_MIN_ATTEMPTS && correct === total;
  return { correct, total, ready };
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  if (req.method === 'GET') {
    const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
    if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
    if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }
    try {
      const db = sql();
      const s = await loadBandState(db, childId);
      const mastery = await masterySignal(db, childId, s.current);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        current: s.current, natural: s.natural, advanced: s.advanced, next: s.next,
        advancedAt: s.me ? s.me.advanced_at : null, advancedReason: s.me ? s.me.advanced_reason : null,
        bands: AGE_BANDS,
        mastery: { ...mastery, lookbackDays: MASTERY_LOOKBACK_DAYS, minAttempts: MASTERY_MIN_ATTEMPTS },
        readyToAdvance: !!s.next && mastery.ready,
      });
    } catch (err) { res.status(500).json({ error: 'Band lookup failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'POST') {
    const b = (typeof req.body === 'object' && req.body) || {};
    const childId = String(b.childId || '').slice(0, 64).trim();
    if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
    const reason = VALID_REASONS.has(b.reason) ? b.reason : 'parent';
    if (reason === 'parent' && auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId))) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    if (reason === 'mastery' && auth.user.role !== 'admin' && !(await canAccessChild(auth.user, childId))) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    try {
      const db = sql();
      const s = await loadBandState(db, childId);
      let target = b.to ? String(b.to) : s.next;
      if (!target) { res.status(400).json({ error: 'already at top band', current: s.current }); return; }
      if (!AGE_BANDS.includes(target)) { res.status(400).json({ error: 'invalid target band', allowed: AGE_BANDS }); return; }
      // Mastery writes require the readiness check to actually hold — a
      // misbehaving cron can't bypass the data. Parent unlocks override.
      if (reason === 'mastery') {
        const m = await masterySignal(db, childId, s.current);
        if (!m.ready) { res.status(409).json({ error: 'Mastery threshold not met', mastery: m }); return; }
      }
      // Don't downshift: setting advanced_to_band to something LOWER than the
      // current effective band would be a no-op anyway, but reject it loudly.
      if (higherBand(s.current, target) === s.current && s.current !== target) {
        res.status(409).json({ error: 'Target band is not higher than current', current: s.current }); return;
      }
      if (!s.me) { res.status(400).json({ error: 'No is_self person row yet — set the child up in onboarding first.' }); return; }
      await db`UPDATE persons SET advanced_to_band = ${target}, advanced_at = NOW(), advanced_reason = ${reason}, updated_at = NOW()
               WHERE id = ${s.me.id}`;
      const after = await loadBandState(db, childId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, current: after.current, advanced: after.advanced, next: after.next, reason });
    } catch (err) { res.status(500).json({ error: 'Advance failed', detail: String(err.message || err) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
