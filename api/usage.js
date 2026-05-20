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

    const pa = await db`
      SELECT coalesce(actor_email, '(token)') AS account, count(*)::int AS count, coalesce(sum(cost_cents), 0)::float AS cost
      FROM image_generations GROUP BY 1 ORDER BY cost DESC`;
    out.perAccount = pa.map((r) => ({ account: r.account, count: r.count, costCents: r.cost }));

    const rec = await db`
      SELECT id, child_id, actor_email, label, style, prompt, reference_keys, input_tokens, output_tokens, cost_cents, created_at
      FROM image_generations ORDER BY created_at DESC LIMIT 100`;
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
  } catch (_) { /* table may not exist yet — return zeros */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
