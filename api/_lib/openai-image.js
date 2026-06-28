// OpenAI gpt-image generation for the KEYSTONE images (onboarding portraits +
// scene). Gemini is excellent at repeating a locked character across tiles but
// weak at copying an arbitrary art style from a reference; OpenAI's gpt-image
// edits endpoint handles style transfer much better, so the keystones (which set
// the look everything else copies) go through here. Bulk tiles stay on Gemini.
//
// images: [{ buffer, contentType, name? }] — passed as multi-image `image[]`,
// in order (e.g. [style reference, real photo]); the prompt refers to IMAGE 1/2.

export function openaiKeystoneModel() {
  // Override with OPENAI_KEYSTONE_MODEL=gpt-image-2 for the very latest.
  return process.env.OPENAI_KEYSTONE_MODEL || 'gpt-image-1.5';
}

function costFor(model) {
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
    if (!r.ok) { const detail = await r.text().catch(() => ''); return { ok: false, status: r.status, detail: detail.slice(0, 1000) }; }
    const data = await r.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return { ok: false, status: 502, detail: 'no image in OpenAI response' };
    return { ok: true, b64, costCents: costFor(model) };
  } catch (err) {
    return { ok: false, status: 502, detail: String(err.message || err) };
  }
}
