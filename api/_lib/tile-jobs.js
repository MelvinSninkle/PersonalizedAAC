// Durable add-tile job pipeline. The whole point: once a photo is uploaded it
// lives on the server (Blob) with a job row, so nothing the iPad does (drop,
// background, crash) can lose it — and a cron drains the queue so a tile always
// lands even if the device that started it is long gone.
//
// The render also folds in style consistency: every tile is generated with the
// child's chosen STYLE-GUIDE IMAGE attached (the same exemplar the Lab/onboarding
// use), so tiles match the board instead of each interpreting a text style word
// differently.
//
// Status flow:  queued → processing → done | failed   (failed is retried by the
// cron until attempts hit MAX, then save-first keeps the raw photo as the tile).
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { geminiKey, geminiDefaultModel, isGeminiModel, geminiGenerateImage, geminiCostCents } from './gemini.js';
import { readBlobBytes, loadStyleGuide, loadChildVoiceId, loadChildStyleGuideId, synthesizeVoice, SQUARE_RULE } from './onboarding-render.js';

export const MAX_ATTEMPTS = 3;

export async function ensureTileJobs(db) {
  await db`
    CREATE TABLE IF NOT EXISTS tile_jobs (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      actor_email TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      source_key TEXT NOT NULL,
      source_content_type TEXT,
      label TEXT,
      detail TEXT,
      section TEXT,
      category_id BIGINT,
      style TEXT,
      style_guide_id BIGINT,
      model TEXT,
      bg TEXT,
      keep_aspect BOOLEAN NOT NULL DEFAULT FALSE,
      needs_review BOOLEAN NOT NULL DEFAULT FALSE,
      emotion TEXT NOT NULL DEFAULT 'default',
      relationship TEXT,
      attempts INT NOT NULL DEFAULT 0,
      image_key TEXT,
      sound_key TEXT,
      item_id BIGINT,
      art_failed BOOLEAN NOT NULL DEFAULT FALSE,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`ALTER TABLE tile_jobs ADD COLUMN IF NOT EXISTS relationship TEXT`;
  await db`CREATE INDEX IF NOT EXISTS tile_jobs_child_idx  ON tile_jobs(child_id, status)`;
  await db`CREATE INDEX IF NOT EXISTS tile_jobs_status_idx ON tile_jobs(status, updated_at)`;
}

const BG_PRESETS = {
  pink:   'a soft pastel pink', mint:   'a soft pastel mint green',
  yellow: 'a soft pastel cream yellow', blue: 'a soft pastel periwinkle blue',
  peach:  'a soft pastel peach', white: 'a clean off-white',
};
function bgPhrase(bg) {
  const k = String(bg || '').trim().toLowerCase();
  if (BG_PRESETS[k]) return BG_PRESETS[k];
  if (/^#?[0-9a-f]{6}$/i.test(k)) return `the exact color ${k.startsWith('#') ? k : '#' + k}`;
  return 'a soft pastel';
}

// Best-effort vision naming, only used when the parent didn't type a name.
async function describeLabel(buffer, contentType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';
  const dataUrl = `data:${contentType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  const prompt =
    "You are labeling a photo for a young child's communication (AAC) app. Identify the single main " +
    "subject. Respond with strict JSON only: {\"label\":\"<1-2 word everyday name, Capitalized>\"}. No extra text.";
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
        response_format: { type: 'json_object' }, max_tokens: 40,
      }),
    });
    if (!r.ok) return '';
    const data = await r.json();
    let out = {}; try { out = JSON.parse(data.choices[0].message.content); } catch (_) {}
    return typeof out.label === 'string' ? out.label.slice(0, 80) : '';
  } catch (_) { return ''; }
}

