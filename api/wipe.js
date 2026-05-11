// DELETE /api/wipe — admin-only nuclear reset.
// Deletes every blob in the store, then truncates categories + items in Neon
// (RESTART IDENTITY so sequences reset to 1).
import { list, del } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  let blobsDeleted = 0;
  try {
    let cursor;
    do {
      const page = await list({ cursor, limit: 1000 });
      const urls = page.blobs.map((b) => b.url);
      if (urls.length) {
        await del(urls);
        blobsDeleted += urls.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    res.status(500).json({ error: 'Blob wipe failed', detail: String(err.message || err), blobsDeleted });
    return;
  }

  try {
    const db = sql();
    await db`TRUNCATE TABLE items, categories RESTART IDENTITY CASCADE`;
  } catch (err) {
    res.status(500).json({ error: 'DB wipe failed', detail: String(err.message || err), blobsDeleted });
    return;
  }

  res.status(200).json({ ok: true, blobsDeleted });
}
