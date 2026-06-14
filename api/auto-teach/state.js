// GET /api/auto-teach/state?childId=
//
// Snapshot of where the Auto-teach subsystem currently stands:
//   - current settings (with defaults filled in for parent UI)
//   - whether we're in a blackout (sleep / school / meal)
//   - how long until the next allowable trigger (cooldown)
//   - today's budget used so far
//   - per-category mastery roll-up
//
// Drives the parent's Auto-teach panel + the iPad runner's "should I trigger
// now?" check before each tick.
import { checkAuth } from '../_lib/auth.js';
import { canAccessChild } from '../_lib/access.js';
import { sql } from '../_lib/db.js';
import { loadSettings, CADENCE, TIER_CAPS, inBlackout, recentlyActive,
         lastTriggerAt, todaysBudgetUsed, masteryByCategory } from '../_lib/auto-teach.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const db = sql();
    const settings = await loadSettings(db, childId);

    // Schedule blob the existing scheduler also reads.
    const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const schedule = (csRow && csRow.settings && csRow.settings.schedule) || {};

    const now = new Date();
    const blackout = inBlackout(schedule, now);
    const cadence = CADENCE[settings.cadence] || CADENCE.conservative;
    const tier = TIER_CAPS[settings.tier] || TIER_CAPS.under3;

    const recent = await recentlyActive(db, childId, 5);
    const last = await lastTriggerAt(db, childId);
    const cooldownMs = settings.cooldownMin * 60 * 1000;
    const sinceLastMs = last ? now.getTime() - last.getTime() : Infinity;
    const cooldownLeftMin = sinceLastMs >= cooldownMs ? 0 : Math.ceil((cooldownMs - sinceLastMs) / 60000);

    const budgetUsedEvents = await todaysBudgetUsed(db, childId);
    const budgetUsedMin = Math.round(budgetUsedEvents * tier.microSec / 60);
    const budgetCapMin = cadence.dailyBudgetMin[settings.tier] || cadence.dailyBudgetMin.under3;
    const budgetExhausted = budgetUsedMin >= budgetCapMin;

    const mastery = await masteryByCategory(db, childId);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      settings,
      tier: { sessionMaxMin: tier.sessionMaxMin, microSec: tier.microSec },
      gates: {
        enabled: !!settings.enabled,
        inBlackout: blackout,
        recentlyActive: recent,
        cooldownLeftMin,
        budgetUsedMin,
        budgetCapMin,
        budgetExhausted,
      },
      mastery,
      now: now.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'auto-teach state failed', detail: String(err.message || err) });
  }
}
