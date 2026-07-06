// GET /api/cron/run-tile-jobs — Vercel cron (every minute). Drains the durable
// add-tile queue: fresh jobs, jobs whose in-request render died mid-flight, and
// failed jobs with retries left. This is what makes server-side generation
// fool-proof — a tile lands even if the device that started it is long gone.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when configured; we
// accept anything when it's unset (the handler is idempotent and safe to re-run).
import { sql } from '../_lib/db.js';
import { ensureTileJobs, claimRunnableJobs, processTileJob } from '../_lib/tile-jobs.js';
import { ensureSeedJobs, claimSeedJobs, processSeedJob, makeSeedContext } from '../_lib/seed-board.js';

export const config = { maxDuration: 300 };

// Stop claiming new work past this point so in-flight jobs finish inside
// maxDuration instead of being killed mid-render (killed rows sit 'processing'
// for 5 minutes before reclaim — wasted time).
const TIME_BUDGET_MS = 230_000;

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (got !== expected) { res.status(401).json({ error: 'unauthorized' }); return; }
  }

  const started = Date.now();
  const overBudget = () => Date.now() - started > TIME_BUDGET_MS;

  try {
    const db = sql();
    await ensureTileJobs(db);
    await ensureSeedJobs(db);

    // 1) Parent-photo add-tile jobs (the original queue) — small fixed batch.
    const jobs = await claimRunnableJobs(db, 5);
    const results = [];
    for (const j of jobs) {
      const r = await processTileJob(db, Number(j.id));
      results.push({ id: Number(j.id), ok: r.ok, itemId: r.itemId || null, detail: r.detail || null });
    }

    // 2) Onboarding board builds. 'place' first (instant, unblocks everything),
    //    then personalized renders (slow, the visible magic), then voices
    //    (fast) — each loop respects the shared time budget so the minute-tick
    //    cadence keeps every queue moving.
    const seed = { placed: 0, rendered: 0, renderFailed: 0, voiced: 0, chips: 0, chipFailed: 0 };
    const getCtx = makeSeedContext(db);

    for (const j of await claimSeedJobs(db, 'place', 2)) {
      if (overBudget()) break;
      const r = await processSeedJob(db, j, getCtx);
      if (r.ok) seed.placed++;
    }
    while (!overBudget()) {
      const batch = await claimSeedJobs(db, 'render', 4);
      if (!batch.length) break;
      for (const j of batch) {
        if (overBudget()) break;
        const r = await processSeedJob(db, j, getCtx);
        if (r.ok) seed.rendered++; else seed.renderFailed++;
      }
    }
    while (!overBudget()) {
      const batch = await claimSeedJobs(db, 'voice', 25);
      if (!batch.length) break;
      for (const j of batch) {
        if (overBudget()) break;
        const r = await processSeedJob(db, j, getCtx);
        if (r.ok) seed.voiced++;
      }
    }
    // §6: folder-chip renders (personalize-all queues them for members).
    while (!overBudget()) {
      const batch = await claimSeedJobs(db, 'chip', 4);
      if (!batch.length) break;
      for (const j of batch) {
        if (overBudget()) break;
        const r = await processSeedJob(db, j, getCtx);
        if (r.ok) seed.chips++; else seed.chipFailed++;
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, ran: results.length, results, seed, ms: Date.now() - started });
  } catch (err) {
    res.status(500).json({ error: 'run-tile-jobs failed', detail: String(err.message || err) });
  }
}