// Re-illustrate the source photo in the house style, anchored to the style-guide
// image so the result matches the board. `section` tunes the subject rule:
// People keep their face; objects never grow cartoon faces. Returns
// { ok, b64, prompt, costCents } or { ok:false, detail }.
export async function renderStyledPhoto({ photo, contentType, label, detail, style, styleGuide, model, bg, section }) {
  const subject = label ? `"${label}"` : 'the main subject';
  const isPerson = String(section || '').toLowerCase() === 'people';
  const detailClause = detail ? ` Important detail from the family: ${detail}.` : '';
  const captionClause = label
    ? ` At the very bottom, add a clean caption band with the word “${label}”, spelled EXACTLY as "${label}", in a simple friendly rounded sans-serif, centered; put no other text anywhere else.`
    : ` Do not include any text, words, or letters in the image.`;
  const styleClause = (styleGuide && styleGuide.image)
    ? ` Match the art style of the style-reference image exactly — its palette, linework, shading, and finish — so this tile is consistent with the rest of the board.`
    : '';
  // People keep their likeness; everything else gets the strict no-faces rule so
  // a cup/duck/car doesn't come back with cartoon eyes.
  const subjectRule = isPerson
    ? ` This is a person — keep their face and likeness clearly recognizable from the source photo.`
    : ` If ${subject} is an inanimate object, draw it as it appears in the photo — do NOT add eyes, mouths, ` +
      `faces, or smiles unless the real object physically has them.`;
  let prompt =
    `Re-illustrate this photograph as a ${style || 'soft illustration'} of ${subject} for a young child's ` +
    `communication app. Keep ${subject} clearly recognizable and centered, on a simple ${bgPhrase(bg)} ` +
    `background, with bright friendly colors and a gentle, age-appropriate look.` +
    detailClause + captionClause + styleClause + subjectRule + SQUARE_RULE;

  // Ordered images + positional legend (style guide first, source photo second).
  const images = [];
  const legend = [];
  if (styleGuide && styleGuide.image && styleGuide.image.buffer) {
    images.push({ buffer: styleGuide.image.buffer, contentType: styleGuide.image.contentType });
    legend.push(`Image ${images.length} is the STYLE reference — copy its art style only, not its content.`);
  }
  images.push({ buffer: photo, contentType: contentType || 'image/jpeg' });
  legend.push(`Image ${images.length} is the source photo — re-illustrate THIS subject in the style above.`);
  prompt += '\n\n' + legend.join(' ');

  const gKey = geminiKey();
  if (!gKey) return { ok: false, detail: 'GEMINI_API_KEY not configured' };
  const useModel = isGeminiModel(model) ? model : geminiDefaultModel();
  const g = await geminiGenerateImage({ apiKey: gKey, model: useModel, prompt, images, aspectRatio: '1:1' });
  if (!g.ok) return { ok: false, status: g.status, detail: g.detail };
  return { ok: true, b64: g.b64, prompt, model: useModel, costCents: geminiCostCents(useModel) };
}

