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
import { del, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { sql, rowToItem, stampLayoutCustomized } from './_lib/db.js';
import { canEditContent, isParentOf, canAccessChild } from './_lib/access.js';
import { archivePriorImage } from './_lib/image-history.js';
import { readBlobBytes } from './_lib/blob.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const db = sql();
    if (req.method === 'GET') {
      // ?lexicon=1 → the canonical suggestion matcher vocabulary (#10).
      if (String(req.query.lexicon || '') === '1') {
        const { suggestLexicon } = await import('./_lib/word-suggestions.js');
        return await suggestLexicon(req, res, db);
      }
      // ?movieSearch=<q> → #11 film/TV title lookup (metadata only, no
      // artwork; see _lib/movie-search.js — the single swap point for TMDB).
      if (req.query.movieSearch != null) {
        const { movieSearch } = await import('./_lib/movie-search.js');
        return await movieSearch(req, res);
      }
      return await imageHistory(req, res, db, auth.user);
    }
    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      if (b.op === 'revert-image') return await revertImage(req, res, db, auth.user, b);
      if (b.op === 'reorder')      return await reorderBulk(req, res, db, auth.user, b);
      // #10 canonical suggestion queue — all roster-gated, consent-checked
      // server-side (see _lib/word-suggestions.js).
      if (b.op === 'suggest-record' || b.op === 'suggest-list' || b.op === 'suggest-act') {
        const ws = await import('./_lib/word-suggestions.js');
        const fn = { 'suggest-record': ws.suggestRecord, 'suggest-list': ws.suggestList, 'suggest-act': ws.suggestAct }[b.op];
        return await fn(req, res, db, auth.user, b, canAccessChild);
      }
      return await create(req, res, db, auth.user);
    }
    if (req.method === 'PUT')    return await update(req, res, db, auth.user);
    if (req.method === 'DELETE') return await remove(req, res, db, auth.user);
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}

// GET ?history=<itemId> — the tile's past pictures (the album rows), newest
// first, so the edit modal can offer one-tap revert. Gated by the same
// ownership rule as editing the tile itself.
async function imageHistory(req, res, db, user) {
  const itemId = Number(req.query.history);
  if (!Number.isFinite(itemId)) { res.status(400).json({ error: 'history=<itemId> required' }); return; }
  const item = (await db`SELECT id, child_id, owner_user_id, image_key FROM items WHERE id = ${itemId} LIMIT 1`)[0];
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  // NB: signature is (user, ownerUserId, childId, db) — passing the row here
  // silently 403'd every non-admin parent (admin short-circuits first).
  if (!(await canEditContent(user, item.owner_user_id, item.child_id, db))) { res.status(403).json({ error: 'Not allowed' }); return; }
  const rows = await db`
    SELECT blob_key, source, archived_at FROM item_image_history
    WHERE item_id = ${itemId} AND child_id = ${item.child_id}
    ORDER BY archived_at DESC LIMIT 24`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, currentKey: item.image_key || null,
    history: rows.map((r) => ({ key: r.blob_key, source: r.source || null, archivedAt: r.archived_at })) });
}

