// /api/admin/taxonomy — list / create / update / delete rows in the canonical
// taxonomy library (Section 17 of the PRD). Gated by the same admin token as
// the rest of the app; the audit log records "admin" as the actor until we
// have real user identities.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { savePromptVersion } from '../_lib/prompt-versions.js';

const ACTOR = 'admin';

const VALID_COLUMNS = new Set(['People', 'Nouns', 'Verbs', 'Needs', 'Events']);
const VALID_SUBJECT_MODES = new Set(['child_as_subject', 'object', 'person', 'concept']);
const VALID_PARENT_PHOTO = new Set(['override', 'supplement', 'none']);
const VALID_STATUS = new Set(['draft', 'published']);
const VALID_PHASES = new Set(['v1_core', 'v1_extended', 'v2', 'later']);
const VALID_GROWTH_STAGES = new Set(['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5plus']);
const VALID_ACQUISITION_AGES = new Set(['12-18m', '18-30m', '2-3y', '3-4y', '4y+']);
const VALID_MEAL = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'anytime']);
const VALID_GESTALT_TYPES = new Set(['compositional', 'category_holding', 'opaque']);
const VALID_AUDIENCE = new Set(['universal', 'parent', 'therapist', 'school_team', 'family']);
const VALID_AUTHORING_KIND = new Set(['canonical', 'personal_skeleton']);
const ID_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
// Helpers for the array fields stored as Postgres TEXT[].
function cleanStrArray(v, max = 24, itemMax = 400) {
  if (!Array.isArray(v)) return null;
  const out = v.map(x => (typeof x === 'string' ? x.trim().slice(0, itemMax) : '')).filter(Boolean);
  return out.slice(0, max);
}

function rowOut(r) {
  return {
    id: r.id,
    column: r.column_name,
    category: r.category,
    subcategory: r.subcategory,
    label: r.label,
    pronunciation: r.pronunciation,
    matchTerms: Array.isArray(r.match_terms) ? r.match_terms : [],
    promptTemplate: r.prompt_template,
    subjectMode: r.subject_mode,
    parentPhotoBehavior: r.parent_photo_behavior,
    phase: r.phase,
    core: r.core === undefined || r.core === null ? true : !!r.core,
    audience: r.audience || 'universal',
    authoringKind: r.authoring_kind || 'canonical',
    growthStage: r.growth_stage || null,
    acquisitionAge: r.acquisition_age || null,
    mealContext: r.meal_context || null,
    isGestalt: !!r.is_gestalt,
    gestaltType: r.gestalt_type || null,
    gestaltMeaning: r.gestalt_meaning || null,
    gestaltTargetWords: Array.isArray(r.gestalt_target_words) ? r.gestalt_target_words : [],
    descriptiveClues: Array.isArray(r.descriptive_clues) ? r.descriptive_clues : [],
    representationLevels: r.representation_levels || null,
    rolesPresent: Array.isArray(r.roles_present) ? r.roles_present : [],
    objectsPresent: Array.isArray(r.objects_present) ? r.objects_present : [],
    hasRelationship: !!r.has_relationship,
    relatedImages: Array.isArray(r.related_images) ? r.related_images : [],
    personalized: !!r.personalized,
    notes: r.notes,
    status: r.status,
    archived: !!r.archived,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    publishedAt: r.published_at,
  };
}

