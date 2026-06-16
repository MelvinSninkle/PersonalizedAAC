// GET /api/cron/run-tile-jobs — Vercel cron (every minute). Drains the durable
// add-tile queue: fresh jobs, jobs whose in-request render died mid-flight, and
// failed jobs with retries left. This is what makes server-side generation
// fool-proof — a tile lands even if the device that started it is long gone.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when configured; we
// accept anything when it's unset (the handler is idempotent and safe to re-run).
import { sql } from '../_lib/db.js';
import { ensureTileJobs, claimRunnableJobs, processTileJob } from '../_lib/tile-jobs.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
    if (got !== expected) { res.status(401).json({ error: 'unauthorized' }); return; }
  }

  try {
    const db = sql();
    await ensureTileJobs(db);
    // Process a handful per tick so one run stays well inside maxDuration. The
    // next minute's tick picks up the rest, so a big bulk import drains steadily.
    const jobs = await claimRunnableJobs(db, 5);
    const results = [];
    for (const j of jobs) {
      const r = await processTileJob(db, Number(j.id));
      results.push({ id: Number(j.id), ok: r.ok, itemId: r.itemId || null, detail: r.detail || null });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, ran: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'run-tile-jobs failed', detail: String(err.message || err) });
  }
}