// POST { op:'reorder', ids:[...] } — persist a drag-reorder in ONE request
// instead of N sequential PUTs (the clients apply the order locally first;
// this is the background sync). `ids` is the sibling group in its new order;
// orders become i*1000. All rows must belong to one board; ownership mirrors
// update()'s per-row gate (parent-or-admin edits everything, a therapist
// only their own rows).
async function reorderBulk(req, res, db, user, b) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 500);
  if (!ids.length) { res.status(400).json({ error: 'ids required' }); return; }
  const rows = await db`SELECT id, child_id, owner_user_id FROM items WHERE id = ANY(${ids})`;
  if (!rows.length) { res.status(404).json({ error: 'items not found' }); return; }
  const childId = rows[0].child_id;
  if (!childId || rows.some((r) => r.child_id !== childId)) {
    res.status(400).json({ error: 'ids must all belong to one board' }); return;
  }
  const parentOK = await canEditContent(user, null, childId, db);
  for (const r of rows) {
    const ownRow = r.owner_user_id != null && user.id != null
      && Number(r.owner_user_id) === Number(user.id);
    if (!parentOK && !ownRow) { res.status(403).json({ error: 'Not allowed' }); return; }
  }
  const orders = ids.map((_, i) => i * 1000);
  try {
    await db`
      UPDATE items AS i SET display_order = v.ord, updated_at = NOW()
      FROM (SELECT UNNEST(${ids}::int[]) AS id, UNNEST(${orders}::int[]) AS ord) AS v
      WHERE i.id = v.id AND i.child_id = ${childId}`;
  } catch (_) {
    // Array-param path unavailable (older driver) — per-row fallback.
    for (let i = 0; i < ids.length; i++) {
      await db`UPDATE items SET display_order = ${orders[i]}, updated_at = NOW()
               WHERE id = ${ids[i]} AND child_id = ${childId}`;
    }
  }
  await stampLayoutCustomized(db, childId);
  res.status(200).json({ ok: true, count: ids.length });
}