// Run one job to completion. Reads the durable source, names it (if needed),
// generates the styled art, voices it, and creates/updates the board item. Marks
// the job done or failed; on the final attempt it save-firsts the raw photo so a
// tile always lands. Safe to re-run a queued/processing/failed job.
export async function processTileJob(db, jobId) {
  const rows = await db`SELECT * FROM tile_jobs WHERE id = ${jobId} LIMIT 1`;
  if (!rows.length) return { ok: false, detail: 'job not found' };
  const job = rows[0];
  if (job.status === 'done') return { ok: true, already: true };

  await db`UPDATE tile_jobs SET status = 'processing', attempts = attempts + 1, updated_at = NOW() WHERE id = ${jobId}`;
  const attempt = (job.attempts || 0) + 1;

  try {
    const src = await readBlobBytes(job.source_key);
    const ct = job.source_content_type || src.contentType || 'image/jpeg';

    let label = String(job.label || '').trim();
    if (!label) label = await describeLabel(src.buffer, ct);

    // House style: the job's explicit guide, else the child's saved one.
    const sgId = job.style_guide_id || (await loadChildStyleGuideId(db, job.child_id));
    const styleGuide = await loadStyleGuide(db, sgId);

    // Generate the art. On failure, retry the whole job (cron) until MAX, then
    // save-first: keep the raw photo as the tile so a usable tile still lands.
    let imageBytes, imageExt, imageCT, artFailed = false, usedPrompt = null, costCents = 4;
    const r = await renderStyledPhoto({
      photo: src.buffer, contentType: ct, label, detail: job.detail,
      style: job.style, styleGuide, model: job.model, bg: job.bg,
      section: job.section,
    });
    if (r.ok) {
      imageBytes = Buffer.from(r.b64, 'base64'); imageExt = 'png'; imageCT = 'image/png';
      usedPrompt = r.prompt; costCents = r.costCents ?? 4;
    } else if (attempt < MAX_ATTEMPTS) {
      throw new Error('art generation failed (will retry): ' + (r.detail || '').slice(0, 160));
    } else {
      imageBytes = src.buffer; imageExt = ct.includes('png') ? 'png' : 'jpg'; imageCT = ct; artFailed = true;
    }

    const imageKey = `tile-jobs/${job.child_id}/${randomUUID()}.${imageExt}`;
    await put(imageKey, imageBytes, { access: 'private', contentType: imageCT, addRandomSuffix: false });

    // Voice it in the child's chosen voice (best-effort → system voice fallback).
    let soundKey = null;
    if (label) {
      const voiceId = await loadChildVoiceId(db, job.child_id);
      const mp3 = await synthesizeVoice({ text: label, voiceId });
      if (mp3) {
        soundKey = `tile-jobs/${job.child_id}/${randomUUID()}.mp3`;
        await put(soundKey, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
      }
    }

    // Create or update the board item. Idempotent via the job's item_id so a
    // retry after a partial run updates the same tile instead of duplicating.
    // People tiles also match by name so re-adding a person (e.g. replacing their
    // photo from the Family screen) updates their one tile rather than dupes it.
    const needsReview = !!job.needs_review || artFailed;
    const section = String(job.section || 'nouns').toLowerCase();
    let itemId = job.item_id ? Number(job.item_id) : null;
    if (!itemId && section === 'people' && label) {
      const ex = await db`SELECT id FROM items WHERE child_id = ${job.child_id}
                          AND section = 'people' AND lower(label) = lower(${label}) LIMIT 1`;
      if (ex.length) itemId = Number(ex[0].id);
    }
    if (itemId) {
      await db`UPDATE items SET label = ${label || 'New tile'}, image_key = ${imageKey},
                 sound_key = COALESCE(${soundKey}, sound_key), section = ${section},
                 category_id = ${job.category_id}, keep_aspect = ${!!job.keep_aspect},
                 needs_review = ${needsReview}, updated_at = NOW() WHERE id = ${itemId}`;
    } else {
      const it = await db`INSERT INTO items
          (section, category_id, label, image_key, sound_key, keep_aspect, display_order, pinned,
           child_id, needs_review, updated_at)
        VALUES (${section}, ${job.category_id}, ${label || 'New tile'}, ${imageKey}, ${soundKey},
           ${!!job.keep_aspect}, ${Date.now()}, FALSE, ${job.child_id}, ${needsReview}, NOW())
        RETURNING id`;
      itemId = Number(it[0].id);
    }

    // A photo added to the People section IS a person — register them (or
    // refresh their portrait) so future taxonomy tiles can reference them by
    // name (e.g. the new doctor), exactly like the onboarding family members.
    if (section === 'people' && label && !artFailed) {
      const rel = job.relationship || 'other';
      try {
        const ex = await db`SELECT id FROM persons WHERE child_id = ${job.child_id} AND lower(display_name) = lower(${label}) LIMIT 1`;
        if (ex.length) {
          await db`UPDATE persons SET reference_key = ${imageKey},
                     relationship = COALESCE(${job.relationship}, relationship), updated_at = NOW()
                   WHERE id = ${ex[0].id}`;
        } else {
          await db`INSERT INTO persons (child_id, display_name, given_name, relationship, is_self, reference_key)
                   VALUES (${job.child_id}, ${label}, ${label}, ${rel}, FALSE, ${imageKey})`;
        }
      } catch (_) { /* persons registration is best-effort */ }
    }

    try {
      await db`INSERT INTO image_generations
          (child_id, actor_email, actor_role, label, style, prompt, size, cost_cents)
        VALUES (${job.child_id}, ${job.actor_email || null}, 'add_tile', ${label || null},
           ${styleGuide ? styleGuide.label : (job.style || '')}, ${usedPrompt || ''}, '1024x1024', ${costCents})`;
    } catch (_) {}

    await db`UPDATE tile_jobs SET status = 'done', label = ${label}, image_key = ${imageKey},
               sound_key = ${soundKey}, item_id = ${itemId}, art_failed = ${artFailed},
               needs_review = ${needsReview}, error = NULL, updated_at = NOW() WHERE id = ${jobId}`;
    return { ok: true, itemId, artFailed };
  } catch (err) {
    await db`UPDATE tile_jobs SET status = 'failed', error = ${String(err.message || err).slice(0, 300)},
               updated_at = NOW() WHERE id = ${jobId}`;
    return { ok: false, detail: String(err.message || err) };
  }
}

// Pick the next batch of jobs the cron should run: fresh queued ones, jobs stuck
// 'processing' (the fire-and-forget kick died), and failed jobs with attempts
// left. Oldest first.
export async function claimRunnableJobs(db, limit = 5) {
  return await db`
    SELECT id FROM tile_jobs
    WHERE status = 'queued'
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '3 minutes')
       OR (status = 'failed' AND attempts < ${MAX_ATTEMPTS})
    ORDER BY created_at ASC
    LIMIT ${limit}`;
}
