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
    voice: { count: 0, chars: 0, costCents: 0, monthCount: 0, monthChars: 0, monthCostCents: 0 },
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
      GROUP BY 1 ORDER BY cost DESC LIMIT 2000`;
    out.perAccount = pa.map((r) => ({ account: r.account, count: r.count, costCents: r.cost,
                                      voiceChars: 0, voiceCostCents: 0 }));

    // The child board each account owns + its effective tier — so the admin
    // table can show WHO an account is and comp/simulate their membership.
    try {
      let users;
      try {
        users = await db`SELECT id, email, child_slug, sub_override, sub_override_expires FROM users LIMIT 5000`;
      } catch (_) {
        users = await db`SELECT id, email, child_slug, sub_override, NULL AS sub_override_expires FROM users LIMIT 5000`;
      }
      // Active subscription per user: newest sub-sku purchase in the same
      // 35-day window activeSubscription() uses.
      const { SUBSCRIPTIONS, subscriptionBySku } = await import('./_lib/credits.js');
      const skus = SUBSCRIPTIONS.flatMap((s) => [s.sku, s.appleProductId, s.googleProductId]);
      const subs = await db`
        SELECT DISTINCT ON (user_id) user_id, product_id FROM purchases
        WHERE product_id = ANY(${skus}) AND created_at > NOW() - INTERVAL '35 days'
        ORDER BY user_id, created_at DESC`;
      const subByUser = new Map(subs.map((r) => [Number(r.user_id), r.product_id]));
      const byEmail = new Map(users.map((r) => [r.email, r]));
      for (const row of out.perAccount) {
        const u = byEmail.get(row.account);
        if (!u) continue;
        row.childId = u.child_slug || null;
        // An expired comp reads as no override (entitlementFor clears lazily).
        const exp = u.sub_override_expires ? new Date(u.sub_override_expires) : null;
        const expired = !!(exp && exp.getTime() <= Date.now());
        row.override = expired ? null : (u.sub_override || null);
        row.overrideExpires = row.override && exp ? exp.toISOString() : null;
        const effective = row.override || subByUser.get(Number(u.id)) || null;
        const sub = effective && effective !== 'free' ? subscriptionBySku(effective) : null;
        row.tier = sub ? sub.label : 'Free';
      }
    } catch (_) { /* users table variants — columns stay null */ }

    // ElevenLabs voice spend — the same per-account attribution (the logged
    // user id when known, else the board owner), merged into the image rows so
    // one table shows a family's full AI cost.
    try {
      const vo = await db`
        SELECT count(*)::int AS count, coalesce(sum(chars), 0)::int AS chars,
               coalesce(sum(cost_cents), 0)::float AS cost,
               coalesce(sum(case when created_at >= date_trunc('month', now()) then 1 else 0 end), 0)::int AS mcount,
               coalesce(sum(case when created_at >= date_trunc('month', now()) then chars else 0 end), 0)::int AS mchars,
               coalesce(sum(case when created_at >= date_trunc('month', now()) then cost_cents else 0 end), 0)::float AS mcost
        FROM voice_generations`;
      out.voice = { count: vo[0].count, chars: vo[0].chars, costCents: vo[0].cost,
                    monthCount: vo[0].mcount, monthChars: vo[0].mchars, monthCostCents: vo[0].mcost };

      const vpa = await db`
        SELECT coalesce(u1.email, u2.email, '(token)') AS account,
               coalesce(sum(v.chars), 0)::int AS chars, coalesce(sum(v.cost_cents), 0)::float AS cost
        FROM voice_generations v
        LEFT JOIN users u1 ON u1.id = v.user_id
        LEFT JOIN users u2 ON u2.child_slug = v.child_id
        GROUP BY 1 ORDER BY cost DESC LIMIT 2000`;
      const byAccount = new Map(out.perAccount.map((a) => [a.account, a]));
      for (const r of vpa) {
        const row = byAccount.get(r.account);
        if (row) { row.voiceChars = r.chars; row.voiceCostCents = r.cost; }
        else out.perAccount.push({ account: r.account, count: 0, costCents: 0,
                                   voiceChars: r.chars, voiceCostCents: r.cost });
      }
      out.perAccount.sort((a, b) => (b.costCents + b.voiceCostCents) - (a.costCents + a.voiceCostCents));
    } catch (_) { /* voice_generations may not exist yet */ }

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
