// POST /api/quick-capture?childId=  Content-Type: image/jpeg (raw bytes)
//
// Phone-friendly capture pipeline per the SwiftUI PRD's data-fidelity rule:
// the raw photo lands in Blob and an items row appears on the board BEFORE
// any AI step runs. The phone then orchestrates the optional AI work
// (describe-image, generate-image, tts) against the existing endpoints and
// PUTs the results to /api/items — so an upstream AI outage never costs the
// parent the capture, and the iPad can already show the tile (with the raw
// photo and a placeholder label) while the title and stylized art catch up.
//
// Optional query/body knobs (all default to "unassigned"):
//   ?section=nouns|verbs|people|needs      tile section
//   ?categoryId=<id>                       drop the item under a specific category
//   ?label=<text>                          override the placeholder label
//
// Auth: parent of the child or admin. Returns { itemId, imageKey, label }.
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { canAccessChild, isParentOf } from './_lib/access.js';
import { sql } from './_lib/db.js';

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const MAX_BYTES = 4 * 1024 * 1024;
const VALID_SECTIONS = new Set(['nouns', 'verbs', 'people', 'needs']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId))) { res.status(403).json({ error: 'Forbidden' }); return; }
  // Captures land on the parent's board (owner_user_id NULL), so only the
  // child's parent (or admin) can shoot them. A therapist with view access
  // can't drop tiles into the family's space.
  if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId))) {
    res.status(403).json({ error: 'Parent of this child required' }); return;
  }

  // Read raw bytes off the request stream — same convention as /api/upload
  // and /api/generate-image. 4 MB ceiling (Vercel function body limit).
  let buffer;
  try {
    const chunks = []; let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { res.status(413).json({ error: 'Photo too large', max: MAX_BYTES }); return; }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) {
    res.status(400).json({ error: 'Failed to read body', detail: String(err.message || err) }); return;
  }
  if (!buffer.length) { res.status(400).json({ error: 'Empty body' }); return; }

  const q = req.query || {};
  const section = VALID_SECTIONS.has(String(q.section || '')) ? String(q.section) : 'nouns';
  const categoryId = (Number.isFinite(+q.categoryId) && +q.categoryId > 0) ? Math.floor(+q.categoryId) : null;
  const label = String(q.label || 'New picture').slice(0, 80).trim() || 'New picture';

  // 1) Persist the raw bytes to Blob FIRST. If this fails the parent's tap is
  //    lost (a 5xx), which is the only acceptable failure mode — every
  //    downstream step is best-effort and the row will still exist.
  const contentType = req.headers['content-type'] || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const blobKey = `captures/${childId}/${randomUUID()}.${ext}`;
  try {
    await put(blobKey, buffer, { access: 'private', contentType, addRandomSuffix: false });
  } catch (err) {
    res.status(502).json({ error: 'Blob write failed', detail: String(err.message || err) }); return;
  }

  // 2) Create the items row immediately, with the raw photo as image_key and
  //    needs_review=TRUE so it shows up in the parent's review queue for any
  //    later polish (label correction, art regeneration, voice recording).
  //    display_order = Date.now() keeps it at the end of the section.
  try {
    const db = sql();
    const row = await db`
      INSERT INTO items
        (section, category_id, label, image_key, keep_aspect, display_order, pinned, child_id, needs_review, updated_at)
      VALUES
        (${section}, ${categoryId}, ${label}, ${blobKey}, FALSE, ${Date.now()}, FALSE, ${childId}, TRUE, NOW())
      RETURNING id`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ itemId: Number(row[0].id), imageKey: blobKey, label });
  } catch (err) {
    // The Blob is already written; the items insert failing is rare (would be
    // a schema/connection issue). Return the blobKey anyway so the phone can
    // retry the insert via /api/items without re-uploading.
    res.status(500).json({ error: 'Item insert failed', detail: String(err.message || err), imageKey: blobKey });
  }
}
