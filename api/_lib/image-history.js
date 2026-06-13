// Helper for archiving the previous picture of a board tile (or category) into
// item_image_history before its image_key gets replaced. Every code path that
// updates items.image_key (parent edit, AI regenerate, lab publish, onboarding
// photo overwrite, pending-tile approval) calls this with the OLD key first, so
// the Blob is preserved as visual memorabilia in the parent's album.
//
// Best-effort: failures NEVER block the parent's regeneration. We log and move
// on — losing one history entry is far less costly than failing the update.
import { sql } from './db.js';

export async function archivePriorImage({ db = sql(), childId, itemId, oldKey, label, section, source, prompt = null, model = null, who = null }) {
  if (!oldKey || !childId) return;
  try {
    // Skip if the very-latest history entry already points at this same Blob —
    // a duplicate UPDATE with the same key shouldn't multiply the gallery.
    const dup = await db`
      SELECT 1 FROM item_image_history
      WHERE child_id = ${childId} AND blob_key = ${oldKey}
      ORDER BY archived_at DESC LIMIT 1`;
    if (dup.length) return;
    await db`
      INSERT INTO item_image_history (child_id, item_id, item_label, section, blob_key, prompt, model, source, archived_by)
      VALUES (${childId}, ${itemId || null}, ${label || null}, ${section || null}, ${oldKey}, ${prompt}, ${model}, ${source || null}, ${who || null})`;
  } catch (err) {
    console.error('[image-history] archive failed (continuing):', String(err.message || err));
  }
}
