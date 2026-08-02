# Onboard a tester family

The full path from "a parent said yes" to "their child is using the board",
including the dark-launched extras (language testers, access experiments).

## 1. Standard family (English, no experiments)

1. Send them the signup link (myworldtaptotalk.com → Get early access, or an
   invite code from Lab if invite-gating is on).
2. They self-serve through onboarding: child info (boy/girl only — anything
   else routes to support), style pick, family photos, keystone scene
   approval, board build. The build continues server-side if they close.
3. Watch their build: admin/reports.html → sync health; or Lab board-state.
4. If images stall: Lab → the seed-rescue tool re-arms dead jobs.
5. TestFlight (iPad) or Play (Android/Fire) invite if they want the app —
   see runbooks/release.md for adding external testers.

## 2. Language-tester family (e.g. the Chinese dad)

1. BEFORE they sign up: Lab → Reports → Accounts panel → role grant for
   their email as `language_tester` (applies automatically at signup, both
   email and Apple paths).
2. Seed the language dictionary once (per language):
   `POST /api/admin/lab?action=translations {op:'seed', lang:'zh'}` (Lab UI).
3. Verify coverage: GET the same action — `coverage.missingWords` should be
   empty for the language.
4. Add at least one voice for the language: admin/voices.html → add voice by
   ElevenLabs ID with the language tag. Non-English voices only show to
   admins/testers. **Skip this and everything downstream silently falls back
   to an English-language voice** — the Translations page warns when a
   language has no tagged voice.
5. **Listen to it yourself before they do** (Lab → Translations, Board audio
   bar): pick the voice, then read the four counts.
   - *speak English* — words with no translation. A tile like this says the
     English word on a Chinese board. Fix the translation first; Build skips
     them on purpose rather than caching the wrong audio.
   - *no clip yet* / *stale* — click **Build missing clips** and repeat until
     it reports Complete. Words this voice has already spoken anywhere in the
     product are copied free; the run tells you the free-vs-generated split.
   - Spot-check with ▶ on individual rows, or **Play all** to walk the whole
     filtered list hands-free.
6. The parent (now a tester) sees the language picker in onboarding and in
   the dashboard Board tab. New tiles render with NO baked text and speak
   translated audio. **A newly granted role only takes effect on their next
   sign-in** — the session cookie carries the role from when it was signed,
   so have them sign out and back in if they were already logged in.
7. Review loop: Lab → Translations → CSV export → they correct → import
   (their rows become `reviewed` and re-seeds never overwrite them). Editing a
   translation marks its clip **stale** — rebuild and re-listen.
8. If they enable language AFTER tiles exist: Lab → Publish → push sounds to
   the child (regenerates clips in the board language). Check the child's
   board first — Translations → "check a child's board" reports THAT board's
   language, saved voice and tiles, so you can confirm every word reads
   *ready* before you push. Every row ready ⇒ the push is a fast, free copy.

   Note what a sound push cannot fix: tiles whose art came from the shared
   default layers were **rendered in English with the word painted into the
   image**. Only tiles seeded after the language was set render text-free.
   Fixing those means re-rendering art, which costs credits.

## 3. Access-experiment family (eye tracker / sentence builder)

1. These settings are admin-only writes: open THEIR child's parent dashboard
   as YOURSELF (admin) — `/parent/<their-child-slug>` — Board tab → Access
   panel.
2. Pick: Board navigation (buttons for eye-gaze), Sentence constructor
   (+ pick-up style: hold-then-drag default; "drag right away" for
   eye-tracker rigs; clear-after minutes), listening repeat-jump.
3. The board applies on its next settings sync (web ~immediately on reload;
   native apps on relaunch or pull-to-refresh).
4. Eye-tracker specifics: browsers on gaze devices (Tobii etc.) emulate a
   mouse — buttons mode + "drag right away" is the intended pairing.

## 4. Verify before handing over (5 minutes)

- Board loads under their slug; tiles have art (no gray squares).
- Tap a tile → hears the chosen voice.
- Parent login works on their phone; stats appear after a few taps.
- If tester features are on: the feature actually shows for THEIR account,
  and does NOT show for a plain parent account (spot-check with a non-admin
  login).

## 5. When they report problems

support@myworldtaptotalk.com is the contract. Triage with
runbooks/incident-triage.md. For image-quality complaints: regenerate the
tile from the parent dashboard (guided retry with their correction text) or
Lab per-tile publish for defaults.
