// /api/admin/lab?action=voices  (admin only)
//
// Voice catalog management — voices are DATA, not code. Add an ElevenLabs
// voice id here and the onboarding picker (api/onboarding/voices.js reads the
// same table) offers it immediately: no code change, no deploy. The Lab's
// sound-library bench uses the same list for per-voice QC (listen/regenerate
// go straight through /api/tts, whose Blob cache is what every board plays).
//
//   GET → { voices:[{id,name,gender,accent,active,sortOrder}] }   (incl. inactive)
//   POST { id, name?, gender?, accent? } → add. When name is omitted we ask
//     the ElevenLabs API for the voice's metadata (best-effort) so adding a
//     voice is usually just pasting the id.
//   PATCH ?id=  { name?, gender?, accent?, active?, sortOrder? }
//   DELETE ?id=
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureVoicesTable, listVoices } from '../_lib/voices.js';

export const config = { maxDuration: 30 };

const ID_RE = /^[A-Za-z0-9]{8,40}$/;

// Best-effort metadata lookup so "add a voice" = paste the id.
async function elevenLabsVoice(id) {
  const key = process.env.Fletchers_AAC_Device;
  if (!key) return null;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
      headers: { 'xi-api-key': key },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const labels = (d && d.labels) || {};
    return {
      name: (d && d.name) || null,
      gender: labels.gender ? labels.gender[0].toUpperCase() + labels.gender.slice(1) : null,
      accent: labels.accent ? labels.accent[0].toUpperCase() + labels.accent.slice(1) : null,
    };
  } catch (_) { return null; }
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureVoicesTable(db);
  const b = (typeof req.body === 'object' && req.body) || {};

  try {
    if (req.method === 'GET') {
      const voices = await listVoices(db, { includeInactive: true });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, voices: voices.map(v => ({
        id: v.id, name: v.name, gender: v.gender, accent: v.accent,
        active: !!v.active, sortOrder: v.sort_order,
      })) });
      return;
    }

    if (req.method === 'POST') {
      const id = String(b.id || '').trim();
      if (!ID_RE.test(id)) { res.status(400).json({ error: 'id must be an ElevenLabs voice id (8-40 alphanumerics)' }); return; }
      let name = String(b.name || '').trim().slice(0, 60);
      let gender = String(b.gender || '').trim().slice(0, 20) || null;
      let accent = String(b.accent || '').trim().slice(0, 40) || null;
      let looked = null;
      if (!name || !accent || !gender) looked = await elevenLabsVoice(id);
      if (!name) name = (looked && looked.name) || id.slice(0, 8);
      if (!gender && looked) gender = looked.gender;
      if (!accent && looked) accent = looked.accent;
      const maxSort = (await db`SELECT COALESCE(max(sort_order), -1)::int AS m FROM voices`)[0].m;
      await db`INSERT INTO voices (id, name, gender, accent, active, sort_order)
               VALUES (${id}, ${name}, ${gender}, ${accent}, TRUE, ${maxSort + 1})
               ON CONFLICT (id) DO UPDATE SET name = ${name}, gender = ${gender}, accent = ${accent}`;
      res.status(200).json({ ok: true, voice: { id, name, gender, accent, active: true, sortOrder: maxSort + 1 },
                             lookedUp: !!looked });
      return;
    }

    const id = String((req.query && req.query.id) || '').trim();
    if (!ID_RE.test(id)) { res.status(400).json({ error: 'id required' }); return; }

    if (req.method === 'PATCH') {
      const cur = (await db`SELECT id FROM voices WHERE id = ${id} LIMIT 1`)[0];
      if (!cur) { res.status(404).json({ error: 'not found' }); return; }
      await db`UPDATE voices SET
        name       = COALESCE(${typeof b.name === 'string' ? b.name.trim().slice(0, 60) : null}, name),
        gender     = CASE WHEN ${'gender' in b} THEN ${b.gender ? String(b.gender).slice(0, 20) : null} ELSE gender END,
        accent     = CASE WHEN ${'accent' in b} THEN ${b.accent ? String(b.accent).slice(0, 40) : null} ELSE accent END,
        active     = COALESCE(${typeof b.active === 'boolean' ? b.active : null}, active),
        sort_order = COALESCE(${Number.isInteger(b.sortOrder) ? b.sortOrder : null}, sort_order)
        WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      // Deactivate-not-delete would also be fine; a hard delete is allowed but
      // children already using the voice keep it (child_settings.voiceId is a
      // copy) — their existing cached clips keep playing.
      await db`DELETE FROM voices WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'voices failed', detail: String(err.message || err) });
  }
}
