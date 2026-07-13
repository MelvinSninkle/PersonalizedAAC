// /api/parent/style?childId=<slug> — the parent-facing window into the art
// style machine. Every generated picture is drawn while looking at reference
// images; this endpoint lets a parent SEE those exact references, switch the
// board to another built-in style, or upload their own references for
// everything generated from now on.
//
//   GET                       → { styleGuide, styles }
//       styleGuide: the guide currently driving renders (resolution order:
//         child_settings.settings.styleGuideId → the child's own family guide
//         → null). Includes per-kind reference URLs (main / person / stuff).
//       styles: all active PUBLIC templates for the switcher.
//   GET ?image=<id>&kind=main|person|stuff
//       → streams that reference image. Gated: the guide must be a public
//         template or THIS child's own — never another family's.
//   POST { action: 'set', styleGuideId }
//       → point the child at a template (or back at their family guide).
//   POST { action: 'upload', kind: 'main'|'person'|'stuff', blobKey }
//       → set one reference on the child's OWN family guide (created as a
//         copy of the current style on first upload; blobKey comes from
//         /api/upload?kind=styleref). Applies to new pictures only.
//
// The upload never edits a PUBLIC template row — those are shared by every
// family (admin Lab owns them). Parents always fork into a child-scoped row.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { canAccessChild } from '../_lib/access.js';
import { readBlobBytes } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 20 };

const REF_KINDS = ['main', 'person', 'stuff'];

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = typeof req.query.childId === 'string' ? req.query.childId : '';
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) {
      res.status(403).json({ error: 'No access to this child' }); return;
    }

    if (req.method === 'GET' && req.query.image) return await streamRef(req, res, db, childId);
    if (req.method === 'GET') return await overview(req, res, db, childId);
    if (req.method === 'POST') return await act(req, res, db, childId, auth);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'style request failed', detail: String(err.message || err) });
  }
}

function refUrl(childId, guideId, kind) {
  return `/api/parent/style?childId=${encodeURIComponent(childId)}&image=${guideId}&kind=${kind}`;
}

function refsOut(childId, row) {
  return {
    main: row.blob_key ? refUrl(childId, row.id, 'main') : null,
    person: row.person_ref_key ? refUrl(childId, row.id, 'person') : null,
    stuff: row.stuff_ref_key ? refUrl(childId, row.id, 'stuff') : null,
  };
}

// The guide currently driving this child's renders — the SAME resolution
// loadChildStyleGuideId + loadStyleGuide use, so the panel never lies.
// Ownership-filtered: a stale pointer at another family's guide resolves as
// if unset instead of reading across families.
async function resolveCurrent(db, childId) {
  const cs = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
  const pinnedId = cs && cs.settings && cs.settings.styleGuideId ? Number(cs.settings.styleGuideId) : null;
  let row = null;
  if (pinnedId) {
    row = (await db`
      SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key, child_id
      FROM style_guides
      WHERE id = ${pinnedId} AND (child_id IS NULL OR child_id = ${childId})
      LIMIT 1`)[0] || null;
  }
  if (!row) {
    row = (await db`
      SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key, child_id
      FROM style_guides
      WHERE child_id = ${childId} AND active = TRUE
      ORDER BY ephemeral ASC, created_at DESC LIMIT 1`)[0] || null;
  }
  return row;
}

async function overview(req, res, db, childId) {
  const row = await resolveCurrent(db, childId);
  const templates = await db`
    SELECT id, label, description, blob_key, person_ref_key, stuff_ref_key
    FROM style_guides
    WHERE active = TRUE AND child_id IS NULL
    ORDER BY sort_order ASC, created_at ASC`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    styleGuide: row ? {
      id: Number(row.id),
      label: row.label,
      description: row.description || null,
      source: row.child_id ? 'family' : 'template',
      imageUrl: row.blob_key ? refUrl(childId, row.id, 'main') : null,
      refs: refsOut(childId, row),
    } : null,
    styles: templates.map(t => ({
      id: Number(t.id),
      label: t.label,
      description: t.description || null,
      // The switcher card shows the polished preview when the Lab set one.
      previewUrl: `/api/style-guides/public?image=${t.id}`,
      refs: refsOut(childId, t),
    })),
  });
}

