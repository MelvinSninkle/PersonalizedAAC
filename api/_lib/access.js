// Child-access + content-ownership helpers, shared by the data endpoints.
//
// Access model:
//   - admin            → every child.
//   - parent/therapist → the children they have an ACTIVE row for in child_access.
//
// Ownership model (categories.owner_user_id / items.owner_user_id):
//   - NULL  = shared "parent board" content — editable by the child's parent (or admin).
//   - <uid> = therapist-owned "custom board" content — editable only by that user.
//
// NOTE: these helpers are the building blocks; wiring them into every endpoint
// (sync, items, categories, analytics, live, child-settings…) is a deliberate
// follow-up so it can be tested carefully without breaking the live board.
import { sql } from './db.js';

export async function accessibleChildIds(user, db = sql()) {
  if (!user) return [];
  if (user.role === 'admin') {
    const rows = await db`
      SELECT child_id FROM (
        SELECT child_id FROM child_access
        UNION SELECT DISTINCT child_id FROM categories
        UNION SELECT DISTINCT child_id FROM items
      ) t WHERE child_id IS NOT NULL`;
    return rows.map(r => r.child_id);
  }
  if (user.id == null) return [];
  const rows = await db`SELECT child_id FROM child_access WHERE user_id = ${user.id} AND status = 'active'`;
  return rows.map(r => r.child_id);
}

export async function canAccessChild(user, childId, db = sql()) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.id == null) return false;
  const rows = await db`
    SELECT 1 FROM child_access
    WHERE user_id = ${user.id} AND child_id = ${childId} AND status = 'active' LIMIT 1`;
  return rows.length > 0;
}

// Can this user edit/delete a piece of content with the given owner_user_id?
export function canEditContent(user, ownerUserId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ownerUserId == null) return user.role === 'parent';                 // shared board → parent owns it
  return user.id != null && Number(ownerUserId) === Number(user.id);      // custom board → only its owner
}