// POST { op:'revert-image', id, key } — put a past picture back on the tile.
// The current picture is archived first, so reverting is itself revertible;
// the history row stays (the album keeps everything, forever).
async function revertImage(req, res, db, user, b) {
  const itemId = Number(b.id);
  const key = String(b.key || '').slice(0, 300);
  if (!Number.isFinite(itemId) || !key) { res.status(400).json({ error: 'id and key required' }); return; }
  const item = (await db`SELECT id, child_id, owner_user_id, image_key, label, section
                         FROM items WHERE id = ${itemId} LIMIT 1`)[0];
  if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
  if (!(await canEditContent(user, item.owner_user_id, item.child_id, db))) { res.status(403).json({ error: 'Not allowed' }); return; }
  // The key must come from THIS tile's own history — no arbitrary blob keys.
  const hist = await db`
    SELECT 1 FROM item_image_history
    WHERE item_id = ${itemId} AND child_id = ${item.child_id} AND blob_key = ${key} LIMIT 1`;
  if (!hist.length) { res.status(400).json({ error: 'key is not in this tile\'s history' }); return; }
  // SHARED-DEFAULT keys can't just be written back: sync's overlay treats
  // 'style-defaults/' and 'taxonomy-defaults/' image keys as REPLACEABLE and
  // re-skins them with the current style's default on the very next sync —
  // so a revert TO one succeeded in the DB but visually never happened
  // ("messaging was all good but it wouldn't do the swap"). The family
  // explicitly chose THIS picture, so re-home its bytes to a child-owned
  // key the overlay never touches.
  let finalKey = key;
  if (/^(style-defaults|taxonomy-defaults)\//.test(key) && item.child_id) {
    try {
      const bytes = await readBlobBytes(key);
      const ext = (key.split('.').pop() || 'png').slice(0, 4);
      finalKey = `item-images/${item.child_id}/revert-${randomUUID()}.${ext}`;
      await put(finalKey, bytes.buffer, { access: 'private', contentType: bytes.contentType, addRandomSuffix: false });
    } catch (_) {
      finalKey = key;   // copy failed → old behavior (better than blocking the revert)
    }
  }
  if (item.image_key && item.image_key !== finalKey) {
    await archivePriorImage({ db, childId: item.child_id, itemId: item.id, oldKey: item.image_key,
                              label: item.label, section: item.section, source: 'revert',
                              who: user && user.email ? user.email : null });
  }
  await db`UPDATE items SET image_key = ${finalKey}, updated_at = NOW() WHERE id = ${item.id}`;
  res.status(200).json({ ok: true, imageKey: finalKey });
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
  // #16: teaching facts on create — written separately with a guarded ALTER
  // so a pre-migration deploy can't fail the whole insert.
  const rawClues = Array.isArray(b.descriptiveClues)
    ? b.descriptiveClues.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 200)).slice(0, 3)
    : [];
  if (rawClues.length) {
    try {
      await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS descriptive_clues TEXT[]`;
      const upd = await db`UPDATE items SET descriptive_clues = ${rawClues} WHERE id = ${rows[0].id} RETURNING *`;
      if (upd.length) rows[0] = upd[0];
    } catch (_) { /* clues are additive — never block tile creation */ }
  }
  // #11: movie/show link ids on create — additive like the clues above.
  if (b.wikidataQid != null || b.imdbId != null) {
    try {
      const { cleanQid, cleanImdbId } = await import('./_lib/movie-search.js');
      const qid = cleanQid(b.wikidataQid), imdb = cleanImdbId(b.imdbId);
      if (qid || imdb) {
        await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS wikidata_qid TEXT`;
        await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS imdb_id TEXT`;
        const upd = await db`UPDATE items SET wikidata_qid = ${qid}, imdb_id = ${imdb}
                             WHERE id = ${rows[0].id} RETURNING *`;
        if (upd.length) rows[0] = upd[0];
      }
    } catch (_) { /* link ids are additive — never block tile creation */ }
  }
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
  // #16: the taxonomy's three descriptive clues, parent-authorable on any
  // tile (photo tiles included) — same shape as canonical clues, so teaching/
  // testing/matching modes consume them identically. `undefined` leaves them;
  // an array replaces (empty array clears back to the canonical overlay).
  const rawClues = (req.body || {}).descriptiveClues;
  const clues = Array.isArray(rawClues)
    ? rawClues.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 200)).slice(0, 3)
    : undefined;
  if (clues !== undefined) {
    try { await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS descriptive_clues TEXT[]`; } catch (_) {}
  }
  // #11: movie/show link ids. `undefined` leaves them; a value re-links; an
  // explicit null / '' clears the link. Validated to the id shapes only.
  // The guarded ALTER runs unconditionally: the UPDATE below always names
  // these columns, so a pre-migration DB must self-heal on EVERY update, not
  // only when the ids are in the payload.
  try {
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS wikidata_qid TEXT`;
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS imdb_id TEXT`;
  } catch (_) {}
  const rawQid = (req.body || {}).wikidataQid;
  const rawImdb = (req.body || {}).imdbId;
  let qidSet, imdbSet;   // undefined = leave column alone
  if (rawQid !== undefined || rawImdb !== undefined) {
    const { cleanQid, cleanImdbId } = await import('./_lib/movie-search.js');
    if (rawQid !== undefined) qidSet = rawQid ? cleanQid(rawQid) : null;
    if (rawImdb !== undefined) imdbSet = rawImdb ? cleanImdbId(rawImdb) : null;
  }
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
      descriptive_clues = ${clues === undefined ? (old.descriptive_clues ?? null) : (clues.length ? clues : null)},
      wikidata_qid  = ${qidSet === undefined ? (old.wikidata_qid ?? null) : qidSet},
      imdb_id       = ${imdbSet === undefined ? (old.imdb_id ?? null) : imdbSet},
      needs_review  = ${needsReview === undefined ? old.needs_review : !!needsReview},
      updated_at    = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  // The prior IMAGE blob is deliberately NOT deleted: archivePriorImage above
  // stored a REFERENCE to this exact key in item_image_history, and the
  // product's headline promise ("archived, never deleted" — the Album, the
  // one-tap revert) depends on the bytes staying. Deleting here left album
  // rows pointing at dead blobs. Blobs are reclaimed only by account deletion.
  if (soundKey && old.sound_key && soundKey !== old.sound_key) { try { await del(old.sound_key); } catch (_) {} }

  // A deliberate reorder marks the board family-arranged: the Lab's layout
  // push skips it from now on unless the admin explicitly overrides.
  if (order != null && old.child_id) await stampLayoutCustomized(db, old.child_id);

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
