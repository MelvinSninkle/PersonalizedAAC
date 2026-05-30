// Child-access + content-ownership helpers, shared by the data endpoints.
//
// Access model:
//   - admin            → every child.
//   - parent/therapist → the children they have an ACTIVE row for in child_access.
//
// Ownership + edit model (trust-the-therapist, parent has override):
//   - categories.owner_user_id / items.owner_user_id
//   - NULL  = shared "parent board" content. Editable by the child's parent(s) +
//             admin only.
//   - <uid> = therapist-owned "custom board" content. Editable by:
//             • its owner (the therapist who made it)        — they manage their boards
//             • a parent of that child                       — override: a parent can
//                                                              delete/remove a therapist
//                                                              board without the therapist's
//                                                              involvement
//             • admin
//             The child can always see and use it (rendering is unaffected by
//             owner_user_id). Therapist content appears on the child's board the
//             moment it's created — no parent approval gate.
import { sql } from './db.js';

export async function accessibleChildIds(user, db = sql()) {
  if (!user) return [];
  if (user.role === 'admin') {
    try {
      const rows = await db`
        SELECT child_id FROM (
          SELECT child_id FROM child_access
          UNION SELECT DISTINCT child_id FROM categories
          UNION SELECT DISTINCT child_id FROM items
        ) t WHERE child_id IS NOT NULL`;
      return rows.map(r => r.child_id);
    } catch (_) { return []; }
  }
  if (user.id == null) return [];
  try {
    const rows = await db`SELECT child_id FROM child_access WHERE user_id = ${user.id} AND status = 'active'`;
    return rows.map(r => r.child_id);
  } catch (_) { return []; }
}

export async function canAccessChild(user, childId, db = sql()) {
  if (!user || !childId) return false;
  if (user.role === 'admin') return true;
  if (user.id == null) return false;
  try {
    const rows = await db`
      SELECT 1 FROM child_access
      WHERE user_id = ${user.id} AND child_id = ${childId} AND status = 'active' LIMIT 1`;
    return rows.length > 0;
  } catch (_) { return false; }
}

// Is `user` a parent of `childId`? Drives the override authority parents have
// over therapist-owned content on their child's board.
export async function isParentOf(user, childId, db = sql()) {
  if (!user || !childId || user.id == null) return false;
  try {
    const rows = await db`
      SELECT 1 FROM child_access
      WHERE user_id = ${user.id} AND child_id = ${childId}
        AND relation = 'parent' AND status = 'active' LIMIT 1`;
    return rows.length > 0;
  } catch (_) { return false; }
}

// Can `user` edit/delete a piece of content with the given owner_user_id on
// `childId`'s board? Encodes the trust model documented above.
export async function canEditContent(user, ownerUserId, childId, db = sql()) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Shared/parent-board content (owner NULL) → only parent of the child.
  if (ownerUserId == null) return await isParentOf(user, childId, db);
  // Therapist-owned content → owner OR a parent of the child (parent override).
  if (user.id != null && Number(ownerUserId) === Number(user.id)) return true;
  return await isParentOf(user, childId, db);
}

