// /api/admin/lab?action=demo-audio  (admin only)
//
// One-time (resumable) synthesis of the public practice board's audio. The
// practice page must NEVER expose live TTS (an unauthenticated ElevenLabs
// spender), so every starter-board label is pre-rendered per chosen voice to
// a DETERMINISTIC key the page can construct without a manifest:
//     demo-audio/<voiceId>/<slug(label)>.mp3
// Existing keys are skipped, so re-running resumes where the time budget cut
// it off. synthesizeVoice()'s shared render cache means labels already spoken
// anywhere in the product cost nothing to re-render here.
//
//   GET                      → { voices, tiles, built: {voiceId: count} }
//   POST { op:'build', voiceIds:['..'] } → synth missing clips (≤ ~4 min)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { synthesizeVoice } from '../_lib/onboarding-render.js';
import { put, list } from '@vercel/blob';

export const config = { maxDuration: 300 };

export const demoSlug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function demoLabels(db) {
  // ALL placeable canonical/universal labels — no default_image_key gate:
  // styled demos show person-referencing tiles (People/Verbs/Needs) too, so
  // their words need clips. The shared TTS cache makes re-builds cheap.
  const rows = await db`
    SELECT DISTINCT label FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'`;
  return rows.map((r) => r.label);
}

async function existingKeys(prefix) {
  const keys = new Set();
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) keys.add(b.pathname);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return keys;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS demo_voices (
    voice_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '' )`;

  try {
    const labels = await demoLabels(db);

    if (req.method === 'GET') {
      const voices = await db`SELECT voice_id, name FROM demo_voices ORDER BY name`;
      const built = {};
      for (const v of voices) {
        built[v.voice_id] = (await existingKeys(`demo-audio/${v.voice_id}/`)).size;
      }
      res.status(200).json({ ok: true, tiles: labels.length, voices, built });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    if (b.op !== 'build') { res.status(400).json({ error: 'unknown op' }); return; }
    const voiceIds = (Array.isArray(b.voiceIds) ? b.voiceIds : []).map(String).slice(0, 4);
    if (!voiceIds.length) { res.status(400).json({ error: 'voiceIds required' }); return; }

    // Record the chosen voices (name from the catalog) for /api/demo.
    const catalog = await db`SELECT id, name FROM voices`;
    for (const vid of voiceIds) {
      const name = catalog.find((v) => v.id === vid)?.name || vid;
      await db`INSERT INTO demo_voices (voice_id, name) VALUES (${vid}, ${name})
               ON CONFLICT (voice_id) DO UPDATE SET name = ${name}`;
    }

    const deadline = Date.now() + 240_000;   // leave headroom under maxDuration
    let built = 0, skipped = 0, remaining = 0;
    for (const vid of voiceIds) {
      const have = await existingKeys(`demo-audio/${vid}/`);
      for (const label of labels) {
        const key = `demo-audio/${vid}/${demoSlug(label)}.mp3`;
        if (have.has(key)) { skipped++; continue; }
        if (Date.now() > deadline) { remaining++; continue; }
        try {
          const buf = await synthesizeVoice({ text: label, voiceId: vid });
          if (buf) {
            await put(key, buf, { access: 'private', addRandomSuffix: false, contentType: 'audio/mpeg' });
            built++;
          } else { remaining++; }
        } catch (_) { remaining++; }
      }
    }
    res.status(200).json({ ok: true, built, skipped, remaining,
      note: remaining > 0 ? 'Run build again to finish the rest.' : 'Complete.' });
  } catch (err) {
    res.status(500).json({ error: 'demo-audio failed', detail: String(err.message || err) });
  }
}