function validateRow(body, { partial }) {
  const errs = [];
  const out = {};
  if (!partial || body.id !== undefined) {
    if (typeof body.id !== 'string' || !ID_PATTERN.test(body.id)) errs.push('id must match [a-z0-9_]+(.[a-z0-9_]+)*');
    out.id = body.id;
  }
  if (!partial || body.column !== undefined) {
    if (!VALID_COLUMNS.has(body.column)) errs.push(`column must be one of ${[...VALID_COLUMNS].join(', ')}`);
    out.column = body.column;
  }
  if (!partial || body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) errs.push('label is required');
    out.label = (body.label || '').slice(0, 200);
  }
  if (!partial || body.promptTemplate !== undefined) {
    if (typeof body.promptTemplate !== 'string' || !body.promptTemplate.trim()) errs.push('promptTemplate is required');
    out.promptTemplate = body.promptTemplate || '';
  }
  if (!partial || body.subjectMode !== undefined) {
    if (!VALID_SUBJECT_MODES.has(body.subjectMode)) errs.push(`subjectMode must be one of ${[...VALID_SUBJECT_MODES].join(', ')}`);
    out.subjectMode = body.subjectMode;
  }
  if (!partial || body.parentPhotoBehavior !== undefined) {
    if (!VALID_PARENT_PHOTO.has(body.parentPhotoBehavior)) errs.push(`parentPhotoBehavior must be one of ${[...VALID_PARENT_PHOTO].join(', ')}`);
    out.parentPhotoBehavior = body.parentPhotoBehavior;
  }
  if (body.phase !== undefined) {
    if (!VALID_PHASES.has(body.phase)) errs.push(`phase must be one of ${[...VALID_PHASES].join(', ')}`);
    out.phase = body.phase;
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status)) errs.push(`status must be one of ${[...VALID_STATUS].join(', ')}`);
    out.status = body.status;
  }
  if (body.category !== undefined)      out.category = body.category ? String(body.category).slice(0, 100) : null;
  if (body.subcategory !== undefined)   out.subcategory = body.subcategory ? String(body.subcategory).slice(0, 100) : null;
  if (body.pronunciation !== undefined) out.pronunciation = body.pronunciation ? String(body.pronunciation).slice(0, 200) : null;
  if (body.matchTerms !== undefined) out.matchTerms = cleanStrArray(body.matchTerms, 24, 60);
  if (body.notes !== undefined)         out.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  if (body.core !== undefined)          out.core = !!body.core;
  if (body.archived !== undefined)      out.archived = !!body.archived;
  if (body.growthStage !== undefined) {
    const v = body.growthStage;
    if (v !== null && !VALID_GROWTH_STAGES.has(v)) errs.push(`growthStage must be one of ${[...VALID_GROWTH_STAGES].join(', ')} or null`);
    out.growthStage = v || null;
  }
  if (body.mealContext !== undefined) {
    const v = body.mealContext;
    if (v !== null && !VALID_MEAL.has(v)) errs.push(`mealContext must be one of ${[...VALID_MEAL].join(', ')} or null`);
    out.mealContext = v || null;
  }
  if (body.isGestalt !== undefined)        out.isGestalt = !!body.isGestalt;
  if (body.gestaltType !== undefined) {
    const v = body.gestaltType;
    if (v !== null && !VALID_GESTALT_TYPES.has(v)) errs.push(`gestaltType must be one of ${[...VALID_GESTALT_TYPES].join(', ')} or null`);
    out.gestaltType = v || null;
  }
  if (body.gestaltMeaning !== undefined)      out.gestaltMeaning = body.gestaltMeaning ? String(body.gestaltMeaning).slice(0, 2000) : null;
  if (body.gestaltTargetWords !== undefined)  out.gestaltTargetWords = cleanStrArray(body.gestaltTargetWords, 24, 80);
  if (body.descriptiveClues !== undefined)    out.descriptiveClues = cleanStrArray(body.descriptiveClues, 12, 400);
  if (body.representationLevels !== undefined) out.representationLevels = body.representationLevels || null;
  if (body.rolesPresent !== undefined)    out.rolesPresent = cleanStrArray(body.rolesPresent, 12, 40);
  if (body.objectsPresent !== undefined)  out.objectsPresent = cleanStrArray(body.objectsPresent, 24, 80);
  if (body.relatedImages !== undefined)   out.relatedImages = cleanStrArray(body.relatedImages, 24, 120);
  if (body.hasRelationship !== undefined) out.hasRelationship = !!body.hasRelationship;
  if (body.personalized !== undefined)    out.personalized = !!body.personalized;
  if (body.audience !== undefined) {
    if (!VALID_AUDIENCE.has(body.audience)) errs.push(`audience must be one of ${[...VALID_AUDIENCE].join(', ')}`);
    out.audience = body.audience;
  }
  if (body.authoringKind !== undefined) {
    if (!VALID_AUTHORING_KIND.has(body.authoringKind)) errs.push(`authoringKind must be one of ${[...VALID_AUTHORING_KIND].join(', ')}`);
    out.authoringKind = body.authoringKind;
  }
  return { ok: errs.length === 0, errors: errs, value: out };
}

