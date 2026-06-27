// POST /api/auth/delete-account { confirm: "DELETE" }
//
// Permanently deletes the signed-in account and EVERYTHING tied to its child:
// all tiles/categories/people/style rows AND their images & recordings in blob
// storage. Irreversible. The UI offers a backup download + a typed confirmation
// before calling this. Uses explicit per-table statements (tagged templates) so
// the destructive deletes are unambiguous; each is best-effort (a table that
// doesn't exist on a given deploy is skipped, never fatal).
import { del, list } from '@vercel/blob';
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { serializeCookie } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
    res.status(400).json({ error: 'Type DELETE to confirm.' }); return;
  }

  const uid = Number(auth.user.uid || auth.user.id);
  const childId = auth.user.slug || `parent-${uid}`;
  if (!uid) { res.status(400).json({ error: 'No account on this session' }); return; }

  try {
    const db = sql();

    // 1) Collect blob keys from the child's content, then delete the blobs.
    const keys = new Set();
    const add = (rows, cols) => { for (const r of rows) for (const c of cols) if (r[c]) keys.add(r[c]); };
    try { add(await db`SELECT image_key, sound_key FROM items WHERE child_id = ${childId}`, ['image_key', 'sound_key']); } catch (_) {}
    try { add(await db`SELECT image_key FROM categories WHERE child_id = ${childId}`, ['image_key']); } catch (_) {}
    try { add(await db`SELECT reference_key, voice_key FROM persons WHERE child_id = ${childId}`, ['reference_key', 'voice_key']); } catch (_) {}
    try { add(await db`SELECT blob_key FROM reference_images WHERE child_id = ${childId}`, ['blob_key']); } catch (_) {}
    try { add(await db`SELECT blob_key, preview_blob_key FROM style_guides WHERE child_id = ${childId}`, ['blob_key', 'preview_blob_key']); } catch (_) {}
    try { add(await db`SELECT source_key, image_key, sound_key FROM pending_tiles WHERE child_id = ${childId}`, ['source_key', 'image_key', 'sound_key']); } catch (_) {}
    try { add(await db`SELECT image_key FROM item_image_history WHERE child_id = ${childId}`, ['image_key']); } catch (_) {}
    for (const k of keys) { try { await del(k); } catch (_) {} }

    // 2) Sweep any remaining blobs under the child's storage prefixes (onboarding
    //    drafts, regenerated styles) not tracked in a table row.
    for (const prefix of [`onboarding/${childId}/`, `parent/${childId}/`]) {
      try {
        let cursor;
        do {
          const r = await list({ prefix, cursor, limit: 1000 });
          for (const b of (r.blobs || [])) { try { await del(b.pathname || b.url); } catch (_) {} }
          cursor = r.cursor;
        } while (cursor);
      } catch (_) {}
    }

    // 3) Delete all child-scoped DB rows (explicit per table; best-effort each).
    try { await db`DELETE FROM items WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM categories WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM events WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM persons WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM reference_images WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM pending_tiles WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM item_image_history WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM child_settings WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM category_shares WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM access_requests WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM sessions WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM game_attempts WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM session_flags WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM live_sessions WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM interaction_log WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM push_tokens WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM image_generations WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM style_guides WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM child_access WHERE child_id = ${childId}`; } catch (_) {}
    try { await db`DELETE FROM onboarding_progress WHERE user_id = ${uid}`; } catch (_) {}

    // 4) Delete the user account last.
    await db`DELETE FROM users WHERE id = ${uid}`;

    // 5) Clear the session cookie — they're signed out now.
    res.setHeader('Set-Cookie', serializeCookie('', { clear: true }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed', detail: String(err.message || err) });
  }
}
