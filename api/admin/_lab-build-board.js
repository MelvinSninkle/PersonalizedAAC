// POST /api/admin/lab?action=build-board  { childId }   (admin only)
//
// The RESCUE for the onboarding board-build: run the whole pipeline for any
// child by slug, no matter where their onboarding got stuck. Idempotent:
//   - places every in-scope word (categories + items; never moves a tile the
//     parent re-organized, never touches an existing image),
//   - enqueues any missing render/voice seed jobs,
//   - re-arms every dead job (failed with no retries left) so the cron takes
//     another pass at it.
// Placement is DB-only so the full board fits in one call; the renders/voices
// drain server-side via /api/cron/run-tile-jobs.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureSeedJobs, buildBoard, seedStatus, MAX_SEED_ATTEMPTS } from '../_lib/seed-board.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || (req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    await ensureSeedJobs(db);

    // Re-arm dead jobs so the cron retries them from scratch.
    const rearmed = await db`
      UPDATE seed_jobs SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW()
      WHERE child_id = ${childId} AND status = 'failed' AND attempts >= ${MAX_SEED_ATTEMPTS}
      RETURNING id`;

    const build = await buildBoard(db, childId);
    const status = await seedStatus(db, childId);

    // Say WHY when renders were skipped — the silent free-tier downgrade is
    // indistinguishable from "nothing happened" without this.
    const gateNote = build.personalRenders === false
      ? ` ⚠️ PERSONAL RENDERS SKIPPED — the family's tier is ${build.ownerTier}; seed jobs queued voice-only. Comp them a tier (admin Usage table) and rebuild to render in their style; the shared default art still applies via sync.`
      : '';
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, childId,
      placed: build.placed, placeFailed: build.failed, totalWords: build.total,
      newRenderJobs: build.renders, newVoiceJobs: build.voices,
      personalRenders: build.personalRenders !== false,
      ownerTier: build.ownerTier || null,
      rearmedJobs: rearmed.length,
      status,
      note: `Placed ${build.placed}/${build.total} words; queued ${build.renders} renders + ${build.voices} voices; re-armed ${rearmed.length} dead jobs. The cron finishes the rest server-side.${gateNote}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'build-board failed', detail: String(err.message || err) });
  }
}
