// POST /api/generate-descriptions — JSON body { label, section?, category?, kind? }.
// Returns { descriptions: [ ... ] } — 2-3 short, warm, child-directed TEACHING
// descriptions for a tile, each from a different angle (function / feature /
// context), so a young child builds real understanding of the word and not
// just picture-recognition. Feeds board learn-mode + the Auditory Comprehension
// game, and the taxonomy `descriptive_clues` backfill. Auth-gated; needs
// OPENAI_API_KEY.
import { checkAuth } from './_lib/auth.js';

export const config = { maxDuration: 30 };

// The voice — locked in from the pilot the parent approved. Edit here to tune
// the tone for every tile at once.
const VOICE = `You write short, warm teaching descriptions for tiles on a young child's AAC communication board. The child is a non-verbal toddler and may be a gestalt language processor. The goal is REAL understanding of the word — not just recognizing a picture.

Write 2 to 3 descriptions, each from a DIFFERENT angle:
1. FUNCTION — what you do with it, or what it is for.
2. FEATURE — what it has, or what it looks like (concrete and perceptual).
3. CONTEXT — where you find it, what it goes with, or when you use it.

Rules:
- Talk directly TO the child, using "you".
- Each description is ONE short, simple sentence, about 6-14 words. Concrete, no jargon.
- Add a gentle safety note when it matters (e.g. hot, sharp).
- For a DESCRIBING word (adjective): use (a) a simple meaning, often paired with its opposite, (b) two or three quick everyday examples, (c) a short phrase the child could actually say.
- For a PERSON or a family relationship: write ONLY ONE description that explains the relationship in plain family terms (e.g. "This is your mom's mother — your grandma on your mom's side."). Do NOT invent personal facts, names, places, or history; those are added by the family.
- Never invent specifics you cannot possibly know.
Respond with strict JSON only: {"descriptions":["...","..."]}.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY env var not configured' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const label = String(b.label || '').slice(0, 80).trim();
  if (!label) { res.status(400).json({ error: 'label required' }); return; }
  const section = String(b.section || '').toLowerCase().slice(0, 40);
  const category = String(b.category || '').slice(0, 80);

  // Tell the model what kind of word this is so it picks the right pattern.
  // Caller can override with an explicit `kind`; otherwise infer from section.
  const kind = String(b.kind || '').toLowerCase().slice(0, 20) || (
    section === 'people' ? 'person / family relationship'
      : section === 'verbs' ? 'action (verb)'
      : (category.toLowerCase().includes('describ') || category.toLowerCase().includes('feeling')) ? 'describing word (adjective)'
      : 'thing (noun)'
  );

  const userMsg =
    `Word: "${label}".` +
    (section ? ` Board section: ${section}.` : '') +
    (category ? ` Category: ${category}.` : '') +
    ` This word is a ${kind}.`;

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: VOICE },
          { role: 'user', content: userMsg },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.5,
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      res.status(upstream.status).json({ error: 'Description generation failed', detail: detail.slice(0, 400) });
      return;
    }
    const data = await upstream.json();
    let out = {};
    try { out = JSON.parse(data.choices[0].message.content); } catch (_) {}
    const list = (Array.isArray(out.descriptions) ? out.descriptions : [])
      .map((s) => (typeof s === 'string' ? s.trim().slice(0, 240) : ''))
      .filter(Boolean)
      .slice(0, 4);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ descriptions: list });
  } catch (err) {
    res.status(502).json({ error: 'Description generation failed', detail: String(err.message || err) });
  }
}
