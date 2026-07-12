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

    // Re-open DONE jobs whose tile no longer has what the job made. The dedup
    // key (child, kind, taxonomy) means a completed job never re-runs — which
    // was unrecoverable when a board was wiped/re-placed after the build:
    // items came back artless, every job read "done", and this rescue had
    // nothing to re-arm (the "926 placed, 0 queued, board still blank" trap).
    // A tile whose image is NULL/empty or still the shared default fallback
    // gets its render re-queued; a tile with no recorded audio gets its voice
    // re-queued. Idempotent: healthy tiles match nothing.
    const reopenedRenders = await db`
      UPDATE seed_jobs sj SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW()
      FROM items i
      WHERE sj.child_id = ${childId} AND sj.kind = 'render' AND sj.status = 'done'
        AND i.child_id = sj.child_id AND i.taxonomy_slug = sj.taxonomy_id
        AND (i.image_key IS NULL OR i.image_key = '' OR i.image_key LIKE 'taxonomy-defaults/%')
      RETURNING sj.id`;
    const reopenedVoices = await db`
      UPDATE seed_jobs sj SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW()
      FROM items i
      WHERE sj.child_id = ${childId} AND sj.kind = 'voice' AND sj.status = 'done'
        AND i.child_id = sj.child_id AND i.taxonomy_slug = sj.taxonomy_id
        AND (i.sound_key IS NULL OR i.sound_key = '')
      RETURNING sj.id`;

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
      reopenedRenders: reopenedRenders.length,
      reopenedVoices: reopenedVoices.length,
      status,
      note: `Placed ${build.placed}/${build.total} words; queued ${build.renders} renders + ${build.voices} voices; re-armed ${rearmed.length} dead jobs; re-opened ${reopenedRenders.length} art-less renders + ${reopenedVoices.length} silent voices. The cron finishes the rest server-side.${gateNote}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'build-board failed', detail: String(err.message || err) });
  }
}
