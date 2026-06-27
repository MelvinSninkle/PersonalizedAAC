// GET /api/parent/style?childId=<slug>
//
// Returns the art style currently driving a child's board, for display in the
// parent view. Resolution order:
//   1. child_settings.settings.styleGuideId  (the live pointer the generator uses)
//   2. the child's own persistent family guide (style_guides.child_id = childId)
//   3. null  (board still on a public template with nothing child-specific yet)
//
// `source` is 'family' for a child-scoped guide (e.g. the keystone-derived image
// generated from the parent's upload) or 'template' for a public built-in.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { canAccessChild } from '../_lib/access.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = typeof req.query.childId === 'string' ? req.query.childId : '';
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) {
      res.status(403).json({ error: 'No access to this child' }); return;
    }

    const cs = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const pinnedId = cs && cs.settings && cs.settings.styleGuideId ? Number(cs.settings.styleGuideId) : null;

    let row = null;
    if (pinnedId) {
      row = (await db`SELECT id, label, description, blob_key, child_id FROM style_guides WHERE id = ${pinnedId} LIMIT 1`)[0] || null;
    }
    if (!row) {
      row = (await db`
        SELECT id, label, description, blob_key, child_id FROM style_guides
        WHERE child_id = ${childId} AND active = TRUE
        ORDER BY ephemeral ASC, created_at DESC LIMIT 1`)[0] || null;
    }

    res.setHeader('Cache-Control', 'no-store');
    if (!row) { res.status(200).json({ styleGuide: null }); return; }
    res.status(200).json({
      styleGuide: {
        id: Number(row.id),
        label: row.label,
        description: row.description || null,
        source: row.child_id ? 'family' : 'template',
        imageUrl: row.blob_key ? `/api/media?key=${encodeURIComponent(row.blob_key)}` : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'style lookup failed', detail: String(err.message || err) });
  }
}
