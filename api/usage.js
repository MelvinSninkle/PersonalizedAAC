// GET /api/usage — AI image-generation cost & volume for the admin dashboard.
// Returns overall totals (all-time + this month), per-account breakdown, and
// the most recent generations (with prompt + references). Admin only.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  if (auth.user.role !== 'admin') {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const db = sql();
  const out = {
    overall: { count: 0, costCents: 0, monthCount: 0, monthCostCents: 0 },
    perAccount: [],
    recent: [],
  };
  try {
    const o = await db`
      SELECT count(*)::int AS count,
             coalesce(sum(cost_cents), 0)::float AS cost,
             coalesce(sum(case when created_at >= date_trunc('month', now()) then 1 else 0 end), 0)::int AS mcount,
             coalesce(sum(case when created_at >= date_trunc('month', now()) then cost_cents else 0 end), 0)::float AS mcost
      FROM image_generations`;
    out.overall = { count: o[0].count, costCents: o[0].cost, monthCount: o[0].mcount, monthCostCents: o[0].mcost };

    // Attribution: the acting account when known, else the BOARD OWNER's
    // account (cron-run seed jobs and admin rescues have no signed-in actor —
    // the spend still belongs to the family whose board it built).
    const pa = await db`
      SELECT coalesce(g.actor_email, u.email, '(token)') AS account,
             count(*)::int AS count, coalesce(sum(g.cost_cents), 0)::float AS cost
      FROM image_generations g
      LEFT JOIN users u ON u.child_slug = g.child_id
      GROUP BY 1 ORDER BY cost DESC`;
    out.perAccount = pa.map((r) => ({ account: r.account, count: r.count, costCents: r.cost }));

    const rec = await db`
      SELECT g.id, g.child_id, coalesce(g.actor_email, u.email) AS actor_email, g.label, g.style, g.prompt,
             g.reference_keys, g.input_tokens, g.output_tokens, g.cost_cents, g.created_at
      FROM image_generations g
      LEFT JOIN users u ON u.child_slug = g.child_id
      ORDER BY g.created_at DESC LIMIT 100`;
    out.recent = rec.map((r) => ({
      id: Number(r.id),
      childId: r.child_id,
      actor: r.actor_email || '(token)',
      label: r.label,
      style: r.style,
      prompt: r.prompt,
      referenceKeys: r.reference_keys || [],
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costCents: r.cost_cents == null ? null : Number(r.cost_cents),
      createdAt: r.created_at,
    }));

    // Resolve each generation's reference blob key(s) back to the style_guides
    // row they belong to, so the admin can see EXACTLY which style guide id (and
    // owner) was used — proof of which style fed the generation.
    const allKeys = [...new Set(out.recent.flatMap((r) => r.referenceKeys || []))];
    if (allKeys.length) {
      let sg = [];
      try {
        sg = await db`SELECT id, label, child_id, ephemeral, active, blob_key
                      FROM style_guides WHERE blob_key = ANY(${allKeys})`;
      } catch (_) { sg = []; }
      const byKey = new Map(sg.map((s) => [s.blob_key, s]));
      out.recent.forEach((r) => {
        r.styleRefs = (r.referenceKeys || [])
          .map((k) => byKey.get(k))
          .filter(Boolean)
          .map((s) => ({ id: Number(s.id), label: s.label, childId: s.child_id || null,
                         ephemeral: !!s.ephemeral, active: !!s.active }));
      });
    }
  } catch (_) { /* table may not exist yet — return zeros */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
