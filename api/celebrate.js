// GET  /api/celebrate?childId=&date=YYYY-MM-DD  → today's special-day events
// POST /api/celebrate                            { childId, eventKey, model? }
//      Ensure the celebration image exists for THIS YEAR's instance,
//      generating it lazily on the first ask of the season.
//
// On boot / visibility-change the kid app polls GET; if today matches an
// event it asks for the image (POST, idempotent — cached per child+key+year),
// then renders a full-screen celebration modal once that day.
//
// Reuses the existing person anchors (subject = the child; family_adult = a
// close family member), the active style guide, the Gemini image pipeline
// (Nano Banana default), and archives every generated picture to the parent's
// album so every year's celebration becomes part of the memorabilia stream.
import { put } from '@vercel/blob';
import { readBlobBytes as readBlob } from './_lib/blob.js';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { eventsOnDate, EVENT_KEYS } from './_lib/event-dates.js';
import { geminiKey, geminiDefaultModel, isGeminiModel, geminiCostCents, geminiGenerateImage } from './_lib/gemini.js';

export const config = { maxDuration: 300 };

const VALID_EVENT_KEYS = new Set(EVENT_KEYS);

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS event_images (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      year INTEGER NOT NULL,
      blob_key TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      cost_cents NUMERIC(10,4),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (child_id, event_key, year)
    )`;
}

async function resolveAnchors(db, childId) {
  const self = (await db`SELECT given_name, display_name, reference_key FROM persons
                         WHERE child_id = ${childId} AND is_self = TRUE AND reference_key IS NOT NULL LIMIT 1`)[0];
  const adult = (await db`
    SELECT given_name, display_name, reference_key, relationship FROM persons
    WHERE child_id = ${childId} AND reference_key IS NOT NULL
      AND relationship IN ('mother','father','stepmother','stepfather','guardian','grandmother','grandfather')
    ORDER BY array_position(ARRAY['mother','father','stepmother','stepfather','guardian','grandmother','grandfather']::text[], relationship)
    LIMIT 1`)[0] || self;
  return { self, adult };
}

function fillTemplate(t, tokens) {
  return String(t || '').replace(/\{([a-z_]+)\}/gi, (m, k) => Object.prototype.hasOwnProperty.call(tokens, k) ? tokens[k] : m);
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const childId = String(((req.query && req.query.childId) || (req.body && req.body.childId) || '')).slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }
  const db = sql();
  await ensureTable(db);

  if (req.method === 'GET') {
    try {
      const dateStr = String((req.query && req.query.date) || '');
      const today = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + 'T12:00:00') : new Date();
      const me = (await db`SELECT birth_date FROM persons WHERE child_id = ${childId} AND is_self = TRUE LIMIT 1`)[0];
      const keys = eventsOnDate(today, me ? me.birth_date : null);
      if (!keys.length) { res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ events: [] }); return; }
      const year = today.getFullYear();
      const cached = await db`SELECT event_key, blob_key FROM event_images WHERE child_id = ${childId} AND event_key = ANY(${keys}) AND year = ${year}`;
      const byKey = new Map(cached.map(r => [r.event_key, r.blob_key]));
      const ids = keys.map(k => 'events.' + k);
      const labels = await db`SELECT id, label FROM taxonomy WHERE id = ANY(${ids})`;
      const labelByKey = new Map(labels.map(r => [r.id.replace(/^events\./, ''), r.label]));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        events: keys.map(k => ({
          eventKey: k,
          label: labelByKey.get(k) || k,
          hasTaxonomy: labelByKey.has(k),
          blobKey: byKey.get(k) || null,
          year,
        })),
      });
    } catch (err) { res.status(500).json({ error: 'Events lookup failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'POST') {
    const b = (typeof req.body === 'object' && req.body) || {};
    const eventKey = String(b.eventKey || '').trim();
    if (!VALID_EVENT_KEYS.has(eventKey)) { res.status(400).json({ error: 'invalid eventKey', allowed: [...VALID_EVENT_KEYS] }); return; }

    try {
      const year = new Date().getFullYear();
      const existing = (await db`SELECT blob_key FROM event_images WHERE child_id = ${childId} AND event_key = ${eventKey} AND year = ${year} LIMIT 1`)[0];
      if (existing) { res.status(200).json({ ok: true, blobKey: existing.blob_key, cached: true }); return; }

      const tax = (await db`SELECT id, label, prompt_template FROM taxonomy WHERE id = ${'events.' + eventKey} LIMIT 1`)[0];
      if (!tax) { res.status(404).json({ error: 'event taxonomy row missing — re-run the seed' }); return; }
      const { self, adult } = await resolveAnchors(db, childId);
      const styleRow = (await db`SELECT id, label, blob_key FROM style_guides WHERE active = TRUE ORDER BY sort_order ASC, created_at ASC LIMIT 1`)[0] || null;
      const refPhrase = self ? (self.given_name || self.display_name || 'the child') : 'a friendly young child';
      const famPhrase = adult ? (adult.given_name || adult.display_name || 'a family member') : 'a warm, friendly adult family member';

      let prompt = fillTemplate(tax.prompt_template, {
        style: 'picture', reference: refPhrase, family_adult: famPhrase,
        family_all: 'the whole family gathered close around', parent_photo: '',
      });

      const images = [];
      const legend = [];
      if (styleRow && styleRow.blob_key) {
        try { const sb = await readBlob(styleRow.blob_key); images.push({ buf: sb, name: 'style.jpg' }); legend.push(`Image ${images.length} is the STYLE reference — copy its art style only, not its content.`); }
        catch (_) {}
      }
      if (self && self.reference_key) {
        try { const sub = await readBlob(self.reference_key); images.push({ buf: sub, name: 'subject.jpg' }); legend.push(`Image ${images.length} shows ${refPhrase} — keep this person's face and likeness clearly recognizable.`); }
        catch (_) {}
      }
      if (adult && adult.reference_key && (!self || adult.reference_key !== self.reference_key)) {
        try { const fb = await readBlob(adult.reference_key); images.push({ buf: fb, name: 'family.jpg' }); legend.push(`Image ${images.length} shows ${famPhrase} — keep this person's face and likeness clearly recognizable.`); }
        catch (_) {}
      }
      if (legend.length) prompt += '\n\n' + legend.join(' ');

      const gKey = geminiKey();
      const model = isGeminiModel(b.model) ? b.model : geminiDefaultModel();
      if (!gKey) { res.status(500).json({ error: 'GEMINI_API_KEY not configured' }); return; }
      const g = await geminiGenerateImage({
        apiKey: gKey, model, prompt,
        images: images.map(im => ({ buffer: im.buf.buffer, contentType: im.buf.contentType })),
      });
      if (!g.ok) { res.status(g.status === 429 ? 429 : 502).json({ error: 'Event generation failed', detail: (g.detail || '').slice(0, 1000) }); return; }
      const pngBuffer = Buffer.from(g.b64, 'base64');
      const blobKey = `events/${childId}/${eventKey}-${year}-${randomUUID()}.png`;
      await put(blobKey, pngBuffer, { access: 'private', contentType: 'image/png', addRandomSuffix: false });

      const costCents = geminiCostCents(model);
      await db`INSERT INTO event_images (child_id, event_key, year, blob_key, prompt, model, cost_cents)
               VALUES (${childId}, ${eventKey}, ${year}, ${blobKey}, ${prompt}, ${model}, ${costCents})
               ON CONFLICT (child_id, event_key, year) DO NOTHING`;
      // Every year's celebration lands in the album alongside tile history.
      try {
        await db`INSERT INTO item_image_history (child_id, item_id, item_label, section, blob_key, prompt, model, source, archived_by)
                 VALUES (${childId}, NULL, ${tax.label + ' ' + year}, 'Events', ${blobKey}, ${prompt}, ${model}, 'event', ${auth.user.email || null})`;
      } catch (_) {}
      try {
        await db`INSERT INTO image_generations (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
                 VALUES (${childId}, ${auth.user.email || null}, ${auth.user.role || null}, ${'event:' + eventKey}, ${styleRow ? styleRow.label : 'event'}, ${prompt}, '1024x1024', ${costCents})`;
      } catch (_) {}

      res.status(200).json({ ok: true, blobKey, cached: false });
    } catch (err) { res.status(500).json({ error: 'Event generation failed', detail: String(err.message || err) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
