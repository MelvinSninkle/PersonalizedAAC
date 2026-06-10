// /api/skill-insights — read the consolidated joint-attention narrative per
// (skill, mode) for a child, and dismiss the "consider eval" signal.
//
//   GET  ?childId=                                 → { insights: [...] }
//   POST { id, action: 'dismiss' }                 → therapist-only
//
// PRD §7 + §8.6: insights are refreshed by the daily cron at
// /api/cron/refresh-insights and SURFACED here; the dismiss action is
// gated to therapist + admin so parents can see "consider eval" but only
// a clinician can clear it.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    if (req.method === 'GET') {
      const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
      if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      const rows = await db`
        SELECT id, child_id, skill_slug, mode, label, evidence,
               consider_eval, dismissed_at, dismissed_by, generated_at
        FROM skill_insights
        WHERE child_id = ${childId}
        ORDER BY
          CASE WHEN consider_eval AND dismissed_at IS NULL THEN 0 ELSE 1 END,
          generated_at DESC
        LIMIT 60`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        insights: rows.map(r => ({
          id: Number(r.id),
          childId: r.child_id,
          skillSlug: r.skill_slug,
          mode: r.mode,
          label: r.label,
          evidence: r.evidence || {},
          considerEval: !!r.consider_eval,
          dismissedAt: r.dismissed_at,
          dismissedBy: r.dismissed_by,
          generatedAt: r.generated_at,
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      // PRD §8.6: only therapist + admin can dismiss consider-eval, since
      // it's a clinical-adjacent signal.
      const role = auth.user.role || '';
      if (role !== 'therapist' && role !== 'admin' && role !== 'school_team') {
        res.status(403).json({ error: 'Only a therapist can dismiss an insight.' }); return;
      }
      const b = (typeof req.body === 'object' && req.body) || {};
      const id = Number(b.id);
      const action = b.action;
      if (!Number.isFinite(id) || action !== 'dismiss') {
        res.status(400).json({ error: 'id + action="dismiss" required' }); return;
      }
      const owner = await db`SELECT child_id FROM skill_insights WHERE id = ${id} LIMIT 1`;
      if (!owner.length) { res.status(404).json({ error: 'Not found' }); return; }
      if (!(await canAccessChild(auth.user, owner[0].child_id, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      await db`
        UPDATE skill_insights
        SET dismissed_at = NOW(),
            dismissed_by = ${auth.user.email || role}
        WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: String(err.message || err) });
  }
}
