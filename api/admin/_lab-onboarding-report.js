// GET/POST /api/admin/lab?action=onboarding-report   (admin only)
//
// The families health report (§4a of the onboarding-hardening batch): one row
// per parent account with the four timestamps/facts that tell you whether an
// onboarding finished — signup, first payment, credit balance, entitlement —
// plus what actually landed on the board (image generations, seed-job state,
// onboarding step cursor). Rows are FLAGGED when a family paid or holds
// credits but has zero generated images: that's an interrupted onboarding
// the admin should rescue (🧰 Build board / Apply defaults).
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';
import { ensureSeedJobs, seedStatus } from '../_lib/seed-board.js';
import { ensureCredits, creditBalance, entitlementFor } from '../_lib/credits.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;

  try {
    const db = sql();
    await ensureCredits(db);
    await ensureSeedJobs(db);

    const users = await db`
      SELECT id, email, role, child_slug, created_at, last_login_at
      FROM users WHERE role != 'admin' OR child_slug IS NOT NULL
      ORDER BY created_at DESC LIMIT 200`;

    // First payment per user (any platform), one query.
    const pays = await db`
      SELECT DISTINCT ON (user_id) user_id, created_at, product_id, platform
      FROM purchases ORDER BY user_id, created_at ASC`;
    const payByUser = new Map(pays.map((p) => [Number(p.user_id), p]));

    // Onboarding step cursor per user.
    let stepByUser = new Map();
    try {
      const steps = await db`SELECT user_id, step, updated_at FROM onboarding_progress`;
      stepByUser = new Map(steps.map((s) => [Number(s.user_id), s]));
    } catch (_) { /* table may not exist on old deploys */ }

    // Generated images per child (excludes the admin lab's __lab__ rows).
    const gens = await db`
      SELECT child_id, count(*)::int AS n, max(created_at) AS last
      FROM image_generations
      WHERE child_id IS NOT NULL AND child_id != '__lab__'
      GROUP BY child_id`;
    const genByChild = new Map(gens.map((g) => [g.child_id, g]));

    const rows = [];
    for (const u of users) {
      const uid = Number(u.id);
      const pay = payByUser.get(uid) || null;
      const step = stepByUser.get(uid) || null;
      const gen = u.child_slug ? genByChild.get(u.child_slug) : null;
      const balance = await creditBalance(db, uid);
      const ent = await entitlementFor(db, { uid, role: u.role });
      const seeds = u.child_slug ? await seedStatus(db, u.child_slug) : null;
      const images = gen ? gen.n : 0;
      // The §4a flag: money in (payment or credits) but no images out.
      const flagged = images === 0 && (!!pay || balance > 0 || !!ent.sub);
      rows.push({
        userId: uid, email: u.email, childId: u.child_slug || null,
        signupAt: u.created_at, lastLoginAt: u.last_login_at || null,
        paidAt: pay ? pay.created_at : null,
        paidSku: pay ? pay.product_id : null,
        balance, tier: ent.label, tierSource: ent.source,
        step: step ? step.step : null,
        images, lastImageAt: gen ? gen.last : null,
        seeds, flagged,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, rows, flagged: rows.filter((r) => r.flagged).length });
  } catch (err) {
    res.status(500).json({ error: 'onboarding-report failed', detail: String(err.message || err) });
  }
}
