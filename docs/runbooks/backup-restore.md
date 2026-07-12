# Backup & restore

The product's irreplaceable data is the children's: boards, tap history,
milestones, persons rosters, and the blob media (tile art, recorded audio,
reference photos). Two systems protect it:

## What runs automatically

**Nightly database dump** — `.github/workflows/backup.yml` runs `pg_dump`
against Neon every night at 08:17 UTC and stores the dump as a GitHub
artifact with 30-day retention (private to this repo).

**One-time setup (required or the workflow fails loudly):** add a repository
secret named `BACKUP_DATABASE_URL` containing the **unpooled** Neon
connection string — in Vercel env vars it's `DATABASE_URL_UNPOOLED` or
`POSTGRES_URL_NON_POOLING` (pg_dump needs a direct connection, not the
pooler). GitHub → repo → Settings → Secrets and variables → Actions.

To grab a backup: repo → Actions → "Nightly DB backup" → newest run →
Artifacts. To force one now: same page → Run workflow.

**Neon's own protection**: Neon keeps point-in-time restore history on all
plans (check the current retention window in the Neon console under
Branches — restore = create a branch at a past timestamp). This is the
fastest recovery from "I deleted the wrong thing five minutes ago."

## What blobs are (and aren't) covered

Blob media lives in Vercel Blob, which is durably replicated but has **no
point-in-time restore** — a deleted blob is gone. Protections in place:

- The product never hard-deletes tile art on replacement: prior images are
  archived to `item_image_history` (see the seed-jobs `force` flow).
- **Lab → `/api/admin/lab?action=backup&op=inventory`** (admin) reconciles
  every blob key the database references (15 key-bearing columns) against
  what Blob actually stores. `missingCount > 0` means the DB points at bytes
  that don't exist — investigate immediately, that is data loss in progress.
  Run it monthly and after anything touching wipe/delete-account code.
- Stored-but-unreferenced blobs are normal (shared TTS cache, history).

## Logical export without pg_dump

`/api/admin/lab?action=backup&op=export&table=<name>` streams one table as
NDJSON (paginated: pass `&after=<last id>` and loop until a short page).
Table list is whitelisted in `api/admin/_lab-backup.js`. Useful for moving
data into analysis tools or spot-checking without database credentials.

## Restore procedures

**Whole database (disaster):**
1. Create a fresh Neon database (or branch).
2. `pg_restore --no-owner -d "$NEW_DATABASE_URL" myworld-YYYY-MM-DD.dump`
3. Point Vercel's `DATABASE_URL`/`POSTGRES_URL` env vars at it; redeploy.
4. Run any endpoint once to let `api/init.js` apply migrations newer than
   the dump.
5. Run the blob inventory (above) — a restored older DB may reference keys
   that were deleted after the dump; the missing list is your triage queue.

**Oops-delete minutes ago:** prefer Neon point-in-time branch restore over
the nightly dump — less data loss.

**Single family's board:** the parent-facing Export button on the web board
(app.html, edit mode) downloads a self-contained JSON with images and audio
inlined as data URLs; the matching Import restores it. This is also the
right answer for "family wants their data" requests.

## Emergency contacts / dependencies

- Database: Neon console (account: the LLC's).
- Blobs + hosting + env vars: Vercel dashboard.
- If both the DB and this repo are lost, the taxonomy survives in git
  (`taxonomy/seed-core-v1.csv`) and the dictionaries in `api/_lib/i18n/` —
  the product's content spine is reconstructible; the families' boards are
  only as safe as the newest dump. Keep the nightly green.
