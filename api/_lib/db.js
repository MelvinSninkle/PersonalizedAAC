// Neon serverless SQL client. Single export for simplicity.
import { neon } from '@neondatabase/serverless';

let _sql = null;

// Vercel's Neon marketplace integration sets several variants; accept any of
// them so users don't have to manually duplicate env vars.
function resolveDatabaseUrl() {
  return process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_PRISMA_URL
    || process.env.POSTGRES_URL_NON_POOLING
    || process.env.DATABASE_URL_UNPOOLED
    || '';
}

export function sql() {
  if (_sql) return _sql;
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error('No Postgres URL found (checked DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING, DATABASE_URL_UNPOOLED)');
  }
  _sql = neon(url);
  return _sql;
}

// Map a DB row (snake_case) into the shape the client expects (camelCase).
// `childId` and `ownerUserId` are carried so client UIs can distinguish
// child-scoped content (childId set) from therapist-owned templates
// (childId null, ownerUserId set) and gate edits accordingly.
export function rowToCategory(r) {
  return {
    id: Number(r.id),
    section: r.section,
    label: r.label,
    displayLabel: r.display_label || null,
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    imageUrl: r.image_url,
    imageKey: r.image_key,
    keepAspect: !!r.keep_aspect,
    order: r.display_order == null ? 0 : Number(r.display_order),
    childId: r.child_id || null,
    ownerUserId: r.owner_user_id == null ? null : Number(r.owner_user_id),
    taxonomySlug: r.taxonomy_slug || null,
    kind: r.kind || null,
  };
}

export function rowToItem(r) {
  return {
    id: Number(r.id),
    section: r.section,
    categoryId: r.category_id == null ? null : Number(r.category_id),
    label: r.label,
    displayLabel: r.display_label || null,
    matchTerms: Array.isArray(r.match_terms_out) ? r.match_terms_out : undefined,
    imageUrl: r.image_url,
    imageKey: r.image_key,
    soundUrl: r.sound_url,
    soundKey: r.sound_key,
    keepAspect: !!r.keep_aspect,
    order: r.display_order == null ? 0 : Number(r.display_order),
    pinned: !!r.pinned,
    childId: r.child_id || null,
    ownerUserId: r.owner_user_id == null ? null : Number(r.owner_user_id),
    taxonomySlug: r.taxonomy_slug || null,
    description: r.description || null,
    descriptions: Array.isArray(r.descriptions) ? r.descriptions : null,
    // Taxonomy teaching clues (attached in /api/sync) — spoken by "Teach me".
    descriptiveClues: Array.isArray(r.descriptive_clues) && r.descriptive_clues.length ? r.descriptive_clues : null,
    needsReview: !!r.needs_review,
  };
}

/// Record that a FAMILY deliberately arranged this board (a parent dragged
/// tiles or folders into their own order). The Lab's "Publish to boards"
/// layout push reads this stamp and SKIPS the board unless the admin ticks
/// the explicit overwrite override — a family's chosen order is theirs.
/// Best-effort: a stamp failure must never fail the reorder itself.
export async function stampLayoutCustomized(db, childId) {
  if (!childId) return;
  try {
    const cur = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const settings = { ...((cur && cur.settings) || {}), layoutCustomizedAt: new Date().toISOString() };
    await db`INSERT INTO child_settings (child_id, settings, updated_at)
             VALUES (${childId}, ${JSON.stringify(settings)}::jsonb, NOW())
             ON CONFLICT (child_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`;
  } catch (_) {}
}
