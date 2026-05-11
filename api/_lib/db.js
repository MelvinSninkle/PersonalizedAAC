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
export function rowToCategory(r) {
  return {
    id: Number(r.id),
    section: r.section,
    label: r.label,
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    imageUrl: r.image_url,
    imageKey: r.image_key,
    keepAspect: !!r.keep_aspect,
    order: r.display_order == null ? 0 : Number(r.display_order),
  };
}

export function rowToItem(r) {
  return {
    id: Number(r.id),
    section: r.section,
    categoryId: r.category_id == null ? null : Number(r.category_id),
    label: r.label,
    imageUrl: r.image_url,
    imageKey: r.image_key,
    soundUrl: r.sound_url,
    soundKey: r.sound_key,
    keepAspect: !!r.keep_aspect,
    order: r.display_order == null ? 0 : Number(r.display_order),
    pinned: !!r.pinned,
  };
}