async function audit(db, action, rowIds, summary, note) {
  try {
    await db`
      INSERT INTO taxonomy_audit (actor, action, row_ids, summary, note)
      VALUES (${ACTOR}, ${action}, ${rowIds && rowIds.length ? rowIds : null}, ${summary || null}, ${note || null})
    `;
  } catch (_) { /* audit failures don't block the request */ }
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  try {
    const db = sql();
    if (req.method === 'GET')    return await list(req, res, db);
    if (req.method === 'POST')   return await create(req, res, db);
    if (req.method === 'PUT')    return await update(req, res, db);
    if (req.method === 'DELETE') return await remove(req, res, db);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function list(req, res, db) {
  // No server-side filtering yet; for v1 we ship everything and let the client
  // (Tabulator) do filtering/sorting/search in memory. Add server filters once
  // the library outgrows a few thousand rows.
  const rows = await db`
    SELECT * FROM taxonomy
    ORDER BY column_name, category NULLS FIRST, subcategory NULLS FIRST, label
  `;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ rows: rows.map(rowOut) });
}

async function create(req, res, db) {
  const { ok, errors, value } = validateRow(req.body || {}, { partial: false });
  if (!ok) { res.status(400).json({ error: 'Invalid', detail: errors }); return; }

  const existing = await db`SELECT id FROM taxonomy WHERE id = ${value.id}`;
  if (existing.length) { res.status(409).json({ error: 'id already exists' }); return; }

  const rows = await db`
    INSERT INTO taxonomy (
      id, column_name, category, subcategory, label, pronunciation, match_terms,
      prompt_template, subject_mode, parent_photo_behavior, phase, core, notes, acquisition_age,
      growth_stage, meal_context, is_gestalt, gestalt_type, gestalt_meaning,
      gestalt_target_words, descriptive_clues, representation_levels,
      roles_present, objects_present, has_relationship, related_images, personalized,
      audience, authoring_kind,
      status, archived, created_by, updated_by
    ) VALUES (
      ${value.id}, ${value.column}, ${value.category ?? null}, ${value.subcategory ?? null},
      ${value.label}, ${value.pronunciation ?? null}, ${value.matchTerms ?? null},
      ${value.promptTemplate}, ${value.subjectMode}, ${value.parentPhotoBehavior},
      ${value.phase ?? 'v1_core'}, ${value.core === undefined ? true : value.core}, ${value.notes ?? null}, ${value.acquisitionAge ?? null},
      ${value.growthStage ?? null}, ${value.mealContext ?? null},
      ${value.isGestalt ?? false}, ${value.gestaltType ?? null}, ${value.gestaltMeaning ?? null},
      ${value.gestaltTargetWords ?? null}, ${value.descriptiveClues ?? null},
      ${value.representationLevels == null ? null : JSON.stringify(value.representationLevels)}::jsonb,
      ${value.rolesPresent ?? null}, ${value.objectsPresent ?? null}, ${value.hasRelationship ?? false}, ${value.relatedImages ?? null}, ${value.personalized ?? false},
      ${value.audience ?? 'universal'}, ${value.authoringKind ?? 'canonical'},
      ${value.status ?? 'draft'}, ${value.archived ?? false},
      ${ACTOR}, ${ACTOR}
    )
    RETURNING *
  `;
  await audit(db, 'create', [value.id], `created ${value.id}`);
  res.status(200).json(rowOut(rows[0]));
}

