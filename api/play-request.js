// /api/play-request?childId=X — Fletcher taps "Play with me" on the board.
//   POST  → stamp the request + push the child's parents ("… wants to play!")
//   GET   → { at, ageSec }  so an open parent dashboard can show a banner too
// Auth-gated; the tablet posts with its Bearer token, the parent reads with cookies.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { sendToTokens, apnsConfigured } from './_lib/apns.js';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS play_requests (
      child_id TEXT PRIMARY KEY,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || auth.user.slug || 'fletcherpeterson').slice(0, 64);
  const db = sql();
  try { await ensureTable(db); } catch (_) {}

  if (req.method === 'GET') {
    try {
      const rows = await db`SELECT requested_at FROM play_requests WHERE child_id = ${childId}`;
      res.setHeader('Cache-Control', 'no-store');
      if (!rows.length) { res.status(200).json({ at: null }); return; }
      const at = rows[0].requested_at;
      const ageSec = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
      res.status(200).json({ at, ageSec });
    } catch (err) { res.status(500).json({ error: 'Load failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'POST') {
    try {
      await db`
        INSERT INTO play_requests (child_id, requested_at) VALUES (${childId}, NOW())
        ON CONFLICT (child_id) DO UPDATE SET requested_at = NOW()`;
      let pushed = 0;
      if (apnsConfigured()) {
        const toks = await db`SELECT token FROM push_tokens WHERE child_id = ${childId} AND role IN ('parent','admin')`;
        if (toks.length) {
          const name = (childId.replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase())) || 'Your child';
          const r = await sendToTokens(toks.map(t => t.token), {
            title: name + ' wants to play! 🎮',
            body: 'Tap to pick a game or routine on your phone.',
            data: { kind: 'play_request' },
          });
          pushed = r.filter(x => x.ok).length;
        }
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, pushed });
    } catch (err) { res.status(500).json({ error: 'Request failed', detail: String(err.message || err) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
