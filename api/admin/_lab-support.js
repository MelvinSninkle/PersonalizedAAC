// /api/admin/lab?action=support  (admin only)
//
// The support inbox — the admin half of consented board access. A case exists
// only because a family filed one (their request IS the permission). The flow
// this enforces:
//   Start review  → snapshots the board + notifies the family in-app
//                   ("we've opened your board") — idempotent, never re-notifies
//   (admin edits the board through the normal admin-privileged surfaces)
//   Finish review → diffs snapshot vs now into a bulk change summary DRAFT
//   Send response → finalizes the message (family sees it verbatim as their
//                   response notice), resolves the case
//
//   GET                              → { cases, counts }        (?status= filter)
//   GET  &id=123                     → full case
//   GET  &id=123&op=diff             → live diff preview (nothing saved)
//   POST { op:'start',  id }         → stamp + snapshot + notice
//   POST { op:'finish', id }         → save generated draft (replaces draft!)
//   POST { op:'draft',  id, text }   → save manual draft edits
//   POST { op:'send',   id, text? }  → finalize + resolve (409 if already sent)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureSupport, snapshotBoard, diffSummary, draftFromDiff } from '../_lib/support.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  await ensureSupport(db);   // the admin path drives the migration

  try {
    if (req.method === 'GET') {
      const id = Number(req.query && req.query.id);
      if (Number.isFinite(id) && id > 0) return await getCase(req, res, db, id);
      return await listCases(req, res, db);
    }
    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const id = Number(b.id);
      if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'id required' }); return; }
      if (b.op === 'start') return await startReview(res, db, id, gate.email);
      if (b.op === 'finish') return await finishReview(res, db, id);
      if (b.op === 'draft') return await saveDraft(res, db, id, b.text);
      if (b.op === 'send') return await sendResponse(res, db, id, b.text, gate.email);
      res.status(400).json({ error: 'unknown op', op: b.op || null });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'support failed', detail: String(err.message || err) });
  }
}

async function listCases(req, res, db) {
  const status = String((req.query && req.query.status) || '').slice(0, 20);
  const cases = status
    ? await db`SELECT id, child_id, kind, status, message, created_by_email, created_at,
                      review_started_at, response_sent_at, resolved_at
               FROM support_cases WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`
    : await db`SELECT id, child_id, kind, status, message, created_by_email, created_at,
                      review_started_at, response_sent_at, resolved_at
               FROM support_cases ORDER BY created_at DESC LIMIT 200`;
  const counts = await db`SELECT status, COUNT(*)::int AS c FROM support_cases GROUP BY status`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true,
    cases: cases.map(pubCase),
    counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.c)])),
  });
}

async function getCase(req, res, db, id) {
  const c = (await db`SELECT * FROM support_cases WHERE id = ${id} LIMIT 1`)[0];
  if (!c) { res.status(404).json({ error: 'case not found' }); return; }
  if (String((req.query && req.query.op) || '') === 'diff') {
    if (!c.board_snapshot) { res.status(400).json({ error: 'start review first — there is no snapshot to diff against' }); return; }
    const now = await snapshotBoard(db, c.child_id);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, lines: diffSummary(c.board_snapshot, now) });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, case: {
    ...pubCase(c),
    responseText: c.response_text || null,
    reviewStartedBy: c.review_started_by || null,
    responseSentBy: c.response_sent_by || null,
    reviewNoticeAckAt: c.review_notice_ack_at || null,
    responseAckAt: c.response_ack_at || null,
    snapshotStats: c.board_snapshot
      ? { at: c.board_snapshot.at, items: (c.board_snapshot.items || []).length,
          categories: (c.board_snapshot.categories || []).length }
      : null,
  } });
}

// Idempotent: the second click (or a second tab) never re-snapshots or
// re-notifies — the guard is the WHERE review_started_at IS NULL.
async function startReview(res, db, id, adminEmail) {
  const c = (await db`SELECT id, child_id, review_started_at FROM support_cases WHERE id = ${id} LIMIT 1`)[0];
  if (!c) { res.status(404).json({ error: 'case not found' }); return; }
  if (c.review_started_at) { res.status(200).json({ ok: true, alreadyStarted: true }); return; }
  const snap = await snapshotBoard(db, c.child_id);
  const updated = await db`
    UPDATE support_cases SET review_started_at = NOW(), status = 'reviewing',
           board_snapshot = ${JSON.stringify(snap)}::jsonb,
           review_started_by = ${adminEmail || null}, updated_at = NOW()
    WHERE id = ${id} AND review_started_at IS NULL
    RETURNING id`;
  if (!updated.length) { res.status(200).json({ ok: true, alreadyStarted: true }); return; }
  // The column stamp IS the family notification — their next followups poll
  // shows the "we've opened your board" notice. No email by design.
  res.status(200).json({ ok: true, started: true,
    snapshot: { items: snap.items.length, categories: snap.categories.length } });
}

// Recomputes the diff and REPLACES the draft (the UI warns before calling
// this when a draft already exists). Allowed any number of times until sent.
async function finishReview(res, db, id) {
  const c = (await db`SELECT id, child_id, board_snapshot, response_sent_at FROM support_cases WHERE id = ${id} LIMIT 1`)[0];
  if (!c) { res.status(404).json({ error: 'case not found' }); return; }
  if (c.response_sent_at) { res.status(409).json({ error: 'already sent' }); return; }
  if (!c.board_snapshot) { res.status(400).json({ error: 'start review first — there is no snapshot to diff against' }); return; }
  const now = await snapshotBoard(db, c.child_id);
  const lines = diffSummary(c.board_snapshot, now);
  const draft = draftFromDiff(lines);
  await db`UPDATE support_cases SET response_text = ${draft}, updated_at = NOW() WHERE id = ${id}`;
  res.status(200).json({ ok: true, lines, draft });
}

async function saveDraft(res, db, id, text) {
  const c = (await db`SELECT id, response_sent_at FROM support_cases WHERE id = ${id} LIMIT 1`)[0];
  if (!c) { res.status(404).json({ error: 'case not found' }); return; }
  if (c.response_sent_at) { res.status(409).json({ error: 'already sent' }); return; }
  await db`UPDATE support_cases SET response_text = ${String(text || '').slice(0, 8000)}, updated_at = NOW()
           WHERE id = ${id}`;
  res.status(200).json({ ok: true });
}

async function sendResponse(res, db, id, text, adminEmail) {
  const c = (await db`SELECT id, response_sent_at, response_text FROM support_cases WHERE id = ${id} LIMIT 1`)[0];
  if (!c) { res.status(404).json({ error: 'case not found' }); return; }
  if (c.response_sent_at) { res.status(409).json({ error: 'already sent' }); return; }
  const final = String(text != null ? text : (c.response_text || '')).trim().slice(0, 8000);
  if (!final) { res.status(400).json({ error: 'response text required' }); return; }
  await db`UPDATE support_cases SET response_text = ${final}, response_sent_at = NOW(),
             response_sent_by = ${adminEmail || null}, status = 'resolved',
             resolved_at = NOW(), updated_at = NOW()
           WHERE id = ${id}`;
  // The family sees `final` verbatim as their response notice on next poll.
  res.status(200).json({ ok: true, sent: true });
}

function pubCase(c) {
  return {
    id: Number(c.id), childId: c.child_id, kind: c.kind, status: c.status,
    message: c.message, createdByEmail: c.created_by_email || null,
    createdAt: c.created_at, reviewStartedAt: c.review_started_at || null,
    responseSentAt: c.response_sent_at || null, resolvedAt: c.resolved_at || null,
  };
}