async function update(req, res, db) {
  const id = String(req.query.id || '');
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const current = await db`SELECT * FROM taxonomy WHERE id = ${id}`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  const { ok, errors, value } = validateRow(req.body || {}, { partial: true });
  if (!ok) { res.status(400).json({ error: 'Invalid', detail: errors }); return; }

  // Renaming the id is a structural change. We allow it (it's a single
  // PRIMARY KEY field) but it'll break any downstream references. The
  // workbench warns the user before posting an id change.
  const newId = value.id && value.id !== old.id ? value.id : old.id;
  if (newId !== old.id) {
    const collision = await db`SELECT id FROM taxonomy WHERE id = ${newId}`;
    if (collision.length) { res.status(409).json({ error: 'target id already exists' }); return; }
  }

  // Preserve the prior prompt before we overwrite it, so a hand-tuned prompt is
  // always recoverable (single-edit path; the bulk import path does the same).
  if (value.promptTemplate !== undefined && value.promptTemplate !== old.prompt_template) {
    await savePromptVersion(db, old.id, old.prompt_template, { by: ACTOR, source: 'edit' });
  }

  // Apply: every field that was sent gets written, others left alone.
  const willPublish = value.status === 'published' && old.status !== 'published';

  const rows = await db`
    UPDATE taxonomy SET
      id                     = ${newId},
      column_name            = ${value.column                ?? old.column_name},
      category               = ${value.category              !== undefined ? value.category              : old.category},
      subcategory            = ${value.subcategory           !== undefined ? value.subcategory           : old.subcategory},
      label                  = ${value.label                 ?? old.label},
      pronunciation          = ${value.pronunciation         !== undefined ? value.pronunciation         : old.pronunciation},
      match_terms            = ${value.matchTerms            !== undefined ? value.matchTerms            : old.match_terms},
      prompt_template        = ${value.promptTemplate        ?? old.prompt_template},
      subject_mode           = ${value.subjectMode           ?? old.subject_mode},
      parent_photo_behavior  = ${value.parentPhotoBehavior   ?? old.parent_photo_behavior},
      phase                  = ${value.phase                 ?? old.phase},
      core                   = ${value.core                  !== undefined ? value.core                  : old.core},
      notes                  = ${value.notes                 !== undefined ? value.notes                 : old.notes},
      growth_stage           = ${value.growthStage           !== undefined ? value.growthStage           : old.growth_stage},
      acquisition_age        = ${value.acquisitionAge        !== undefined ? value.acquisitionAge        : old.acquisition_age},
      meal_context           = ${value.mealContext           !== undefined ? value.mealContext           : old.meal_context},
      is_gestalt             = ${value.isGestalt             !== undefined ? value.isGestalt             : old.is_gestalt},
      gestalt_type           = ${value.gestaltType           !== undefined ? value.gestaltType           : old.gestalt_type},
      gestalt_meaning        = ${value.gestaltMeaning        !== undefined ? value.gestaltMeaning        : old.gestalt_meaning},
      gestalt_target_words   = ${value.gestaltTargetWords    !== undefined ? value.gestaltTargetWords    : old.gestalt_target_words},
      descriptive_clues      = ${value.descriptiveClues      !== undefined ? value.descriptiveClues      : old.descriptive_clues},
      representation_levels  = ${value.representationLevels  !== undefined ? (value.representationLevels == null ? null : JSON.stringify(value.representationLevels)) : (old.representation_levels == null ? null : JSON.stringify(old.representation_levels))}::jsonb,
      roles_present          = ${value.rolesPresent          !== undefined ? value.rolesPresent          : old.roles_present},
      objects_present        = ${value.objectsPresent        !== undefined ? value.objectsPresent        : old.objects_present},
      has_relationship       = ${value.hasRelationship       !== undefined ? value.hasRelationship       : old.has_relationship},
      related_images         = ${value.relatedImages         !== undefined ? value.relatedImages         : old.related_images},
      personalized           = ${value.personalized          !== undefined ? value.personalized          : old.personalized},
      audience               = ${value.audience              ?? old.audience},
      authoring_kind         = ${value.authoringKind         ?? old.authoring_kind},
      status                 = ${value.status                ?? old.status},
      archived               = ${value.archived              !== undefined ? value.archived              : old.archived},
      updated_at             = NOW(),
      updated_by             = ${ACTOR},
      published_at           = ${willPublish ? new Date().toISOString() : old.published_at}
    WHERE id = ${id}
    RETURNING *
  `;
  const summary = newId !== old.id ? `renamed ${old.id} → ${newId}` : `updated ${old.id}`;
  await audit(db, willPublish ? 'publish' : 'update', [newId], summary);
  res.status(200).json(rowOut(rows[0]));
}

async function remove(req, res, db) {
  const id = String(req.query.id || '');
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const rows = await db`DELETE FROM taxonomy WHERE id = ${id} RETURNING id`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  await audit(db, 'delete', [id], `deleted ${id}`);
  res.status(200).json({ ok: true });
}
