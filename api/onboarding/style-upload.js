// POST /api/onboarding/style-upload   Content-Type: image/*   body = raw bytes
//
// A parent can bring their OWN art style instead of picking a built-in template.
// We store the uploaded image as an EPHEMERAL, child-scoped style_guides row:
//   • child_id = <childId>  → kept out of the global picker (api/onboarding/styles)
//   • ephemeral = TRUE      → discarded once the approved keystones take over as
//                             the lasting anchor (api/onboarding/scene.js commit).
// It rides along as the style reference while we render the keystones, then gets
// deleted. Returns { styleGuideId } so the client can use it as the selected style.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ensureProgress } from '../_lib/onboarding.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const MAX_BYTES = 8 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    // Self-heal the per-customer columns so an un-migrated deploy can't break
    // upload (mirrors api/init.js). Idempotent + cheap.
    await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS blob_key TEXT`;
    await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS child_id TEXT`;
    await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS ephemeral BOOLEAN NOT NULL DEFAULT FALSE`;

    const progress = await ensureProgress(db, auth.user);
    const childId = progress.child_id;

    const chunks = []; let total = 0;
    for await (const c of req) {
      total += c.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Image too large' }); return; }
      chunks.push(c);
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) { res.status(400).json({ error: 'Empty body' }); return; }

    const contentType = req.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : (contentType.includes('webp') ? 'webp' : 'jpg');
    const blobKey = `onboarding/${childId}/style/${randomUUID()}.${ext}`;
    await put(blobKey, bytes, { access: 'private', contentType, addRandomSuffix: false });
    const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;

    const rows = await db`
      INSERT INTO style_guides (label, description, blob_url, blob_key, active, sort_order, created_by, child_id, ephemeral)
      VALUES (${"Your uploaded style"}, ${null}, ${blobUrl}, ${blobKey}, TRUE, 0, ${auth.user.email || null}, ${childId}, TRUE)
      RETURNING id`;
    const styleGuideId = Number(rows[0].id);

    // Remember the working style on the progress row so retries + the scene step
    // can read it back, and mark it as an upload so the scene commit knows to
    // swap in the keystone-derived anchor and delete this temporary row.
    await db`UPDATE onboarding_progress
                SET data = COALESCE(data, '{}'::jsonb) || ${JSON.stringify({ styleGuideId, styleSource: 'upload' })}::jsonb,
                    updated_at = NOW()
              WHERE user_id = ${Number(auth.user.uid)}`;

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, styleGuideId });
  } catch (err) {
    res.status(500).json({ error: 'style upload failed', detail: String(err.message || err) });
  }
}
