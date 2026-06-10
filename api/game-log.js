// POST /api/game-log — record one finished game session and its per-item
// attempts (feeds the Games + Time dashboards). Auth-gated; best-effort from
// the client (a failed log never blocks gameplay).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';
import { apnsConfigured, sendToTokens } from './_lib/apns.js';
import { tickExposure } from './_lib/exposure.js';
import { detectSpikes } from './_lib/spike.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = typeof b.childId === 'string' && b.childId ? b.childId.slice(0, 64) : 'fletcherpeterson';
  const mode = typeof b.mode === 'string' ? b.mode.slice(0, 32) : 'self_paced';
  const category = typeof b.category === 'string' ? b.category.slice(0, 120) : null;
  const startedAt = typeof b.startedAt === 'string' ? b.startedAt : new Date().toISOString();
  const endedAt = typeof b.endedAt === 'string' ? b.endedAt : new Date().toISOString();
  const attempts = Array.isArray(b.attempts) ? b.attempts.slice(0, 500) : [];
  const itemCount = Number.isFinite(b.itemCount) ? b.itemCount : attempts.length;
  const correctCount = Number.isFinite(b.correctCount) ? b.correctCount : attempts.filter(a => a && a.correct).length;
  // PRD §3.1 honest scoring: slides actually attempted (mercy-aware). Falls
  // back to the legacy itemCount when the client doesn't send it.
  const slidesAttempted = Number.isFinite(b.slidesAttempted) ? b.slidesAttempted : null;
  const endReason = typeof b.endReason === 'string' ? b.endReason.slice(0, 32) : null;
  // PRD §11 skill anchor — the canonical taxonomy slug for the session's
  // target. Clients should pass the resolved slug; if missing we'll fall
  // back to the first attempt's slug below.
  const skillSlug = typeof b.skillSlug === 'string' && b.skillSlug ? b.skillSlug.slice(0, 200) : null;
  // PRD §3 cutover: v2 = mercy any-attempt counts. Pre-cutover rows stay at 1.
  const scoringVersion = (b.scoringVersion === 2 || b.scoringVersion === '2') ? 2 : 1;

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    // Last-ditch skill_slug fallback: if the session didn't carry one but at
    // least one attempt did, use the first one we see (taxonomySlug field on
    // the attempt — see backfill in attempt insert below).
    const fallbackSkill = !skillSlug
      ? (attempts.find(a => a && typeof a.taxonomySlug === 'string' && a.taxonomySlug)?.taxonomySlug?.slice(0, 200) || null)
      : null;
    const effectiveSkill = skillSlug || fallbackSkill;

    const rows = await db`
      INSERT INTO sessions (child_id, mode, category, facilitator, started_at, ended_at,
                            correct_count, item_count,
                            slides_attempted, end_reason, skill_slug, scoring_version)
      VALUES (${childId}, ${mode}, ${category}, ${auth.user.role || null}, ${startedAt}, ${endedAt},
              ${correctCount}, ${itemCount},
              ${slidesAttempted}, ${endReason}, ${effectiveSkill}, ${scoringVersion})
      RETURNING id`;
    const sid = rows[0].id;
    for (const a of attempts) {
      if (!a || typeof a !== 'object') continue;
      const inputMethod = typeof a.inputMethod === 'string' ? a.inputMethod.slice(0, 16) : 'tap';
      // PRD §4.2: child-generated = anything that isn't a button tap. If the
      // client explicitly sends childGenerated we trust it; otherwise derive
      // from inputMethod so legacy clients get the right flag.
      const childGenerated = typeof a.childGenerated === 'boolean'
        ? a.childGenerated
        : (inputMethod === 'verbal' || inputMethod === 'object' || inputMethod === 'physical' || inputMethod === 'gesture');
      await db`
        INSERT INTO game_attempts (session_id, child_id, category, label, item_id, correct,
                                   input_method, misses, occurred_at,
                                   attempts_taken, distractor_count, child_generated,
                                   taxonomy_slug)
        VALUES (${sid}, ${childId},
                ${typeof a.category === 'string' ? a.category.slice(0, 120) : null},
                ${typeof a.label === 'string' ? a.label.slice(0, 200) : null},
                ${Number.isFinite(a.itemId) ? a.itemId : null},
                ${!!a.correct},
                ${inputMethod},
                ${Number.isFinite(a.misses) ? a.misses : 0},
                ${typeof a.occurredAt === 'string' ? a.occurredAt : new Date().toISOString()},
                ${Number.isFinite(a.attemptsTaken) ? a.attemptsTaken : 1},
                ${Number.isFinite(a.distractorCount) ? a.distractorCount : null},
                ${childGenerated},
                ${typeof a.taxonomySlug === 'string' ? a.taxonomySlug.slice(0, 200) : null})`;
    }
    // PRD §8: every scored session is one exposure of its dominant skill.
    // Best-effort — a tick failure never blocks the log response. Slideshow
    // sessions don't pass through here; SlideshowView ticks directly via
    // /api/exposure-tick.
    if (effectiveSkill) {
      try { await tickExposure(db, { childId, skillSlug: effectiveSkill, source: 'game', sessionId: Number(sid) }); }
      catch (_) {}
    }

    // PRD §6: inline spike detection — pull this session's (skill, mode)
    // history, compute baseline + sigma, write flags for 2σ / 3σ / 100%.
    // Best-effort; never blocks the response. Runs only on v2 sessions to
    // keep the baseline clean from the pre-cutover first-try-only scoring.
    let spikeFlags = [];
    try {
      spikeFlags = await detectSpikes(db, {
        sessionId: Number(sid),
        childId,
        skillSlug: effectiveSkill,
        mode,
        scoringVersion,
      });
    } catch (_) { /* */ }

    // For auto-games (scheduled), push the score to opted-in parents — best effort.
    try {
      if (b.auto && apnsConfigured()) {
        const setRows = await db`SELECT settings FROM child_settings WHERE child_id = ${childId}`;
        const opted = setRows.length && setRows[0].settings && setRows[0].settings.gameResultsPush;
        if (opted) {
          const toks = await db`SELECT token FROM push_tokens WHERE child_id = ${childId} AND role IN ('parent','admin')`;
          if (toks.length) {
            const name = (childId.replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase())) || 'Your child';
            const cat = (category && !String(category).startsWith('cat:')) ? (' · ' + category) : '';
            await sendToTokens(toks.map(t => t.token), { title: name + ' finished a game', body: (name + ' scored ' + correctCount + '/' + itemCount + cat).slice(0, 178), data: { kind: 'game' } });
          }
        }
      }
    } catch (_) {}
    res.status(200).json({ ok: true, sessionId: Number(sid), attempts: attempts.length, spikeFlags });
  } catch (err) {
    res.status(500).json({ error: 'Log failed', detail: String(err.message || err) });
  }
}
