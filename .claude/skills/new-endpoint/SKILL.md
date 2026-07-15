---
name: new-endpoint
description: >-
  Conventions every new or changed server route in My World Tap to Talk must
  follow. Use whenever a task adds an API endpoint, a new api/ file, a Lab
  action, a cron, a webhook, or a new column/table — "add an endpoint",
  "new route", "store this server-side", "add a table". Walks the decisions
  that keep the deployment alive (Vercel's 100-function ceiling), families
  isolated (self-gating auth + media ownership), and deploys safe (additive
  migrations with pre-schema fallbacks) — the three ways a quick endpoint
  quietly breaks production.
---

# New Endpoint

Every file in `api/` (not `_`-prefixed, not in `_lib/`) is a routed Vercel
serverless function, and the deployment dies at 100 of them. Every endpoint
is reachable by any authenticated family, so it must gate itself — nothing
upstream protects it. And code deploys before schema, so every new column
needs a life before its migration has run. Walk the four decisions in order.

## 1. Does this need a new routed function at all? (usually: no)

Check the budget first:

    find api -name '*.js' ! -name '_*' ! -path 'api/_lib/*' | wc -l   # CI warns at 96

In preference order:

1. **New action on an existing dispatcher.** Admin capability goes behind
   `api/admin/lab.js?action=<name>`: write `api/admin/_lab-<name>.js`
   (underscore = not routed, still importable), start it with `requireAdmin`,
   import + add it to the dispatcher's action map. Store-ish things follow
   the same pattern on `api/store.js?action=`.
2. **New method or query param on the endpoint that owns the resource.**
   A tile operation belongs on `api/items.js`; don't mint `api/tile-foo.js`.
3. **A new routed file** — only for a genuinely new resource that families
   hit directly. Copy the shape of `api/tile-jobs.js` (header comment
   documenting every verb/param, `config` export, `qs/qbool/qint` helpers).

## 2. Self-gate — every handler, first thing, no exceptions

Nothing upstream authenticates. The handler's opening lines are the gate:

    const auth = await checkAuth(req);                          // _lib/auth.js
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

Then scope by role — pick the narrowest that works:

- Child-scoped reads/writes: `canAccessChild(auth.user, childId, db)`
  (parents + invited therapists/school team).
- Parent-only mutations: `isParentOf` / `canEditContent` (_lib/access.js).
- Admin: `const gate = await requireAdmin(req, res); if (!gate.ok) return;`
  (_lib/admin.js — it writes the 401/403 itself).

Hard rules (these are CI invariants — see surface-audit):

- **No unauthenticated spend paths, ever.** `/practice` is the only
  unauthenticated surface and it pre-renders everything. A new endpoint that
  can trigger TTS/image-gen/credits without `checkAuth` is a launch-blocker.
- **Admin-only knobs stay admin-only**: per-request `styleGuideId`/`model`
  overrides gate on `auth.user.role === 'admin'` (C8); the access-experiment
  settings keys gate through ACCESS_KEYS (E6).
- **Charge before work**: credit-spending paths charge at enqueue
  (`chargeForGeneration` / `requireStyling`, _lib/credits.js) and return
  402 `needs_subscription` / `not_enough_credits` with a friendly `detail`.

## 3. Schema — additive, defensive, fallback-ready

Deploys race migrations: new code serves requests before any admin runs
init. So schema changes are three pieces, all in the same commit:

1. **Canonical DDL in `api/init.js`** — `CREATE TABLE IF NOT EXISTS` /
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
   Idempotent, additive only; never DROP or rename in a migration.
2. **A defensive `ensure*` helper** in `_lib/` (pattern: `ensureTileJobs`)
   called at the top of every handler that touches the table, wrapped in
   `try { await ensureX(db); } catch (_) {}`. This is what actually migrates
   production — init.js is belt-and-braces.
3. **Pre-migration fallbacks for readers**: a query selecting a brand-new
   column from an OLD table must catch the undefined-column error and retry
   without it (see init.js's own fallback pattern). Skip this only when the
   `ensure*` call above guarantees the column in the same request.

Always `sql()` tagged templates (`db\`SELECT ... WHERE id = ${id}\``) —
never string-concatenated SQL. Cap persisted strings (`.slice(0, 80)`) and
validate enums server-side, whatever the client promised.

## 4. Media & blobs — isolation is invariant #1

- All blobs are `access: 'private'`; families fetch ONLY through
  `/api/media`, which checks an ownership union across every child-media
  table. **A new table whose rows reference blob keys MUST be added to that
  union in `api/media.js`** — and to the table list in invariants.sh A1 —
  or its media is unreachable (best case) or leaks (worst case).
- The public prefix list in media.js is frozen at 4 (A-PUBLIC). Don't add
  prefixes; if something must be public, argue it in the surface-audit skill
  first.
- Raw uploads: `export const config = { api: { bodyParser: false } }`, read
  the stream with a byte cap (`MAX_BYTES`, 413 on overflow), persist the
  source blob FIRST so the device can disconnect (durability pattern in
  tile-jobs.js). Validate caller-supplied blob keys against a strict prefix
  regex before trusting them (see api/parent/style.js upload action).

## 5. Finishing checklist

- [ ] Header comment: every verb, query param, and auth expectation.
- [ ] `config` export if the route needs `maxDuration` or raw body.
- [ ] `Cache-Control: no-store` on listings that must never go stale.
- [ ] `node --check api/<file>.js`, then `bash tools/ci/syntax-checks.sh`
      and `bash tools/surface-audit/invariants.sh`.
- [ ] Function count still comfortably under the ceiling (step 1).
- [ ] If the endpoint created a NEW rule worth keeping: add a grep to
      invariants.sh + a lettered section to the surface-audit skill.
- [ ] Touching labels, TTS cache keys, ACCESS_KEYS, media.js, or admin
      handlers trips existing invariants (E2, B3, E6, A1, D) — read the
      matching surface-audit section BEFORE changing them, not after CI fails.
