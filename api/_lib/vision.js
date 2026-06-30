// Shared OpenAI vision labeler: a photo → a 1-2 word, child-friendly AAC label.
// Used by /api/describe-image (interactive, surfaces upstream errors) and the
// durable tile-jobs pipeline (best-effort, swallows errors). Callers pass their
// own prompt; the plumbing (model, message shape, JSON parse, error mapping) is
// shared. Returns { ok, status, label, detail }.
const DEFAULT_PROMPT =
  "You are labeling a photo for a young child's communication (AAC) app. Identify the single main " +
  "subject. Respond with strict JSON only: {\"label\":\"<1-2 word everyday name, Capitalized>\"}. No extra text.";

export async function describePhotoLabel({ apiKey, dataUrl, prompt = DEFAULT_PROMPT, maxTokens = 40 }) {
  if (!apiKey) return { ok: false, status: 500, label: '', detail: 'OPENAI_API_KEY not configured' };
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ] }],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
      }),
    });
    if (!r.ok) { const detail = await r.text().catch(() => ''); return { ok: false, status: r.status, label: '', detail: detail.slice(0, 400) }; }
    const data = await r.json();
    let out = {}; try { out = JSON.parse(data.choices[0].message.content); } catch (_) {}
    return { ok: true, status: 200, label: typeof out.label === 'string' ? out.label.slice(0, 80) : '' };
  } catch (err) { return { ok: false, status: 502, label: '', detail: String(err.message || err) }; }
}
