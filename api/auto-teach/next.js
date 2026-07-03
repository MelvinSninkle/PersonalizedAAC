// POST /api/auto-teach/next  { childId, mode }
//
// Asks the system: "what should I teach right now?". Returns a batch of
// taxonomy ids to package into a slideshow (mode='exposure') or a game
// (mode='game'), OR a refusal {ok:false, reason} if a gate is closed
// (blackout, cooldown, budget exhausted, child actively using the board).
//
// READ-ONLY: doesn't record anything as exposed. The iPad runner POSTs to
// /api/exposure-tick AFTER it actually shows each tile, so the picker only
// updates counts for real exposures, not previews or aborts.
import { checkAuth } from '../_lib/auth.js';
import { canAccessChild } from '../_lib/access.js';
import { sql } from '../_lib/db.js';
import { loadSettings, saveTimezone, localParts, scheduleReady, CADENCE, TIER_CAPS,
         inBlackout, recentlyActive, lastTriggerAt, todaysBudgetUsed, pickNextBatch } from '../_lib/auto-teach.js';

const VALID_MODES = new Set(['exposure', 'game']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }
  const mode = VALID_MODES.has(b.mode) ? b.mode : 'exposure';

  try {
    const db = sql();
    // The iPad reports its IANA timezone with every poll — persist it so all
    // wall-clock gates below run in FAMILY time, not the server's UTC.
    if (b.tz) await saveTimezone(db, childId, String(b.tz).slice(0, 64));
    const settings = await loadSettings(db, childId);
    const tz = (typeof b.tz === 'string' && b.tz) || settings.tz || null;
    if (!settings.enabled) {
      res.status(200).json({ ok: false, reason: 'disabled' }); return;
    }

    // All gates. Any closed gate → refusal with a reason the iPad can log.
    const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const schedule = (csRow && csRow.settings && csRow.settings.schedule) || {};
    // Never run without knowing when NOT to: sleep + school/therapy windows
    // (or an explicit "no outside care") are required before anything fires.
    if (!scheduleReady(schedule)) { res.status(200).json({ ok: false, reason: 'needs_schedule' }); return; }
    const now = new Date();
    if (inBlackout(schedule, now, tz))     { res.status(200).json({ ok: false, reason: 'blackout' }); return; }
    if (await recentlyActive(db, childId)) { res.status(200).json({ ok: false, reason: 'recently_active' }); return; }

    const last = await lastTriggerAt(db, childId);
    const cooldownMs = settings.cooldownMin * 60 * 1000;
    if (last && now.getTime() - last.getTime() < cooldownMs) {
      res.status(200).json({ ok: false, reason: 'cooldown' }); return;
    }

    const cadence = CADENCE[settings.cadence] || CADENCE.conservative;
    const tier    = TIER_CAPS[settings.tier]   || TIER_CAPS.under3;
    const budgetCapMin = cadence.dailyBudgetMin[settings.tier] || cadence.dailyBudgetMin.under3;
    const events = await todaysBudgetUsed(db, childId);
    const budgetUsedMin = Math.round(events * tier.microSec / 60);
    if (budgetUsedMin >= budgetCapMin) {
      res.status(200).json({ ok: false, reason: 'budget_exhausted', budgetUsedMin, budgetCapMin }); return;
    }
    // Game-mode minimum spacing: only run a game session once per day, at the
    // parent's chosen time (±15 min) — in the family's timezone.
    if (mode === 'game') {
      const [hh, mm] = String(settings.dailyGameAt || '15:30').split(':').map(Number);
      const targetMin = (hh || 0) * 60 + (mm || 0);
      const { minutes: nowMin } = localParts(now, tz);
      if (Math.abs(nowMin - targetMin) > 15) {
        res.status(200).json({ ok: false, reason: 'not_game_window' }); return;
      }
      const gameToday = await db`
        SELECT 1 FROM exposure_events
        WHERE source = 'auto_game' AND occurred_at >= date_trunc('day', NOW())
          AND protocol_id IN (SELECT id FROM exposure_protocols WHERE child_id = ${childId})
        LIMIT 1`;
      if (gameToday.length) { res.status(200).json({ ok: false, reason: 'game_already_today' }); return; }
    }

    const batchSize = mode === 'game' ? 6 : settings.batchSize;
    const tiles = await pickNextBatch({ db, childId, mode, batchSize });
    if (!tiles.length) { res.status(200).json({ ok: false, reason: 'empty_pool' }); return; }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      mode,
      tiles,
      session: {
        microSec: tier.microSec,             // slideshow seconds per image
        sessionMaxMin: tier.sessionMaxMin,   // hard upper bound on game length
        labelStyle: mode === 'exposure' ? 'first_person' : 'plain',
        // The iPad uses the same /api/live channel start path it does for
        // facilitator commands. The runner can also call straight into its
        // SlideshowView / MatchingView for a fully local trigger.
        source: mode === 'game' ? 'auto_game' : 'auto_slideshow',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'auto-teach next failed', detail: String(err.message || err) });
  }
}