async function streamRef(req, res, db, childId) {
  const id = parseInt(req.query.image, 10);
  const kind = REF_KINDS.includes(req.query.kind) ? req.query.kind : 'main';
  if (!id) { res.status(400).json({ error: 'image id required' }); return; }
  const row = (await db`
    SELECT blob_key, person_ref_key, stuff_ref_key
    FROM style_guides
    WHERE id = ${id} AND (child_id IS NULL OR child_id = ${childId})
    LIMIT 1`)[0];
  const key = row && (kind === 'person' ? row.person_ref_key : kind === 'stuff' ? row.stuff_ref_key : row.blob_key);
  if (!key) { res.status(404).json({ error: 'reference image not found' }); return; }
  const { buffer, contentType } = await readBlobBytes(key);
  res.setHeader('Content-Type', contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).send(buffer);
}

async function saveStylePointer(db, childId, styleGuideId) {
  const cur = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
  const settings = { ...((cur && cur.settings) || {}), styleGuideId };
  await db`
    INSERT INTO child_settings (child_id, settings, updated_at)
    VALUES (${childId}, ${JSON.stringify(settings)}::jsonb, NOW())
    ON CONFLICT (child_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`;
}

async function act(req, res, db, childId, auth) {
  const b = (typeof req.body === 'object' && req.body) || {};

  if (b.action === 'set') {
    const id = Number(b.styleGuideId);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'styleGuideId required' }); return; }
    const row = (await db`
      SELECT id FROM style_guides
      WHERE id = ${id} AND active = TRUE AND (child_id IS NULL OR child_id = ${childId})
      LIMIT 1`)[0];
    if (!row) { res.status(404).json({ error: 'style not found' }); return; }
    await saveStylePointer(db, childId, id);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, styleGuideId: id });
    return;
  }

  if (b.action === 'upload') {
    const kind = REF_KINDS.includes(b.kind) ? b.kind : null;
    const blobKey = typeof b.blobKey === 'string' ? b.blobKey.trim() : '';
    if (!kind) { res.status(400).json({ error: 'kind must be main|person|stuff' }); return; }
    // Only keys minted by /api/upload?kind=styleref are accepted — a parent
    // can never point their style at some other blob in the store.
    if (!/^styleref\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(blobKey)) {
      res.status(400).json({ error: 'blobKey must come from /api/upload?kind=styleref' }); return;
    }
    try { await readBlobBytes(blobKey); }
    catch (_) { res.status(400).json({ error: 'uploaded image not found' }); return; }

    // Fork-on-first-write: reuse the child's own family guide when one exists
    // (the style-regenerate flow creates the same row), else copy the current
    // style into a new child-scoped row. Public templates are never edited.
    let family = (await db`
      SELECT id FROM style_guides
      WHERE child_id = ${childId} AND ephemeral = FALSE
      ORDER BY created_at DESC LIMIT 1`)[0] || null;
    if (!family) {
      const cur = await resolveCurrent(db, childId);
      const rows = await db`
        INSERT INTO style_guides (label, description, blob_url, blob_key, person_ref_key, stuff_ref_key,
                                  active, sort_order, created_by, child_id, ephemeral)
        VALUES (${'Your family style'}, ${cur ? cur.description : null},
                ${cur && cur.blob_key ? `/api/media?key=${encodeURIComponent(cur.blob_key)}` : null},
                ${cur ? cur.blob_key : null}, ${cur ? cur.person_ref_key : null}, ${cur ? cur.stuff_ref_key : null},
                TRUE, 0, ${auth.user.email || null}, ${childId}, FALSE)
        RETURNING id`;
      family = rows[0];
    }
    if (kind === 'main') {
      await db`UPDATE style_guides SET blob_key = ${blobKey}, blob_url = ${`/api/media?key=${encodeURIComponent(blobKey)}`}, active = TRUE WHERE id = ${family.id}`;
    } else if (kind === 'person') {
      await db`UPDATE style_guides SET person_ref_key = ${blobKey}, active = TRUE WHERE id = ${family.id}`;
    } else {
      await db`UPDATE style_guides SET stuff_ref_key = ${blobKey}, active = TRUE WHERE id = ${family.id}`;
    }
    await saveStylePointer(db, childId, Number(family.id));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, styleGuideId: Number(family.id) });
    return;
  }

  res.status(400).json({ error: 'unknown action' });
}
