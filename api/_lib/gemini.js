// Gemini image generation ("Nano Banana") — the cost-efficient alternative to
// the OpenAI image models (~$0.04/image vs $0.13-0.21), and the strongest at
// keeping a person's likeness from reference images, which is exactly the
// anchor-driven workload of this app. One generateContent call covers both
// text-to-image and reference-conditioned generation (references ride along as
// inline images). Needs GEMINI_API_KEY (or GOOGLE_API_KEY) — create one at
// https://aistudio.google.com → "Get API key".
export function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

// Default model; override with GEMINI_IMAGE_MODEL when Google ships a newer id.
export function geminiDefaultModel() {
  return process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
}

// Any gemini-* id is treated as a Gemini model — the Lab experiments with new
// ids (e.g. the Pro tier) without needing a code change.
export function isGeminiModel(m) {
  return /^gemini-[a-z0-9.-]+$/i.test(String(m || ''));
}

// Flat cost estimate in cents (Gemini doesn't return dollar amounts): the Flash
// tier is ~$0.039/image at 1024², the Pro tier ~$0.13 at typical sizes.
export function geminiCostCents(model) {
  return /pro/i.test(String(model)) ? 13 : 4;
}

// Generate one image. `images` is an ordered list of { buffer, contentType }
// reference inputs (style guide, subject anchor, source photo …) — order must
// match any positional legend in the prompt. `aspectRatio` (e.g. '1:1') asks the
// model for a specific shape; if the model rejects the config we retry without
// it so a square request can never break generation. Returns
// { ok, b64?, mimeType?, inputTokens?, outputTokens?, status?, detail? }.
export async function geminiGenerateImage({ apiKey, model, prompt, images = [], aspectRatio = null }) {
  const parts = [{ text: prompt }];
  for (const im of images) {
    parts.push({ inlineData: { mimeType: im.contentType || 'image/jpeg', data: im.buffer.toString('base64') } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const send = (withAspect) => {
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (withAspect && aspectRatio) generationConfig.imageConfig = { aspectRatio };
    return fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    });
  };
  let resp;
  // Image tiers (especially the Pro preview) return transient 503/429 under load
  // even on paid billing — retry a few times with exponential backoff (1.5s, 3s,
  // 6s) before giving up, well within the caller's execution budget.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const backoff = [1500, 3000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      resp = await send(true);
      // If the imageConfig/aspectRatio field isn't accepted, fall back to a plain
      // request rather than failing the whole generation.
      if (!resp.ok && aspectRatio) {
        const detail = await resp.clone().text().catch(() => '');
        if (/imageConfig|aspectRatio|unknown name|INVALID_ARGUMENT/i.test(detail)) {
          resp = await send(false);
        }
      }
    } catch (err) {
      if (attempt < backoff.length) { await sleep(backoff[attempt]); continue; }
      return { ok: false, status: 502, detail: String(err.message || err) };
    }
    // Retry only the transient capacity/throttle codes; everything else (incl.
    // 403/permission, 400/bad-request) is returned immediately so real config
    // problems aren't hidden behind retries.
    if ((resp.status === 503 || resp.status === 429) && attempt < backoff.length) {
      await sleep(backoff[attempt]);
      continue;
    }
    break;
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, detail: (await resp.text().catch(() => '')).slice(0, 1000) };
  }
  const data = await resp.json().catch(() => null);
  const outParts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const img = outParts.find(p => p.inlineData && p.inlineData.data);
  if (!img) {
    // No image part — usually a safety block or the model answering in text.
    const finish = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
    const txt = outParts.map(p => p.text).filter(Boolean).join(' ').slice(0, 300);
    return { ok: false, status: 502, detail: `No image in Gemini response${finish ? ` (finishReason: ${finish})` : ''}${txt ? `: ${txt}` : ''}` };
  }
  const um = (data && data.usageMetadata) || {};
  return {
    ok: true,
    b64: img.inlineData.data,
    mimeType: img.inlineData.mimeType || 'image/png',
    inputTokens: um.promptTokenCount ?? null,
    outputTokens: um.candidatesTokenCount ?? null,
  };
}
