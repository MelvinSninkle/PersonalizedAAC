// Neon serverless SQL client. Single export for simplicity.
import { neon } from '@neondatabase/serverless';

let _sql = null;

export function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL env var not set');
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
    order: r.display_order == null ? 0 : Number(r.display_order),
    pinned: !!r.pinned,
  };
}
