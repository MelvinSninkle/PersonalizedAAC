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
//   GET                      → { voices, tiles, built: {voiceId: count},
//                                coverage, synonymTerms }
//   POST { op:'build', voiceIds:['..'] }                    → label clips (≤ ~4 min)
//   POST { op:'build', voiceIds:['..'], scope:'synonyms' }  → synonym clips
//
// SYNONYM CLIPS (scope:'synonyms'): the curated slice of every tile's match
// set (curatedSpokenTerms — synonym sets, irregular forms, per-row curated
// terms; never the machine-generated inflections) renders per voice to
//     voice-terms/<voiceId>/<slug(term)>.mp3
// so a sentence staged via a spoken synonym plays the child's OWN voice
// offline instead of metered TTS. NOT public (authenticated boards reach it
// through media.js's shared-library branch) and NEVER counted in
// clips_built/clips_total — folding them in would drop every voice below
// /api/demo's completeness gate and empty the public practice picker.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { synthesizeVoice } from '../_lib/onboarding-render.js';
import { VOICE_SAMPLE_TEXT } from '../_lib/voices.js';
import { curatedSpokenTerms } from '../_lib/word-match.js';
import { put, list } from '@vercel/blob';
import { createHash } from 'node:crypto';

export const config = { maxDuration: 300 };

export const demoSlug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Fact-clip key derivation — MUST stay in LOCKSTEP with practice.html's
// factHash and iOS GameAudio.factHash: NFC-normalize, trim, collapse internal
// whitespace to single spaces, sha256 hex, first 16 chars. The hash covers
// EXACTLY the text handed to synthesizeVoice (no lowercasing/stripping — the
// fact text IS the synthesis input). Keys live under demo-audio/<vid>/facts/
// so they ride the public media prefix the signed-out practice board can
// reach, while staying separately listable for coverage.
export const factNorm = (s) => String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ');
export const factHash = (s) => createHash('sha256').update(factNorm(s), 'utf8').digest('hex').slice(0, 16);

async function demoLabels(db) {
  // ALL placeable canonical/universal labels — no default_image_key gate:
  // styled demos show person-referencing tiles (People/Verbs/Needs) too, so
  // their words need clips. Each entry carries the SPOKEN text separately:
  // boards speak `pronunciation || label` (seed-board's spokenTextFor — the
  // Voice-QC phonetic overrides), so the demo must synthesize the same text
  // or it both misses the shared TTS cache AND pronounces words differently
  // from every real board. The blob key stays label-slugged (practice.html
  // addresses clips by label).
  let rows;
  try {
    rows = await db`
      SELECT DISTINCT label, pronunciation FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'`;
  } catch (_) {
    rows = await db`
      SELECT DISTINCT label FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'`;
  }
  // DISTINCT on (label, pronunciation) can dupe a label — keep the first
  // row that carries a pronunciation, else the plain one.
  const byLabel = new Map();
  for (const r of rows) {
    const cur = byLabel.get(r.label);
    if (!cur || (!cur.speak_override && r.pronunciation)) {
      byLabel.set(r.label, { label: r.label, speak_override: r.pronunciation || null });
    }
  }
  return [...byLabel.values()].map((r) => ({ label: r.label, speak: r.speak_override || r.label }));
}

// The curated spoken terms across the same taxonomy slice demoLabels covers,
// deduped by slug (two terms slugging identically share one clip — first
// wins). Terms synthesize VERBATIM: pronunciation overrides are keyed to the
// LABEL, and a synonym clip must say the synonym.
async function synonymTerms(db) {
  let rows;
  try {
    rows = await db`
      SELECT DISTINCT label, match_terms FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'`;
  } catch (_) {
    rows = await db`
      SELECT DISTINCT label FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'`;
  }
  const bySlug = new Map();
  for (const r of rows) {
    for (const t of curatedSpokenTerms(r.label, r.match_terms || [])) {
      const slug = demoSlug(t);
      if (slug && !bySlug.has(slug)) bySlug.set(slug, t);
    }
  }
  return [...bySlug.values()].sort();
}

