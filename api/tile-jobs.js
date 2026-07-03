// /api/tile-jobs — the durable, server-side add-tile pipeline.
//
//   POST ?childId=&label=&detail=&section=&categoryId=&style=&styleGuideId=
//        &model=&bg=&keepAspect=&needsReview=&emotion=   body = raw photo bytes
//     Stores the photo durably, creates a job, and returns its id immediately —
//     the photo is now SAFE no matter what happens to the device. Fires a best-
//     effort render right away; the cron (/api/cron/run-tile-jobs) guarantees the
//     tile lands even if this request (or the device) dies.
//   GET ?childId=    list this child's recent/active jobs for the tray.
//   DELETE ?id=      drop a job (and its blobs); leaves any created tile alone.
//
// Auth-gated; the heavy lifting (describe → style-consistent art → voice →
// create tile) lives in _lib/tile-jobs.js and runs server-side.
import { put, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { ensureTileJobs, processTileJob } from './_lib/tile-jobs.js';
import { chargeForGeneration, COST } from './_lib/credits.js';

export const config = { api: { bodyParser: false }, maxDuration: 300 };

const MAX_BYTES = 5 * 1024 * 1024;

function qs(req, k) { return req.query && req.query[k] != null ? String(req.query[k]) : ''; }
function qbool(req, k) { const v = qs(req, k).toLowerCase(); return v === '1' || v === 'true'; }
function qint(req, k) { const n = parseInt(qs(req, k), 10); return Number.isFinite(n) ? n : null; }

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();
  try { await ensureTileJobs(db); } catch (_) {}

  const childId = String(qs(req, 'childId') || 'fletcherpeterson').slice(0, 64);
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  // ── List ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const rows = await db`
        SELECT id, status, label, item_id, image_key, art_failed, needs_review, error, attempts, created_at, updated_at
        FROM tile_jobs
        WHERE child_id = ${childId}
          AND (status <> 'done' OR updated_at > NOW() - INTERVAL '1 hour')
        ORDER BY created_at DESC
        LIMIT 50`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ jobs: rows.map(j => ({
        id: Number(j.id), status: j.status, label: j.label, itemId: j.item_id ? Number(j.item_id) : null,
        imageKey: j.image_key || null,
        artFailed: !!j.art_failed, needsReview: !!j.needs_review, error: j.error, attempts: j.attempts,
        createdAt: j.created_at, updatedAt: j.updated_at,
      })) });
    } catch (err) { res.status(500).json({ error: 'List failed', detail: String(err.message || err) }); }
    return;
  }

  // ── Cancel / remove ─────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = qint(req, 'id');
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    try {
      const rows = await db`SELECT source_key, image_key, sound_key FROM tile_jobs WHERE id = ${id} AND child_id = ${childId}`;
      await db`DELETE FROM tile_jobs WHERE id = ${id} AND child_id = ${childId}`;
      for (const k of [rows[0]?.source_key, rows[0]?.image_key, rows[0]?.sound_key]) {
        if (k) { try { await del(k); } catch (_) {} }
      }
      res.status(200).json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Delete failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Credits: a photo-to-tile render is one nano-banana image = 1 credit.
  // A PERSON runs the keystone-portrait pipeline (best likeness model) =
  // COST.person, same as the web family flow. Charged at enqueue; admins exempt.
  {
    const isPerson = String(qs(req, 'section') || '').toLowerCase() === 'people';
    const credits = isPerson ? COST.person : COST.nano;
    const charge = await chargeForGeneration(db, auth.user, { credits, reason: isPerson ? 'tile:person' : 'tile:photo', ref: childId });
    if (!charge.ok) {
      res.status(402).json({ error: 'not_enough_credits', needed: credits, balance: charge.balance,
                             detail: isPerson
                               ? 'A family-member portrait uses 5 credits (it runs on our best likeness model). Add credits in the store and try again.'
                               : 'Making a tile from a photo uses 1 credit. Add credits in the store and try again.' });
      return;
    }
  }

  // ── Enqueue (durable) ───────────────────────────────────────────────────────
  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large', max: MAX_BYTES }); return; }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) { res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return; }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }

  const contentType = req.headers['content-type'] || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  let id;
  try {
    // Persist the raw photo FIRST — this is the durability guarantee.
    const sourceKey = `tile-jobs/${childId}/source/${randomUUID()}.${ext}`;
    await put(sourceKey, buffer, { access: 'private', contentType, addRandomSuffix: false });

    const rows = await db`
      INSERT INTO tile_jobs
        (child_id, actor_email, status, source_key, source_content_type, label, detail, section,
         category_id, style, style_guide_id, model, bg, keep_aspect, needs_review, emotion, relationship)
      VALUES
        (${childId}, ${auth.user.email || null}, 'queued', ${sourceKey}, ${contentType},
         ${qs(req, 'label').slice(0, 80) || null}, ${qs(req, 'detail').slice(0, 200) || null},
         ${qs(req, 'section') || null}, ${qint(req, 'categoryId')},
         ${qs(req, 'style').slice(0, 80) || null}, ${qint(req, 'styleGuideId')},
         ${qs(req, 'model').slice(0, 60) || null}, ${qs(req, 'bg').slice(0, 16) || null},
         ${qbool(req, 'keepAspect')}, ${qbool(req, 'needsReview')}, ${qs(req, 'emotion') || 'default'},
         ${qs(req, 'relationship').slice(0, 40) || null})
      RETURNING id`;
    id = Number(rows[0].id);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Enqueue failed', detail: String(err.message || err) });
    return;
  }

  // Device is free immediately; the photo is safe.
  res.status(200).json({ id, status: 'queued' });
  // Best-effort immediate render. If this request is frozen/killed after the
  // response, the cron picks the job up (still 'queued'/'processing') and finishes
  // it — so completion never depends on this call surviving.
  processTileJob(db, id).catch(() => {});
}
