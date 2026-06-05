// /api/live?childId=X — real-time "room" for facilitator-guided games.
// The tablet publishes game STATE; the therapist's phone pushes COMMANDS
// (start / mark / skip / next / end). Both sides poll this endpoint (~1s).
// Routed through the DB, so the two devices don't need the same network.
//   GET  ?childId=                      → { status, payload, cmd, cmdSeq, age }
//   POST { kind:'state', status, payload }   (tablet publishes what's on screen)
//   POST { kind:'cmd', action, method?, scope?, choices? }  (phone pushes a command)
// Auth-gated (session cookie or admin token).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const childId = String((req.query && req.query.childId) || (req.body && req.body.childId) || 'fletcherpeterson').slice(0, 64);

  try {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS live_sessions (
        child_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        payload JSONB,
        cmd JSONB,
        cmd_seq INTEGER NOT NULL DEFAULT 0,
        state_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    if (req.method === 'GET') {
      const rows = await db`
        SELECT status, payload, cmd, cmd_seq, state_seq,
               floor(extract(epoch from (now() - updated_at)))::int AS age
        FROM live_sessions WHERE child_id = ${childId}`;
      res.setHeader('Cache-Control', 'no-store');
      if (!rows.length) { res.status(200).json({ status: 'idle', payload: null, cmd: null, cmdSeq: 0, age: null }); return; }
      const r = rows[0];
      res.status(200).json({ status: r.status, payload: r.payload, cmd: r.cmd, cmdSeq: Number(r.cmd_seq), age: r.age });
      return;
    }

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      if (b.kind === 'cmd') {
        const cmdObj = {
          action: String(b.action || '').slice(0, 16),
          method: typeof b.method === 'string' ? b.method.slice(0, 16) : null,
          mode: typeof b.mode === 'string' ? b.mode.slice(0, 24) : null,
          scope: typeof b.scope === 'string' ? b.scope.slice(0, 32) : null,
          scopes: Array.isArray(b.scopes) ? b.scopes.filter(s => typeof s === 'string').slice(0, 20).map(s => s.slice(0, 32)) : null,
          choices: Number.isFinite(b.choices) ? b.choices : null,
          limitMin: Number.isFinite(b.limitMin) ? b.limitMin : null,
          secondsPerImage: Number.isFinite(b.secondsPerImage) ? b.secondsPerImage : null,
          labelStyle: typeof b.labelStyle === 'string' ? b.labelStyle.slice(0, 16) : null,
          music: typeof b.music === 'string' ? b.music.slice(0, 200) : null,
          steps: Array.isArray(b.steps) ? b.steps.slice(0, 12).map(s => ({
            mode: typeof s.mode === 'string' ? s.mode.slice(0, 24) : 'self_paced',
            scope: typeof s.scope === 'string' ? s.scope.slice(0, 32) : 'all',
            choices: Number.isFinite(s.choices) ? s.choices : null,
            limitMin: Number.isFinite(s.limitMin) ? s.limitMin : null,
            secondsPerImage: Number.isFinite(s.secondsPerImage) ? s.secondsPerImage : null,
            music: typeof s.music === 'string' ? s.music.slice(0, 200) : null,
          })) : null,
          from: Number.isFinite(b.from) ? b.from : null,
          to: Number.isFinite(b.to) ? b.to : null,
          sample: Number.isFinite(b.sample) ? b.sample : null,   // random N from the range
          // PRD §3 mercy bridge: when a facilitator marks a pass, the iPad
          // needs to know how many attempts the round took so its game-log
          // attempt row carries the right attempts_taken (1=first try, 2+=mercy).
          attemptsTaken: Number.isFinite(b.attemptsTaken) ? b.attemptsTaken : null,
          ts: Date.now(),
        };
        const json = JSON.stringify(cmdObj);
        const rows = await db`
          INSERT INTO live_sessions (child_id, cmd, cmd_seq, updated_at)
          VALUES (${childId}, jsonb_set(${json}::jsonb, '{seq}', '1'::jsonb), 1, now())
          ON CONFLICT (child_id) DO UPDATE SET
            cmd_seq = live_sessions.cmd_seq + 1,
            cmd = jsonb_set(${json}::jsonb, '{seq}', to_jsonb(live_sessions.cmd_seq + 1)),
            updated_at = now()
          RETURNING cmd_seq`;
        res.status(200).json({ ok: true, cmdSeq: Number(rows[0].cmd_seq) });
        return;
      }
      // default: state publish
      const status = typeof b.status === 'string' ? b.status.slice(0, 16) : 'running';
      const json = JSON.stringify(b.payload || {});
      await db`
        INSERT INTO live_sessions (child_id, status, payload, state_seq, updated_at)
        VALUES (${childId}, ${status}, ${json}::jsonb, 1, now())
        ON CONFLICT (child_id) DO UPDATE SET
          status = ${status}, payload = ${json}::jsonb,
          state_seq = live_sessions.state_seq + 1, updated_at = now()`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Live request failed', detail: String(err.message || err) });
  }
}
