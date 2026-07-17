// Consented support access — shared logic for the family-facing case flow
// (store.js actions) and the admin inbox (admin/_lab-support.js).
//
// The privacy model this implements: an admin NEVER opens a family board
// without a case the family created (their request IS the permission), the
// family is notified in-app the moment review starts, every edit happens
// inside a snapshotted start→finish window, and the family receives a bulk
// summary of exactly what changed. In-app notices only — no email — and only
// the account that filed the case is notified (not the whole care team).

export const MAX_OPEN_CASES = 3;

// Copy constants — the disclosure wording is a PROMISE to families; change it
// deliberately, and keep the three clients' confirm dialogs in sync with it.
export const CONFIRM_COPY = (childName) =>
  `Send this to the My World team? By sending, you give us permission to open and edit ${childName}'s board to investigate and fix this. You'll get a notice here when we start, and another when we're done. Responses can take up to 48 hours.`;
export const SUCCESS_COPY =
  "Sent! We'll get back to you within 48 hours. You'll see a notice here the moment we start work on the board.";
export const REVIEW_NOTICE_TEXT = (childName) =>
  `We've started on your request and have opened ${childName}'s board to work on it. You'll get a summary of everything we changed when we're done.`;
export const DRAFT_HEADER = "Hi! We finished working on your request. Here's what we changed:";
export const DRAFT_FOOTER = 'Everything else is exactly as you left it.';

export async function ensureSupport(db) {
  await db`
    CREATE TABLE IF NOT EXISTS support_cases (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'support',
      status TEXT NOT NULL DEFAULT 'open',
      message TEXT NOT NULL,
      created_by BIGINT,
      created_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      review_started_at TIMESTAMPTZ,
      review_started_by TEXT,
      review_notice_ack_at TIMESTAMPTZ,
      board_snapshot JSONB,
      response_text TEXT,
      response_sent_at TIMESTAMPTZ,
      response_sent_by TEXT,
      response_ack_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS support_cases_child_idx ON support_cases(child_id, status)`;
  await db`CREATE INDEX IF NOT EXISTS support_cases_status_idx ON support_cases(status, created_at DESC)`;
}

// Minimal board snapshot for the start→finish diff: only the fields the
// summary talks about. ~100 bytes/tile → a 1000-tile board is ~100 KB JSONB.
export async function snapshotBoard(db, childId) {
  const [items, categories] = await Promise.all([
    db`SELECT id, label, image_key, display_order, category_id, section
       FROM items WHERE child_id = ${childId} ORDER BY id LIMIT 5000`,
    db`SELECT id, label, display_order, section
       FROM categories WHERE child_id = ${childId} ORDER BY id LIMIT 1000`,
  ]);
  return {
    at: new Date().toISOString(),
    items: items.map((i) => ({ id: Number(i.id), label: i.label, image_key: i.image_key || null,
                               display_order: Number(i.display_order) || 0,
                               category_id: i.category_id == null ? null : Number(i.category_id),
                               section: i.section || null })),
    categories: categories.map((c) => ({ id: Number(c.id), label: c.label,
                                         display_order: Number(c.display_order) || 0,
                                         section: c.section || null })),
  };
}

