// /api/items — POST (create), PUT?id=N (update), DELETE?id=N (delete + blob cleanup)
//
// Two ownership contexts are served by the same endpoints:
//   - Child-scoped items (child_id = <slug>, owner_user_id IS NULL or set):
//     parent of that child + admin can edit; written from the parent organizer
//     and the kid-board's edit mode.
//   - Template items (child_id IS NULL, owner_user_id = therapist):
//     only the owner + admin can edit; written from the therapist library.
// The CREATE path infers context from the parent category (looked up by id).
// PUT/DELETE load the row and run canEditContent against its ownership.
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToItem } from './_lib/db.js';
import { canEditContent, isParentOf } from './_lib/access.js';
import { archivePriorImage } from './_lib/image-history.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    if (req.method === 'POST')   return await create(req, res, db, auth.user);
    if (req.method === 'PUT')    return await update(req, res, db, auth.user);
    if (req.method === 'DELETE') return await remove(req, res, db, auth.user);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

async function create(req, res, db, user) {
  const b = (typeof req.body === 'object' && req.body) || {};
  const section = b.section;
  const label = b.label;
  const categoryId = b.categoryId == null ? null : Number(b.categoryId);
  if (!section || !label) { res.status(400).json({ error: 'section and label required' }); return; }

  // Infer child_id + owner_user_id from the parent category. Fallback to the
  // legacy childId scoping when there's no category (top-level Needs-strip items).
  let childId = null, ownerUserId = null;
  if (categoryId != null) {
    const parents = await db`SELECT child_id, owner_user_id FROM categories WHERE id = ${categoryId} LIMIT 1`;
    if (!parents.length) { res.status(404).json({ error: 'category not found' }); return; }
    childId = parents[0].child_id;
    ownerUserId = parents[0].owner_user_id;
  } else {
    childId = String(((req.body && req.body.childId) || (req.query && req.query.childId) || 'fletcher')).slice(0, 64);
  }

  // Permission. Child-scoped → parent-of-child / admin. Template → owner / admin.
  if (childId != null) {
    if (user.role !== 'admin' && !(await isParentOf(user, childId, db))) {
      res.status(403).json({ error: "You don't have write access for that child." }); return;
    }
  } else {
    if (user.role !== 'admin' && Number(ownerUserId) !== Number(user.id)) {
      res.status(403).json({ error: 'Only the board owner can add tiles here.' }); return;
    }
  }

  // PRD §5 Auditory Comprehension: an optional description text the parent
  // can author per item (e.g. "lives in a field, has four legs, eats grass").
  // Falls back to "Who/what is the [label]?" in the game view when unset.
  const description = typeof b.description === 'string' ? b.description.slice(0, 500) : null;
  // Rotating teaching descriptions (see init.js). Array of short sentences.
  const descriptions = Array.isArray(b.descriptions)
    ? b.descriptions.filter((s) => typeof s === 'string').map((s) => s.slice(0, 240)).slice(0, 6)
    : null;

  // Bulk imports add the tile to the board straight away but flag it for the
  // parent's review queue (see init.js). Single-tile adds leave it false.
  const needsReview = !!b.needsReview;

  const rows = await db`
    INSERT INTO items
      (section, category_id, label, image_url, image_key, sound_url, sound_key,
       keep_aspect, display_order, pinned, child_id, owner_user_id, description,
       descriptions, needs_review, updated_at)
    VALUES
      (${section}, ${categoryId}, ${label},
       ${b.imageUrl ?? null}, ${b.imageKey ?? null},
       ${b.soundUrl ?? null}, ${b.soundKey ?? null},
       ${!!b.keepAspect}, ${b.order ?? Date.now()}, ${!!b.pinned},
       ${childId}, ${ownerUserId}, ${description}, ${descriptions}, ${needsReview}, NOW())
    RETURNING *
  `;
  res.status(200).json(rowToItem(rows[0]));
}

async function update(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const current = await db`SELECT * FROM items WHERE id = ${id} LIMIT 1`;
  if (!current.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = current[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No edit access' }); return;
  }

  const { label, categoryId, imageUrl, imageKey, soundUrl, soundKey, keepAspect, order, pinned, section } = req.body || {};
  // PRD §5: description is updatable. `undefined` = leave the existing value
  // alone; explicit "" clears it back to the fallback prompt in the game.
  const description = (req.body || {}).description;
  // Review queue: confirming a bulk-imported tile sends needsReview:false to
  // drop it from the parent's review list. `undefined` leaves it unchanged.
  const needsReview = (req.body || {}).needsReview;
  // Rotating teaching descriptions. `undefined` leaves them; an array replaces.
  const rawDescriptions = (req.body || {}).descriptions;
  const descriptions = Array.isArray(rawDescriptions)
    ? rawDescriptions.filter((s) => typeof s === 'string').map((s) => s.slice(0, 240)).slice(0, 6)
    : undefined;
  // Archive the previous picture before we overwrite it — the parent's album
  // depends on us never losing a tile's prior face.
  if (imageKey && old.image_key && imageKey !== old.image_key) {
    await archivePriorImage({
      db, childId: old.child_id, itemId: old.id, oldKey: old.image_key,
      label: old.label, section: old.section, source: 'edit',
      who: user && user.email || null,
    });
  }

  const rows = await db`
    UPDATE items SET
      label         = COALESCE(${label ?? null},      label),
      section       = COALESCE(${section ?? null},    section),
      category_id   = ${categoryId === undefined ? old.category_id : categoryId},
      image_url     = COALESCE(${imageUrl ?? null},   image_url),
      image_key     = COALESCE(${imageKey ?? null},   image_key),
      sound_url     = COALESCE(${soundUrl ?? null},   sound_url),
      sound_key     = COALESCE(${soundKey ?? null},   sound_key),
      keep_aspect   = ${keepAspect === undefined ? old.keep_aspect : !!keepAspect},
      display_order = COALESCE(${order ?? null},      display_order),
      pinned        = ${pinned === undefined ? old.pinned : !!pinned},
      description   = ${description === undefined ? old.description : (typeof description === 'string' ? description.slice(0, 500) : null)},
      descriptions  = ${descriptions === undefined ? old.descriptions : descriptions},
      needs_review  = ${needsReview === undefined ? old.needs_review : !!needsReview},
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  if (imageKey && old.image_key && imageKey !== old.image_key) { try { await del(old.image_key); } catch (_) {} }
  if (soundKey && old.sound_key && soundKey !== old.sound_key) { try { await del(old.sound_key); } catch (_) {} }

  res.status(200).json(rowToItem(rows[0]));
}

async function remove(req, res, db, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const rows = await db`SELECT * FROM items WHERE id = ${id} LIMIT 1`;
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  const old = rows[0];

  if (!(await canEditContent(user, old.owner_user_id, old.child_id, db))) {
    res.status(403).json({ error: 'No delete access' }); return;
  }

  await db`DELETE FROM items WHERE id = ${id}`;
  if (old.image_key) { try { await del(old.image_key); } catch (_) {} }
  if (old.sound_key) { try { await del(old.sound_key); } catch (_) {} }
  res.status(200).json({ ok: true });
}
