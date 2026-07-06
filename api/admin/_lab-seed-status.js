// GET/POST /api/admin/lab?action=seed-status&childId=   (admin only)
//
// Live assurance for the build-board rescue: the aggregate seedStatus counts
// (place/render/voice — total/done/dead) PLUS the most recent failed jobs
// with their actual error text, so "did the image generation work?" has a
// concrete answer instead of a fire-and-forget button.
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureSeedJobs, seedStatus } from '../_lib/seed-board.js';

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  const childId = String((req.query && req.query.childId) || '').slice(0, 64).trim();
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }

  try {
    const db = sql();
    await ensureSeedJobs(db);
    const status = await seedStatus(db, childId);
    const failures = await db`
      SELECT id, kind, taxonomy_id, status, attempts, error, updated_at
      FROM seed_jobs
      WHERE child_id = ${childId} AND status = 'failed'
      ORDER BY updated_at DESC LIMIT 20`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true, childId, status,
      failures: failures.map((f) => ({
        id: Number(f.id), kind: f.kind, taxonomyId: f.taxonomy_id,
        attempts: f.attempts, error: f.error || null, updatedAt: f.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'seed-status failed', detail: String(err.message || err) });
  }
}
