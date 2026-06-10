// /api/interactions — record a child's answer to an interactive question (and,
// in Phase C, the single place a parent push will be sent from).
//   POST { childId, kind, prompt, response, scheduleId }  → log one answer
//   GET  ?childId=&limit=   → recent answers, newest first (parent dashboard)
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';
import { apnsConfigured, sendToTokens } from './_lib/apns.js';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS interaction_log (
      id BIGSERIAL PRIMARY KEY,
      child_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'question',
      prompt TEXT,
      response TEXT,
      schedule_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS interaction_log_child_idx ON interaction_log(child_id, created_at DESC)`;
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const db = sql();
  try { await ensureTable(db); } catch (_) {}

  if (req.method === 'POST') {
    const b = (typeof req.body === 'object' && req.body) || {};
    const cid = (typeof b.childId === 'string' && b.childId ? b.childId : childId).slice(0, 64);
    const kind = (typeof b.kind === 'string' ? b.kind : 'question').slice(0, 32);
    const prompt = typeof b.prompt === 'string' ? b.prompt.slice(0, 300) : null;
    const response = typeof b.response === 'string' ? b.response.slice(0, 200) : null;
    const scheduleId = typeof b.scheduleId === 'string' ? b.scheduleId.slice(0, 64) : null;
    if (!(await canAccessChild(auth.user, cid, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    try {
      const rows = await db`
        INSERT INTO interaction_log (child_id, kind, prompt, response, schedule_id)
        VALUES (${cid}, ${kind}, ${prompt}, ${response}, ${scheduleId})
        RETURNING id, created_at`;
      // Push the parent with the answer (only parent/admin tokens; best effort).
      try {
        if (apnsConfigured() && kind === 'question') {
          const toks = await db`SELECT token FROM push_tokens WHERE child_id = ${cid} AND role IN ('parent','admin')`;
          if (toks.length) {
            const name = (cid.replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase())) || 'Your child';
            await sendToTokens(toks.map(t => t.token), { title: name + ' answered', body: ((prompt ? prompt + ' → ' : '') + (response || '')).slice(0, 178), data: { kind: 'question' } });
          }
        }
      } catch (_) {}
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, id: Number(rows[0].id) });
    } catch (err) { res.status(500).json({ error: 'Log failed', detail: String(err.message || err) }); }
    return;
  }

  if (req.method === 'GET') {
    if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    try {
      const rows = await db`
        SELECT id, kind, prompt, response, created_at FROM interaction_log
        WHERE child_id = ${childId} ORDER BY created_at DESC LIMIT ${limit}`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ interactions: rows });
    } catch (err) { res.status(500).json({ error: 'Load failed', detail: String(err.message || err) }); }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
