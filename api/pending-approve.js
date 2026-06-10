// POST /api/pending-approve { id, childId, section, categoryId, label, pronunciation? }
// Turns a "ready" onboarding draft into a real tile (reusing its rendered image
// + voice blobs), then removes the draft and its raw source photo. Auth-gated.
import { del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { isParentOf } from './_lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const id = Number.isFinite(b.id) ? b.id : parseInt(b.id, 10);
  const childId = typeof b.childId === 'string' && b.childId ? b.childId.slice(0, 64) : 'fletcherpeterson';
  const section = ['people', 'nouns', 'verbs', 'needs'].includes(b.section) ? b.section : null;
  const categoryId = Number.isFinite(b.categoryId) ? b.categoryId : (b.categoryId ? parseInt(b.categoryId, 10) : null);
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 200) : '';
  if (!id || !section || !label) { res.status(400).json({ error: 'id, section, and label are required' }); return; }

  try {
    const db = sql();
    if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    const rows = await db`SELECT * FROM pending_tiles WHERE id = ${id} AND child_id = ${childId}`;
    if (!rows.length) { res.status(404).json({ error: 'Draft not found' }); return; }
    const d = rows[0];

    const saved = await db`
      INSERT INTO items (section, category_id, label, image_url, image_key, sound_url, sound_key, keep_aspect, display_order, pinned, child_id, updated_at)
      VALUES (${section}, ${categoryId ?? null}, ${label}, NULL, ${d.image_key ?? null}, NULL, ${d.sound_key ?? null}, FALSE, ${Date.now()}, FALSE, ${childId}, NOW())
      RETURNING id`;

    await db`UPDATE pending_tiles SET status = 'approved', updated_at = now() WHERE id = ${id}`;
    if (d.source_key) { try { await del(d.source_key); } catch (_) {} }   // raw photo no longer needed; item owns image/sound
    res.status(200).json({ ok: true, itemId: Number(saved[0].id) });
  } catch (err) {
    res.status(500).json({ error: 'Approve failed', detail: String(err.message || err) });
  }
}
