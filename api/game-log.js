// POST /api/game-log — record one finished game session and its per-item
// attempts (feeds the Games + Time dashboards). Auth-gated; best-effort from
// the client (a failed log never blocks gameplay).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = typeof b.childId === 'string' && b.childId ? b.childId.slice(0, 64) : 'fletcherpeterson';
  const mode = typeof b.mode === 'string' ? b.mode.slice(0, 32) : 'self_paced';
  const category = typeof b.category === 'string' ? b.category.slice(0, 120) : null;
  const startedAt = typeof b.startedAt === 'string' ? b.startedAt : new Date().toISOString();
  const endedAt = typeof b.endedAt === 'string' ? b.endedAt : new Date().toISOString();
  const attempts = Array.isArray(b.attempts) ? b.attempts.slice(0, 500) : [];
  const itemCount = Number.isFinite(b.itemCount) ? b.itemCount : attempts.length;
  const correctCount = Number.isFinite(b.correctCount) ? b.correctCount : attempts.filter(a => a && a.correct).length;

  try {
    const db = sql();
    const rows = await db`
      INSERT INTO sessions (child_id, mode, category, facilitator, started_at, ended_at, correct_count, item_count)
      VALUES (${childId}, ${mode}, ${category}, ${auth.user.role || null}, ${startedAt}, ${endedAt}, ${correctCount}, ${itemCount})
      RETURNING id`;
    const sid = rows[0].id;
    for (const a of attempts) {
      if (!a || typeof a !== 'object') continue;
      await db`
        INSERT INTO game_attempts (session_id, child_id, category, label, item_id, correct, input_method, misses, occurred_at)
        VALUES (${sid}, ${childId},
                ${typeof a.category === 'string' ? a.category.slice(0, 120) : null},
                ${typeof a.label === 'string' ? a.label.slice(0, 200) : null},
                ${Number.isFinite(a.itemId) ? a.itemId : null},
                ${!!a.correct},
                ${typeof a.inputMethod === 'string' ? a.inputMethod.slice(0, 16) : 'tap'},
                ${Number.isFinite(a.misses) ? a.misses : 0},
                ${typeof a.occurredAt === 'string' ? a.occurredAt : new Date().toISOString()})`;
    }
    res.status(200).json({ ok: true, sessionId: Number(sid), attempts: attempts.length });
  } catch (err) {
    res.status(500).json({ error: 'Log failed', detail: String(err.message || err) });
  }
}