// Every teaching fact the boards speak (descriptive_clues, first 3 per row —
// the same slice every client plays), deduped by hash, verbatim text.
async function demoFacts(db) {
  let rows;
  try {
    rows = await db`
      SELECT label, descriptive_clues FROM taxonomy
      WHERE COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND COALESCE(is_gestalt, FALSE) = FALSE
        AND COALESCE(authoring_kind, 'canonical') = 'canonical'
        AND COALESCE(audience, 'universal') = 'universal'`;
  } catch (_) { return []; }
  const byHash = new Map();
  for (const r of rows) {
    for (const c of (Array.isArray(r.descriptive_clues) ? r.descriptive_clues : []).filter(Boolean).slice(0, 3)) {
      const text = factNorm(c);
      if (!text) continue;
      const h = factHash(text);
      if (!byHash.has(h)) byHash.set(h, text);
    }
  }
  return [...byHash.entries()].map(([hash, text]) => ({ hash, text }));
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
  // Clip counters — /api/demo offers a voice on the public practice board
  // ONLY when clips_built >= clips_total (a half-built voice would silently
  // fall back to device speech and sound nothing like the product).
  await db`ALTER TABLE demo_voices ADD COLUMN IF NOT EXISTS clips_built INT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE demo_voices ADD COLUMN IF NOT EXISTS clips_total INT NOT NULL DEFAULT 0`;

  try {
    const labels = await demoLabels(db);
    const terms = await synonymTerms(db);
    const facts = await demoFacts(db);

    if (req.method === 'GET') {
      const voices = await db`SELECT voice_id, name FROM demo_voices ORDER BY name`;
      const built = {};
      // TRUE set comparison per voice — clips on hand vs the ENTIRE current
      // taxonomy. A raw blob count lies as soon as the taxonomy moves: grow
      // it by 10 words while 10 orphaned clips (renamed/retired labels)
      // linger and the count still reads "complete". Instead:
      //   have    = taxonomy labels whose clip exists
      //   missing = taxonomy labels with no clip (+ the label list, capped)
      //   orphans = clips matching no current label (harmless, never played)
      const coverage = {};
      for (const v of voices) {
        // Fact clips live under a /facts/ sub-path of the SAME prefix (public
        // media whitelist) — exclude them from the label count and the orphan
        // sweep or every fact would read as an orphaned label clip.
        const allKeys = await existingKeys(`demo-audio/${v.voice_id}/`);
        const keys = new Set([...allKeys].filter((k) => !k.includes('/facts/')));
        built[v.voice_id] = keys.size;
        const sampleKey = `demo-audio/${v.voice_id}/voice-sample.mp3`;
        const wanted = new Set(labels.map((l) => `demo-audio/${v.voice_id}/${demoSlug(l.label)}.mp3`));
        const missingLabels = labels.filter((l) => !keys.has(`demo-audio/${v.voice_id}/${demoSlug(l.label)}.mp3`))
                                    .map((l) => l.label);
        let orphans = 0;
        for (const k of keys) { if (!wanted.has(k) && k !== sampleKey) orphans++; }
        // Synonym coverage rides SEPARATELY — see the header: it must never
        // count toward clips_built/clips_total (the /api/demo public gate).
        const tkeys = await existingKeys(`voice-terms/${v.voice_id}/`);
        const missingTerms = terms.filter((t) => !tkeys.has(`voice-terms/${v.voice_id}/${demoSlug(t)}.mp3`));
        coverage[v.voice_id] = {
          have: labels.length - missingLabels.length,
          missing: missingLabels.length,
          missingLabels: missingLabels.slice(0, 60),
          missingSample: !keys.has(sampleKey),
          orphans,
          synTotal: terms.length,
          synHave: terms.length - missingTerms.length,
          synMissing: missingTerms.length,
          factTotal: facts.length,
          factHave: facts.filter((f) => allKeys.has(`demo-audio/${v.voice_id}/facts/${f.hash}.mp3`)).length,
          factMissing: facts.filter((f) => !allKeys.has(`demo-audio/${v.voice_id}/facts/${f.hash}.mp3`)).length,
        };
        // Keep the PUBLIC /api/demo completeness gate honest without waiting
        // for the next build: counters follow the true comparison.
        try {
          await db`UPDATE demo_voices
                   SET clips_built = ${labels.length - missingLabels.length}, clips_total = ${labels.length}
                   WHERE voice_id = ${v.voice_id}`;
        } catch (_) {}
      }
      res.status(200).json({ ok: true, tiles: labels.length, voices, built, coverage,
                             synonymTerms: terms, factCount: facts.length });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    if (b.op !== 'build') { res.status(400).json({ error: 'unknown op' }); return; }
    const voiceIds = (Array.isArray(b.voiceIds) ? b.voiceIds : []).map(String).slice(0, 4);
    if (!voiceIds.length) { res.status(400).json({ error: 'voiceIds required' }); return; }

    // Synonym-clip build: voice-terms/<vid>/ only. Deliberately does NOT
    // register the voice in demo_voices or touch its clip counters — synonym
    // clips serve real boards' sentence playback, not the practice picker.
    if (b.scope === 'synonyms') {
      const deadline = Date.now() + 240_000;
      const stats = { cached: 0, generated: 0 };
      let built = 0, skipped = 0, remaining = 0;
      for (const vid of voiceIds) {
        const have = await existingKeys(`voice-terms/${vid}/`);
        for (const term of terms) {
          const key = `voice-terms/${vid}/${demoSlug(term)}.mp3`;
          if (have.has(key)) { skipped++; continue; }
          if (Date.now() > deadline) { remaining++; continue; }
          try {
            const buf = await synthesizeVoice({ text: term, voiceId: vid, stats });
            if (buf) {
              await put(key, buf, { access: 'private', addRandomSuffix: false, contentType: 'audio/mpeg' });
              built++;
            } else { remaining++; }
          } catch (_) { remaining++; }
        }
      }
      res.status(200).json({ ok: true, built, skipped, remaining,
        fromCache: stats.cached, generated: stats.generated,
        note: (built > 0
          ? `${stats.cached} copied free from your existing voice cache, ${stats.generated} newly generated. `
          : '') + (remaining > 0 ? 'Run build again to finish the rest.' : 'Complete.') });
      return;
    }

    // Teaching-fact build: demo-audio/<vid>/facts/ only — same rules as the
    // synonyms scope (no demo_voices registration, no clip counters).
    if (b.scope === 'facts') {
      const deadline = Date.now() + 240_000;
      const stats = { cached: 0, generated: 0 };
      let built = 0, skipped = 0, remaining = 0;
      for (const vid of voiceIds) {
        const have = await existingKeys(`demo-audio/${vid}/facts/`);
        for (const f of facts) {
          const key = `demo-audio/${vid}/facts/${f.hash}.mp3`;
          if (have.has(key)) { skipped++; continue; }
          if (Date.now() > deadline) { remaining++; continue; }
          try {
            const buf = await synthesizeVoice({ text: f.text, voiceId: vid, stats });
            if (buf) {
              await put(key, buf, { access: 'private', addRandomSuffix: false, contentType: 'audio/mpeg' });
              built++;
            } else { remaining++; }
          } catch (_) { remaining++; }
        }
      }
      res.status(200).json({ ok: true, built, skipped, remaining,
        fromCache: stats.cached, generated: stats.generated,
        note: (built > 0
          ? `${stats.cached} copied free from your existing voice cache, ${stats.generated} newly generated. `
          : '') + (remaining > 0 ? 'Run build again to finish the rest.' : 'Complete.') });
      return;
    }

    // Record the chosen voices (name from the catalog) for /api/demo.
    const catalog = await db`SELECT id, name FROM voices`;
    for (const vid of voiceIds) {
      const name = catalog.find((v) => v.id === vid)?.name || vid;
      await db`INSERT INTO demo_voices (voice_id, name) VALUES (${vid}, ${name})
               ON CONFLICT (voice_id) DO UPDATE SET name = ${name}`;
    }

    const deadline = Date.now() + 240_000;   // leave headroom under maxDuration
    // stats splits each run into FREE cache copies (words this voice has
    // already spoken anywhere in the product) vs fresh ElevenLabs spend —
    // for a live voice, a "build" is mostly a copy job, and the panel says so.
    const stats = { cached: 0, generated: 0 };
    let built = 0, skipped = 0, remaining = 0;
    for (const vid of voiceIds) {
      const have = await existingKeys(`demo-audio/${vid}/`);
      let vDone = 0;
      // The voice's introduction clip — the SAME tongue-twister sample text
      // onboarding plays, so the practice page's voice switcher sounds like
      // the product instead of the device voice reading a stock line. Fixed
      // key (not label-slugged) so it can never collide with a real word;
      // deliberately NOT counted in clips_built/clips_total — the /api/demo
      // completeness gate predates this clip and must not flap for voices
      // that were already fully built.
      const sampleKey = `demo-audio/${vid}/voice-sample.mp3`;
      if (!have.has(sampleKey) && Date.now() <= deadline) {
        try {
          const buf = await synthesizeVoice({ text: VOICE_SAMPLE_TEXT, voiceId: vid, stats });
          if (buf) { await put(sampleKey, buf, { access: 'private', addRandomSuffix: false, contentType: 'audio/mpeg' }); built++; }
        } catch (_) { remaining++; }
      }
      for (const item of labels) {
        const key = `demo-audio/${vid}/${demoSlug(item.label)}.mp3`;
        if (have.has(key)) { skipped++; vDone++; continue; }
        if (Date.now() > deadline) { remaining++; continue; }
        try {
          const buf = await synthesizeVoice({ text: item.speak, voiceId: vid, stats });
          if (buf) {
            await put(key, buf, { access: 'private', addRandomSuffix: false, contentType: 'audio/mpeg' });
            built++; vDone++;
          } else { remaining++; }
        } catch (_) { remaining++; }
      }
      // Refresh the voice's clip counters — /api/demo's completeness gate.
      try {
        await db`UPDATE demo_voices SET clips_built = ${vDone}, clips_total = ${labels.length}
                 WHERE voice_id = ${vid}`;
      } catch (_) {}
    }
    res.status(200).json({ ok: true, built, skipped, remaining,
      fromCache: stats.cached, generated: stats.generated,
      note: (built > 0
        ? `${stats.cached} copied free from your existing voice cache, ${stats.generated} newly generated. `
        : '') + (remaining > 0 ? 'Run build again to finish the rest.' : 'Complete.') });
  } catch (err) {
    res.status(500).json({ error: 'demo-audio failed', detail: String(err.message || err) });
  }
}
