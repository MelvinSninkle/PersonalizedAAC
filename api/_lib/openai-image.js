// OpenAI gpt-image generation for the KEYSTONE images (onboarding portraits +
// scene). Gemini is excellent at repeating a locked character across tiles but
// weak at copying an arbitrary art style from a reference; OpenAI's gpt-image
// edits endpoint handles style transfer much better, so the keystones (which set
// the look everything else copies) go through here. Bulk tiles stay on Gemini.
//
// images: [{ buffer, contentType, name? }] — passed as multi-image `image[]`,
// in order (e.g. [style reference, real photo]); the prompt refers to IMAGE 1/2.

// The keystone image model, resolved in priority order:
//   1. lab_settings.model_defaults.keystone  (set from the Portrait Lab — drives prod)
//   2. env OPENAI_KEYSTONE_MODEL
//   3. 'gpt-image-1.5' — Lab testing showed anything below 1.5 doesn't hold up
//      for portraits, so the floor IS 1.5; never default lower.
export async function openaiKeystoneModel(db) {
  try {
    if (db) {
      const r = await db`SELECT model_defaults FROM lab_settings WHERE id = 1`;
      const k = r && r[0] && r[0].model_defaults && r[0].model_defaults.keystone;
      if (typeof k === 'string' && k.trim()) return k.trim();
    }
  } catch (_) { /* fall through to env/default */ }
  return process.env.OPENAI_KEYSTONE_MODEL || 'gpt-image-1.5';
}

// Ask OpenAI which gpt-image-* models THIS account can actually use, so the Lab
// shows real options instead of guesses. Returns a sorted list of model ids.
export async function listOpenaiImageModels(apiKey) {
  if (!apiKey) return [];
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + apiKey } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).map((m) => m.id).filter((id) => /^gpt-image/.test(id)).sort();
  } catch (_) { return []; }
}

// Flat per-image cost (cents) by gpt-image tier — the single source of truth
// for the cost ladder otherwise duplicated across the Lab + category-icon paths.
export function openaiCostCents(model) {
  return model === 'gpt-image-2' ? 21 : (model === 'gpt-image-1.5' ? 13 : 4);
}

export async function openaiEditImage({ apiKey, model, prompt, images = [], size = '1024x1024' }) {
  if (!apiKey) return { ok: false, status: 500, detail: 'OPENAI_API_KEY not configured' };
  if (!images.length) return { ok: false, status: 400, detail: 'at least one input image required' };
  try {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', size);
    fd.append('n', '1');
    fd.append('quality', 'high');
    if (model === 'gpt-image-1' || model === 'gpt-image-1.5') fd.append('input_fidelity', 'high');
    images.forEach((im, i) => {
      fd.append('image[]', new Blob([im.buffer], { type: im.contentType || 'image/png' }), im.name || `image${i}.png`);
    });
    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: fd,
    });
    if (!r.ok) { const detail = await r.text().catch(() => ''); return { ok: false, status: r.status, detail: detail.slice(0, 4000) }; }
    const data = await r.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return { ok: false, status: 502, detail: 'no image in OpenAI response' };
    return { ok: true, b64, costCents: openaiCostCents(model) };
  } catch (err) {
    return { ok: false, status: 502, detail: String(err.message || err) };
  }
}
