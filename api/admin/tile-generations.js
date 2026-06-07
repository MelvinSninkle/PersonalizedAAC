// /api/admin/tile-generations — the per-tile QC gallery. lab-generate writes
// new rows; this endpoint reads/rates/deletes them.
//   GET    ?taxonomyId=                       list all gens for that tile
//   GET    ?taxonomyId=&styleGuideId=         filter to one style
//   PATCH  ?id=  { rating?, markedBest?, notes? }   star, rate, annotate
//   DELETE ?id=                                drop one gen + its blob
//   DELETE ?taxonomyId=                        drop ALL gens for that tile
import { del } from '@vercel/blob';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  try {
    const db = sql();
    if (req.method === 'GET')    return await list(req, res, db);
    if (req.method === 'PATCH')  return await patch(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

function rowOut(r) {
  return {
    id: r.id,
    taxonomyId: r.taxonomy_id,
    styleGuideId: r.style_guide_id,
    model: r.model,
    promptUsed: r.prompt_used,
    blobUrl: r.blob_url,
    blobKey: r.blob_key,
    rating: r.rating,
    markedBest: !!r.marked_best,
    notes: r.notes,
    costCents: r.cost_cents != null ? Number(r.cost_cents) : null,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function list(req, res, db) {
  const taxonomyId = String(req.query.taxonomyId || '').trim();
  const styleGuideId = parseInt(req.query.styleGuideId, 10);
  if (!taxonomyId) { res.status(400).json({ error: 'taxonomyId required' }); return; }
  const rows = styleGuideId
    ? await db`
        SELECT id, taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key,
               rating, marked_best, notes, cost_cents, created_by, created_at
        FROM tile_generations
        WHERE taxonomy_id = ${taxonomyId} AND style_guide_id = ${styleGuideId}
        ORDER BY created_at DESC`
    : await db`
        SELECT id, taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key,
               rating, marked_best, notes, cost_cents, created_by, created_at
        FROM tile_generations
        WHERE taxonomy_id = ${taxonomyId}
        ORDER BY created_at DESC`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ generations: rows.map(rowOut) });
}

async function patch(req, res, db) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const b = (typeof req.body === 'object' && req.body) || {};
  const fields = {};
  if (b.rating === null || (Number.isInteger(b.rating) && b.rating >= 0 && b.rating <= 5)) fields.rating = b.rating === null ? null : b.rating;
  if (typeof b.markedBest === 'boolean') fields.marked_best = b.markedBest;
  if (typeof b.notes === 'string' || b.notes === null) fields.notes = b.notes ? String(b.notes).slice(0, 600) : null;
  if (!Object.keys(fields).length) { res.status(400).json({ error: 'no fields to update' }); return; }

  // If markedBest is being turned on, clear it for the same (taxonomyId, styleGuideId) pair first.
  if (fields.marked_best === true) {
    const r0 = await db`SELECT taxonomy_id, style_guide_id FROM tile_generations WHERE id = ${id}`;
    if (r0.length) {
      const { taxonomy_id, style_guide_id } = r0[0];
      await db`UPDATE tile_generations SET marked_best = FALSE WHERE taxonomy_id = ${taxonomy_id} AND style_guide_id IS NOT DISTINCT FROM ${style_guide_id} AND id <> ${id}`;
    }
  }

  const r = await db`
    UPDATE tile_generations SET
      rating      = CASE WHEN ${'rating' in fields}      THEN ${fields.rating      ?? null}     ELSE rating      END,
      marked_best = COALESCE(${fields.marked_best ?? null}, marked_best),
      notes       = CASE WHEN ${'notes' in fields}       THEN ${fields.notes       ?? null}     ELSE notes       END
    WHERE id = ${id}
    RETURNING id, taxonomy_id, style_guide_id, model, prompt_used, blob_url, blob_key,
              rating, marked_best, notes, cost_cents, created_by, created_at
  `;
  if (!r.length) { res.status(404).json({ error: 'not found' }); return; }
  res.status(200).json({ ok: true, generation: rowOut(r[0]) });
}

async function remove(req, res, db) {
  const id = parseInt(req.query.id, 10);
  const taxonomyId = String(req.query.taxonomyId || '').trim();
  if (id) {
    const rows = await db`SELECT blob_key FROM tile_generations WHERE id = ${id}`;
    await db`DELETE FROM tile_generations WHERE id = ${id}`;
    if (rows[0] && rows[0].blob_key) { try { await del(rows[0].blob_key); } catch (_) {} }
    res.status(200).json({ ok: true, deleted: 1 });
    return;
  }
  if (taxonomyId) {
    const rows = await db`SELECT blob_key FROM tile_generations WHERE taxonomy_id = ${taxonomyId}`;
    await db`DELETE FROM tile_generations WHERE taxonomy_id = ${taxonomyId}`;
    for (const r of rows) { if (r.blob_key) { try { await del(r.blob_key); } catch (_) {} } }
    res.status(200).json({ ok: true, deleted: rows.length });
    return;
  }
  res.status(400).json({ error: 'id or taxonomyId required' });
}
