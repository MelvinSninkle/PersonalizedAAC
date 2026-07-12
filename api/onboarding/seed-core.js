// /api/onboarding/seed-core — build the child's starter board.
//
//   POST ?g=<chunk>   Instant PLACEMENT: every in-scope word lands on the board
//                     (categories + items) with NO image generation — default-
//                     able tiles resolve to the shared generic image at sync
//                     time, everything else shows as a word-tile. On the final
//                     chunk the durable seed_jobs are enqueued: per-child
//                     renders for core/needs + all verbs, and the child's voice
//                     for the rest. The cron drains those server-side, so the
//                     board finishes building even if the parent closes the tab.
//                     Chunked + resumable: returns { done, nextG, total, placed }.
//   GET  ?childId=    Progress for the board banner / parent dashboard:
//                     { active, place, render, voice } (see seedStatus).
//
// The old version generated every image inline across many 300s calls; the
// pipeline now separates instant placement from durable background generation.
import { checkAuth } from '../_lib/auth.js';
import { canAccessChild } from '../_lib/access.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, setStep } from '../_lib/onboarding.js';
import { ensureSeedJobs, placementRows, placeChunk, enqueueSeedJobs, seedStatus } from '../_lib/seed-board.js';

export const config = { maxDuration: 300 };

// Words placed per POST. Placement is DB-only (~2 quick queries per word), so a
// chunk clears in a few seconds and the whole board in a handful of calls.
const PLACE_BUDGET = 100;

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();

  // ── GET: progress for banners ─────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const childId = String((req.query && req.query.childId) || '').slice(0, 64);
      if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
      if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      await ensureSeedJobs(db);
      const s = await seedStatus(db, childId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, ...s });
    } catch (err) {
      res.status(500).json({ error: 'seed status failed', detail: String(err.message || err) });
    }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // ── POST op=refresh: parent-facing self-rescue ────────────────────────────
  // The same repair the admin Build-board tool runs, minus admin: re-arm dead
  // jobs and re-open done-but-artless renders / silent voices for THIS child,
  // so a parent whose build stumbled can fix it with one tap instead of
  // emailing support. Idempotent and spend-free — it only re-queues work the
  // family was already entitled to; the cron does the rest.
  {
    const b = (typeof req.body === 'object' && req.body) || {};
    if (b.op === 'refresh') {
      try {
        const childId = String(b.childId || (req.query && req.query.childId) || '').slice(0, 64).trim();
        if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
        if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
        await ensureSeedJobs(db);
        const rearmed = await db`
          UPDATE seed_jobs SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW()
          WHERE child_id = ${childId} AND status = 'failed'
          RETURNING id`;
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
        const status = await seedStatus(db, childId);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ ok: true, refreshed: true,
          rearmed: rearmed.length,
          reopenedRenders: reopenedRenders.length,
          reopenedVoices: reopenedVoices.length,
          ...status });
      } catch (err) {
        res.status(500).json({ error: 'refresh failed', detail: String(err.message || err) });
      }
      return;
    }
  }

  try {
    const p = await ensureProgress(db, auth.user);
    const childId = p.child_id;
    const startG = Math.max(0, parseInt((req.query && req.query.g) || '0', 10) || 0);
    await ensureSeedJobs(db);

    const rows = await placementRows(db);
    const total = rows.length;
    const slice = rows.slice(startG * PLACE_BUDGET, (startG + 1) * PLACE_BUDGET);
    const doneAll = (startG + 1) * PLACE_BUDGET >= total;

    const catCache = new Map();
    const { placed, failed } = await placeChunk({ db, childId, rows: slice, catCache });

    const priorSeeded = Number((p.data && p.data.seededCount) || 0);
    const seededTotal = priorSeeded + placed;
    let queued = { renders: 0, voices: 0 };
    if (doneAll) {
      // Enqueue the durable background jobs once, over the FULL row set.
      queued = await enqueueSeedJobs(db, childId, rows);
      await setStep(db, Number(auth.user.uid), 'complete', { seededCount: seededTotal });
    } else {
      await setStep(db, Number(auth.user.uid), 'seed_core', { seededCount: seededTotal, seedNextG: startG + 1 });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      done: doneAll,
      step: doneAll ? 'complete' : 'seed_core',
      nextG: startG + 1,
      total,
      placed,
      failed,
      seededCount: seededTotal,
      rendersQueued: queued.renders,
      voicesQueued: queued.voices,
      // Legacy fields (older native builds decode these):
      queuedCount: placed,
      slugs: [],
      message: null,
    });
  } catch (err) {
    res.status(500).json({ error: 'seed-core failed', detail: String(err.message || err) });
  }
}
