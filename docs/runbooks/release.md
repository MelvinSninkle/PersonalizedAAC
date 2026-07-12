# Releasing: web, iOS, Android

## Web (Vercel)

Merging to `main` deploys automatically (Vercel Git integration). Before
merging a feature branch: CI must be green (syntax + invariants + smoke).
Env vars live in Vercel → Project → Settings → Environment Variables — the
full list is in the owner's manual + `grep -rn "process.env" api/`.
Rollback: Vercel dashboard → Deployments → promote a previous one.

## iOS (TestFlight) — hard-won notes from the first release

Local setup: a folder clone on the Mac. Update cycle:

    git pull
    xcodegen generate      # ALWAYS — new files don't exist in Xcode until this
    open MyWorld.xcodeproj

Build numbers live in `kid-ios/project.yml` (MARKETING_VERSION +
CURRENT_PROJECT_VERSION). **The number is stamped at ARCHIVE time** — the
"Redundant Binary Upload" loop happens when you re-upload a stale archive.
Bump project.yml → xcodegen generate → Product → Archive → in Organizer,
CONFIRM the Version column shows the new number BEFORE Distribute.

App Store Connect (appstoreconnect.apple.com, same Apple ID):
- TestFlight tab → build appears after processing (10–30 min).
- Export compliance is pre-answered (ITSAppUsesNonExemptEncryption=false in
  Info.plist), so no questionnaire per build.
- External testers need Beta App Review once per version: fill Test
  Information, provide the demo login (a real test account — don't put
  "n/a"), submit. Internal testers (your own account) need no review.
- Add testers by email under the group; they get the TestFlight invite.

## Android / Fire

No CI build (no gradlew wrapper committed). Local: open `android-native/`
in Android Studio → build. Release: Play Console (billing uses
verify-before-consume against `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` +
`PLAY_PACKAGE_NAME`). Fire tablets: sideload or Amazon Appstore later —
the store screen already falls back to the web store for non-Play devices.

## After ANY release touching api/ or the HTML surfaces

Run the surface audit (the `surface-audit` skill, or minimally
`bash tools/surface-audit/invariants.sh`). If you added a new surface,
extend the skill — that's its self-extension rule.