// Human-readable bulk summary of what changed between two snapshots — the
// lines a parent reads, so folder names not ids, and grouped when noisy.
export function diffSummary(before, after) {
  const lines = [];
  const catName = (id, snap) => {
    if (id == null) return 'the board';
    const c = (snap.categories || []).find((x) => x.id === id) ||
              (before.categories || []).find((x) => x.id === id);
    return c ? `“${c.label}”` : 'another folder';
  };
  const bItems = new Map((before.items || []).map((i) => [i.id, i]));
  const aItems = new Map((after.items || []).map((i) => [i.id, i]));
  const bCats = new Map((before.categories || []).map((c) => [c.id, c]));
  const aCats = new Map((after.categories || []).map((c) => [c.id, c]));

  // Folder renames + adds/removes first (they anchor the tile lines).
  for (const [id, a] of aCats) {
    const b = bCats.get(id);
    if (!b) lines.push(`Added a new folder “${a.label}”`);
    else if (b.label !== a.label) lines.push(`Renamed the folder “${b.label}” to “${a.label}”`);
  }
  for (const [id, b] of bCats) if (!aCats.has(id)) lines.push(`Removed the folder “${b.label}”`);
  if ([...aCats.values()].some((a) => bCats.has(a.id) && bCats.get(a.id).display_order !== a.display_order)) {
    lines.push('Reordered the folders on the board');
  }

  // Tile adds/removes/renames/moves.
  const pictureChanges = [];          // {label, catId} — grouped below when noisy
  const reorderByCat = new Map();     // catId → [labels] moved within the folder
  for (const [id, a] of aItems) {
    const b = bItems.get(id);
    if (!b) { lines.push(`Added “${a.label}” to ${catName(a.category_id, after)}`); continue; }
    if (b.label !== a.label) lines.push(`Renamed “${b.label}” to “${a.label}”`);
    if ((b.image_key || null) !== (a.image_key || null)) pictureChanges.push({ label: a.label, catId: a.category_id });
    if ((b.category_id ?? null) !== (a.category_id ?? null)) {
      lines.push(`Moved “${a.label}” from ${catName(b.category_id, before)} to ${catName(a.category_id, after)}`);
    } else if (b.display_order !== a.display_order) {
      // Reorder WITHIN a folder: compare rank among surviving siblings so a
      // global resequence (i*1000) doesn't read as everything moving.
      const rank = (map, itemId, catId) => [...map.values()]
        .filter((x) => (x.category_id ?? null) === (catId ?? null) && aItems.has(x.id) && bItems.has(x.id))
        .sort((x, y) => x.display_order - y.display_order || x.id - y.id)
        .findIndex((x) => x.id === itemId);
      const rb = rank(bItems, id, b.category_id), ra = rank(aItems, id, a.category_id);
      if (rb !== ra) {
        if (!reorderByCat.has(a.category_id)) reorderByCat.set(a.category_id, []);
        reorderByCat.get(a.category_id).push({ label: a.label, dir: ra < rb ? 'earlier' : 'later' });
      }
    }
  }
  for (const [id, b] of bItems) if (!aItems.has(id)) lines.push(`Removed “${b.label}” from ${catName(b.category_id, before)}`);

  // Picture changes: individual when few, grouped by folder when many.
  if (pictureChanges.length <= 5) {
    for (const p of pictureChanges) lines.push(`New picture for “${p.label}”`);
  } else {
    const byCat = new Map();
    for (const p of pictureChanges) {
      if (!byCat.has(p.catId)) byCat.set(p.catId, []);
      byCat.get(p.catId).push(p.label);
    }
    for (const [catId, labels] of byCat) {
      const shown = labels.slice(0, 3).map((l) => `“${l}”`).join(', ');
      const more = labels.length > 3 ? `, +${labels.length - 3} more` : '';
      lines.push(`${labels.length} new picture${labels.length === 1 ? '' : 's'} in ${catName(catId, after)} (${shown}${more})`);
    }
  }

  // Reorders: per-tile when quiet, one line per folder when busy.
  for (const [catId, moves] of reorderByCat) {
    if (moves.length <= 3) {
      for (const m of moves) lines.push(`Moved “${m.label}” ${m.dir} in ${catName(catId, after)}`);
    } else {
      lines.push(`Reordered the tiles in ${catName(catId, after)}`);
    }
  }

  if (!lines.length) return ["We reviewed the board and didn't need to change anything."];
  if (lines.length > 30) {
    const extra = lines.length - 30;
    return [...lines.slice(0, 30), `…and ${extra} more small change${extra === 1 ? '' : 's'}.`];
  }
  return lines;
}

export function draftFromDiff(lines) {
  return `${DRAFT_HEADER}\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\n${DRAFT_FOOTER}`;
}

// The creator's undismissed notices for this child — synthesized from case
// columns (max two per case, review-started + response). Creator-only by
// design: other care-team accounts are never told, per the owner's policy.
export async function supportNoticesFor(db, childId, uid) {
  if (!uid) return [];
  const rows = await db`
    SELECT id, child_id, review_started_at, review_notice_ack_at,
           response_text, response_sent_at, response_ack_at
    FROM support_cases
    WHERE child_id = ${childId} AND created_by = ${uid}
      AND ((review_started_at IS NOT NULL AND review_notice_ack_at IS NULL)
        OR (response_sent_at IS NOT NULL AND response_ack_at IS NULL))
    ORDER BY id DESC LIMIT 10`;
  const out = [];
  const name = prettyChild(childId);
  for (const r of rows) {
    if (r.review_started_at && !r.review_notice_ack_at && !r.response_sent_at) {
      out.push({ id: `sc${r.id}-review`, caseId: Number(r.id), kind: 'review-started',
                 text: REVIEW_NOTICE_TEXT(name), createdAt: r.review_started_at });
    }
    if (r.response_sent_at && !r.response_ack_at) {
      out.push({ id: `sc${r.id}-response`, caseId: Number(r.id), kind: 'response',
                 text: r.response_text || 'Your request is done.', createdAt: r.response_sent_at });
    }
  }
  return out;
}

function prettyChild(slug) {
  const s = String(slug || '').replace(/[-_]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/\s.*$/, '') : 'your child';
}
