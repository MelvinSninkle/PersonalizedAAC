#!/usr/bin/env node
// Surgical restore of BOARD ORDER (items.display_order + categories.display_order)
// from a nightly pg_dump backup — the repair tool for a layout push that
// overwrote families' own arrangements. Restores ORDER ONLY: no labels, no
// art, no words are touched; rows added since the backup keep their current
// place; rows deleted since the backup are skipped.
//
// 1) Download the nightly backup artifact (GitHub → Actions → "Nightly DB
//    backup" → the run from BEFORE the bad push) — it's pg_dump custom format.
// 2) Extract the two tables as plain SQL:
//      pg_restore --data-only --table=items --table=categories -f order.sql backup.dump
// 3) Dry-run (prints what would change, writes nothing):
//      DATABASE_URL=<neon-url> node tools/restore-order.mjs order.sql
// 4) Apply:
//      DATABASE_URL=<neon-url> node tools/restore-order.mjs order.sql --apply
//
// Flags:
//   --apply          actually write (default is dry-run)
//   --child <slug>   restore one board only
//   --since <iso>    only boards that publish_log shows got a LAYOUT push at or
//                    after this time (the truly surgical mode — everyone else
//                    is left alone even if their order drifted for other reasons)
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ONLY_CHILD = flag('--child');
const SINCE = flag('--since');

if (!file || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=<url> node tools/restore-order.mjs <order.sql> [--apply] [--child slug] [--since iso]');
  process.exit(1);
}

// ── Parse pg_dump plain COPY blocks ─────────────────────────────────────────
// COPY public.items (id, section, ..., display_order, ..., child_id, ...) FROM stdin;
// <tab-separated rows, \N = NULL> …  \.
function parseCopy(sqlText, table) {
  const rows = [];
  const re = new RegExp(`^COPY (?:public\\.)?${table} \\(([^)]+)\\) FROM stdin;$`, 'm');
  const m = sqlText.match(re);
  if (!m) return { rows, cols: null };
  const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
  const start = sqlText.indexOf(m[0]) + m[0].length + 1;
  const end = sqlText.indexOf('\n\\.', start);
  const body = sqlText.slice(start, end === -1 ? undefined : end);
  for (const line of body.split('\n')) {
    if (!line || line === '\\.') continue;
    rows.push(line.split('\t'));
  }
  return { rows, cols };
}
const un = (v) => (v === '\\N' ? null : v.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));

function orderMap(sqlText, table) {
  const { rows, cols } = parseCopy(sqlText, table);
  if (!cols) { console.error(`WARNING: no COPY block for "${table}" in the file — did pg_restore include it?`); return new Map(); }
  const iId = cols.indexOf('id'), iOrder = cols.indexOf('display_order'), iChild = cols.indexOf('child_id');
  if (iId < 0 || iOrder < 0 || iChild < 0) { console.error(`WARNING: ${table} COPY lacks id/display_order/child_id`); return new Map(); }
  const map = new Map();
  for (const r of rows) {
    const child = un(r[iChild]);
    if (!child) continue;                      // templates aren't family boards
    const order = un(r[iOrder]);
    if (order == null) continue;
    map.set(Number(un(r[iId])), { order: Number(order), child });
  }
  return map;
}

const text = readFileSync(file, 'utf8');
const bakItems = orderMap(text, 'items');
const bakCats = orderMap(text, 'categories');
console.log(`backup: ${bakItems.size} item orders, ${bakCats.size} folder orders (family boards only)`);

const sql = neon(process.env.DATABASE_URL);

// Which boards are in scope?
let scopeChildren = null;   // null = all family boards found in the backup
if (ONLY_CHILD) scopeChildren = new Set([ONLY_CHILD]);
else if (SINCE) {
  const rows = await sql`SELECT DISTINCT child_id FROM publish_log
                         WHERE what LIKE ${'%layout%'} AND created_at >= ${SINCE}`;
  scopeChildren = new Set(rows.map((r) => r.child_id));
  console.log(`publish_log: ${scopeChildren.size} board(s) got a layout push since ${SINCE}`);
}

async function restore(table, bak) {
  const live = table === 'items'
    ? await sql`SELECT id, display_order, child_id FROM items WHERE child_id IS NOT NULL`
    : await sql`SELECT id, display_order, child_id FROM categories WHERE child_id IS NOT NULL`;
  const perChild = new Map();
  const updates = [];
  for (const row of live) {
    const b = bak.get(Number(row.id));
    if (!b) continue;                                        // added since backup / not in dump
    if (b.child !== row.child_id) continue;                  // moved boards — never cross
    if (scopeChildren && !scopeChildren.has(row.child_id)) continue;
    if (Number(row.display_order) === b.order) continue;     // already right
    updates.push({ id: Number(row.id), order: b.order, child: row.child_id });
    perChild.set(row.child_id, (perChild.get(row.child_id) || 0) + 1);
  }
  console.log(`\n${table}: ${updates.length} row(s) would be restored across ${perChild.size} board(s)`);
  for (const [c, n] of [...perChild.entries()].sort()) console.log(`  ${c}: ${n}`);
  if (APPLY && updates.length) {
    const upd = (u) => table === 'items'
      ? sql`UPDATE items SET display_order = ${u.order}, updated_at = NOW() WHERE id = ${u.id} AND child_id = ${u.child}`
      : sql`UPDATE categories SET display_order = ${u.order}, updated_at = NOW() WHERE id = ${u.id} AND child_id = ${u.child}`;
    for (let i = 0; i < updates.length; i += 25) {
      await Promise.all(updates.slice(i, i + 25).map(upd));
      process.stdout.write(`  applied ${Math.min(i + 25, updates.length)}/${updates.length}\r`);
    }
    console.log(`\n  ${table}: restored.`);
  }
  return updates.length;
}

const a = await restore('items', bakItems);
const b = await restore('categories', bakCats);
console.log(APPLY
  ? `\nDONE — restored ${a + b} order value(s). Boards pick it up on their next sync.`
  : `\nDRY RUN — ${a + b} order value(s) would be restored. Re-run with --apply to write.`);
