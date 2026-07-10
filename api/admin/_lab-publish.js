// /api/admin/lab?action=publish  (admin only)
//
// Publishing controls: push the Lab's curated content out to EXISTING boards.
// Scopes: every board, every board on one offered style, or a single user
// (email or board slug). Tile/chip ART never needs a push — /api/sync resolves
// shared default art live at read time — so what a push actually delivers is
// the two things seed bakes into a board as per-child copies:
//
//   layout  curated category order + word order (default_category_order +
//           taxonomy.sort_order, the Lab layout screen) applied to the board's
//           own categories/items. Curated words take the curated order; a
//           family's custom words keep their relative order after them.
//   sounds  every taxonomy-linked tile's voice clip re-pointed at audio for
//           the CURRENT pronunciation (taxonomy.pronunciation || label) in the
//           board's own voice. Clips come from the shared TTS cache (the same
//           files the voice-lab bench QC'd), copied per child like seeding
//           does. Parent-recorded sounds are never touched — only seeded clips
//           (onboarding/<child>/voice/…) and empty slots are replaced. The
//           per-child copy key is derived from (model|voice|text), so re-runs
//           skip clips that are already current: pushes are idempotent.
//
//   GET  ?scope=all|style|child &styleGuideId= &child=   → dry-run preview
//        { total, children:[…first 100] }
//   POST { scope, styleGuideId, child, what:{layout,sounds}, offset, limit }
//        → processes a chunk of boards; { results, nextOffset, total, done }.
//        A board whose sound push hits the per-call work cap reports
//        partial:true and is NOT advanced past — repeat the same offset and
//        the derived-key skip makes the second pass resume where it stopped.
import { put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { loadChildVoiceId, synthesizeVoice } from '../_lib/onboarding-render.js';

export const config = { maxDuration: 300 };

const norm = (s) => String(s || '').trim().toLowerCase();

// Work cap for one board's sound push within a single request — keeps the
// function far from maxDuration even on a cold cache. ~200 cache hits + blob
// copies fit comfortably; a capped board resumes on the next call.
const SOUND_TEXTS_PER_CALL = 200;

async function targetChildren(db, { scope, styleGuideId, child }) {
  if (scope === 'child') {
    const q = norm(child);
    if (!q) return [];
    if (q.includes('@')) {
      const u = (await db`SELECT child_slug FROM users WHERE lower(email) = ${q} LIMIT 1`)[0];
      return u && u.child_slug ? [u.child_slug] : [];
    }
    return [q];
  }
  if (scope === 'style') {
    const sid = String(Number(styleGuideId) || 0);
    if (sid === '0') return [];
    const rows = await db`SELECT child_id FROM child_settings
                          WHERE settings->>'styleGuideId' = ${sid} ORDER BY child_id`;
    return rows.map((r) => r.child_id);
  }
  // 'all' = every board that actually has content.
  const rows = await db`SELECT DISTINCT child_id FROM items WHERE child_id IS NOT NULL ORDER BY child_id`;
  return rows.map((r) => r.child_id);
}

async function pushLayout(db, childId) {
  const [order, cats] = await Promise.all([
    db`SELECT section, label_norm, parent_norm, sort_order FROM default_category_order`,
    db`SELECT id, section, label, parent_id, display_order FROM categories WHERE child_id = ${childId}`,
  ]);
  const catSort = new Map(order.map((o) => [`${o.section}|${o.label_norm}|${o.parent_norm}`, o.sort_order]));
  const byId = new Map(cats.map((c) => [c.id, c]));
  let catUpdates = 0;
  for (const c of cats) {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const so = catSort.get(`${c.section}|${norm(c.label)}|${parent ? norm(parent.label) : ''}`);
    if (so == null || Number(c.display_order) === Number(so)) continue;
    await db`UPDATE categories SET display_order = ${so} WHERE id = ${c.id} AND child_id = ${childId}`;
    catUpdates++;
  }

  // Word order inside each folder: curated words by curated sort, then the
  // family's own words in their existing relative order.
  const items = await db`
    SELECT i.id, i.section, i.category_id, i.display_order, t.sort_order
    FROM items i LEFT JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${childId}`;
  const groups = new Map();
  for (const i of items) {
    const k = `${i.section}|${i.category_id || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  let tileUpdates = 0;
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) =>
      ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9))
      || (Number(a.display_order || 0) - Number(b.display_order || 0))
      || (Number(a.id) - Number(b.id)));
    for (let idx = 0; idx < sorted.length; idx++) {
      const want = idx * 10;
      if (Number(sorted[idx].display_order) === want) continue;
      await db`UPDATE items SET display_order = ${want}, updated_at = NOW()
               WHERE id = ${sorted[idx].id} AND child_id = ${childId}`;
      tileUpdates++;
    }
  }
  return { cats: catUpdates, tiles: tileUpdates };
}

async function pushSounds(db, childId) {
  const voiceId = await loadChildVoiceId(db, childId);
  // Same default chain synthesizeVoice uses, so the derived key names the
  // audio that would actually be generated.
  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const mid = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const rows = await db`
    SELECT i.id, i.sound_key, t.label, t.pronunciation
    FROM items i JOIN taxonomy t ON t.id = i.taxonomy_slug
    WHERE i.child_id = ${childId}`;
  // Replace only seeded clips + empty slots; a parent's own recording (any
  // other key) is theirs and never overwritten.
  const seeded = (k) => !k || (String(k).startsWith('onboarding/') && String(k).includes('/voice/'));

  const byKey = new Map();   // target soundKey → { text, ids:[…] }
  let already = 0;
  for (const r of rows) {
    if (!seeded(r.sound_key)) continue;
    const text = String(r.pronunciation || r.label || '').trim().slice(0, 300);
    if (!text) continue;
    const stamp = createHash('sha256').update(`${mid}|${vid}|default|${text}`).digest('hex').slice(0, 16);
    const soundKey = `onboarding/${childId}/voice/tts-${stamp}.mp3`;
    if (r.sound_key === soundKey) { already++; continue; }
    if (!byKey.has(soundKey)) byKey.set(soundKey, { text, ids: [] });
    byKey.get(soundKey).ids.push(r.id);
  }

  let updated = 0, failed = 0, done = 0;
  const total = byKey.size;
  for (const [soundKey, { text, ids }] of byKey) {
    if (done >= SOUND_TEXTS_PER_CALL) break;
    done++;
    const mp3 = await synthesizeVoice({ text, voiceId, db, childId, kind: 'publish' });
    if (!mp3) { failed++; continue; }
    try {
      await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
    } catch (_) { failed++; continue; }
    await db`UPDATE items SET sound_key = ${soundKey}, updated_at = NOW()
             WHERE id = ANY(${ids}) AND child_id = ${childId}`;
    updated += ids.length;
  }
  return { updated, failed, already, partial: done < total };
}

async function ensureLog(db) {
  await db`
    CREATE TABLE IF NOT EXISTS publish_log (
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      detail TEXT,
      what TEXT NOT NULL,
      child_id TEXT NOT NULL,
      counts JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const children = await targetChildren(db, {
        scope: String(q.scope || 'all'), styleGuideId: q.styleGuideId, child: q.child,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, total: children.length, children: children.slice(0, 100) });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    const what = (typeof b.what === 'object' && b.what) || {};
    if (!what.layout && !what.sounds) { res.status(400).json({ error: 'pick something to push (layout and/or sounds)' }); return; }

    const children = await targetChildren(db, b);
    if (!children.length) { res.status(200).json({ ok: true, total: 0, results: [], nextOffset: 0, done: true }); return; }

    await ensureLog(db);
    const offset = Math.max(0, Math.floor(Number(b.offset) || 0));
    // Sounds do blob work per board — keep chunks small; layout-only is cheap.
    const cap = what.sounds ? 2 : 10;
    const limit = Math.min(cap, Math.max(1, Math.floor(Number(b.limit) || cap)));
    const slice = children.slice(offset, offset + limit);

    const results = [];
    let advanced = 0;
    for (const childId of slice) {
      const r = { childId };
      if (what.layout) r.layout = await pushLayout(db, childId);
      if (what.sounds) r.sounds = await pushSounds(db, childId);
      results.push(r);
      try {
        await db`INSERT INTO publish_log (scope, detail, what, child_id, counts)
                 VALUES (${String(b.scope || 'all')},
                         ${String(b.scope === 'style' ? b.styleGuideId : b.scope === 'child' ? b.child : '') || null},
                         ${[what.layout && 'layout', what.sounds && 'sounds'].filter(Boolean).join('+')},
                         ${childId}, ${JSON.stringify({ layout: r.layout || null, sounds: r.sounds || null })})`;
      } catch (_) { /* log is best-effort */ }
      // A board that hit the per-call sound cap resumes at the SAME offset on
      // the next call (already-pushed clips skip via the derived key).
      if (r.sounds && r.sounds.partial) break;
      advanced++;
    }

    // A partial board was not advanced past, so nextOffset < total keeps the
    // caller looping until every board completes.
    const nextOffset = offset + advanced;
    res.status(200).json({ ok: true, total: children.length, results, nextOffset,
                           done: nextOffset >= children.length });
  } catch (err) {
    res.status(500).json({ error: 'publish failed', detail: String(err.message || err) });
  }
}
