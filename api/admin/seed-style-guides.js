// POST /api/admin/seed-style-guides — one-time (idempotent) import of the five
// marketing art styles into style_guides as PUBLIC guides (child_id IS NULL), so
// the home page, the onboarding picker, and the Lab all draw from the same rows.
//
// Each static /styles/*.jpg is uploaded to blob storage and used as BOTH the raw
// style anchor (blob_key) and the marketing preview (preview_blob_key) — for the
// seeds they're the same polished image. Admins can later swap either in the Lab.
// Skips any style whose label already exists as a public guide, so it's safe to
// re-run.
import { put } from '@vercel/blob';
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

function appUrl() {
  return process.env.APP_URL || process.env.PUBLIC_URL || 'https://aac.andrewpeterson.io';
}

const SEEDS = [
  { slug: '3d',          label: '3D Animated',    file: 'style-3d.jpg',          description: 'Bright, dimensional characters, like a still from an animated film.' },
  { slug: 'picturebook', label: 'Picture Book',   file: 'style-picturebook.jpg', description: 'Clean, flat illustration with friendly outlines.' },
  { slug: 'watercolor',  label: 'Watercolor',     file: 'style-watercolor.jpg',  description: 'Soft, painterly washes in vivid color.' },
  { slug: 'soft',        label: 'Soft Storybook', file: 'style-soft.jpg',        description: 'Gentle, muted tones for a calm, cozy feel.' },
  { slug: 'felted',      label: 'Felted',         file: 'style-felted.jpg',      description: 'Warm, tactile needle-felt textures you almost want to touch.' },
];

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const db = sql();
    await db`ALTER TABLE style_guides ADD COLUMN IF NOT EXISTS preview_blob_key TEXT`;
    const base = appUrl();
    const created = [], skipped = [];

    for (let i = 0; i < SEEDS.length; i++) {
      const s = SEEDS[i];
      const existing = await db`SELECT id FROM style_guides WHERE label = ${s.label} AND child_id IS NULL LIMIT 1`;
      if (existing.length) { skipped.push(s.label); continue; }

      const resp = await fetch(`${base}/styles/${s.file}`);
      if (!resp.ok) { skipped.push(`${s.label} (fetch ${resp.status})`); continue; }
      const bytes = Buffer.from(await resp.arrayBuffer());
      const blobKey = `style-guides/seed/${s.slug}.jpg`;
      await put(blobKey, bytes, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false });
      const blobUrl = `/api/media?key=${encodeURIComponent(blobKey)}`;

      await db`
        INSERT INTO style_guides
          (label, description, blob_url, blob_key, preview_blob_key, active, sort_order, created_by, child_id, ephemeral)
        VALUES
          (${s.label}, ${s.description}, ${blobUrl}, ${blobKey}, ${blobKey}, TRUE, ${i + 1}, ${gate.email || 'seed'}, NULL, FALSE)`;
      created.push(s.label);
    }

    res.status(200).json({ ok: true, created, skipped });
  } catch (err) {
    res.status(500).json({ error: 'seed failed', detail: String(err.message || err) });
  }
}
