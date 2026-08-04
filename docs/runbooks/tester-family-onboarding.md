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
     filtered list hands-free. Every play reports the clip's duration and
     size — a "clip" under ~0.3s / 2 KB is flagged as **empty/near-silent**.
   - **Clips exist but you hear nothing?** Check the model warning next to
     the voice picker: an English-only `ELEVENLABS_MODEL_ID` (e.g.
     `eleven_turbo_v2` — note the multilingual one is `eleven_turbo_v2_5`)
     renders non-English text as valid, cacheable SILENCE. Fix the env var,
     redeploy, and rebuild — the model is part of the cache key, so every
     clip flips to *stale* and rebuilds cleanly; silent junk is left behind
     unreferenced.
5b. **Fill the gaps with one CSV.** Translations → **Export gaps CSV**
   downloads only the rows still needing work: every untranslated taxonomy
   word AND the quiz/prompt phrases ("I can see a {word}", "Who or what is
   the {word}?", the scheduler nudges — section `ui`, keep `{word}` exactly).
   Fill the translation column, Import the same file, done — the coverage
   chips and the phrase chip go green, then Build clips for the new words.
   Until a phrase is translated, quizzes/slideshows degrade to the bare word
   (never English prose around a translated word); untranslated scheduler
   nudges still speak English, so they're listed as gaps too.
6. The parent (now a tester) sees the language picker in onboarding and in
   the dashboard Board tab. New tiles render with NO baked text and speak
   translated audio. **A newly granted role only takes effect on their next
   sign-in** — the session cookie carries the role from when it was signed,
   so have them sign out and back in if they were already logged in.
7. Review loop: Lab → Translations → CSV export → they correct → import
   (their rows become `reviewed` and re-seeds never overwrite them). Editing a
   translation marks its clip **stale** — rebuild and re-listen.
8. If they enable language AFTER tiles exist: check first, then push, all
   from Translations. "check a child's board" reports THAT board's language,
   saved voice and tiles, plus the ground truth — **"old clips on board"**
   counts tiles whose `sound_key` still points at the previous language's
   audio (this is "still speaks English after I changed the language"; ↻ on
   the row). When the clip states read *ready*, click **Push clips to this
   board** — it runs the same publish op as Lab → Publish (sounds only, so
   no layout-checkbox mistakes), loops until done, and re-verifies. The board
   itself picks the new clips up on its next sync: reload the web board or
   relaunch the app.

   Note what a sound push cannot fix: tiles whose art came from the shared
   default layers were **rendered in English with the word painted into the
   image**. Only tiles seeded after the language was set render text-free.
   Fixing those means re-rendering art, which costs credits.
9. The parent can work in their own language directly — no admin needed:
   - **Add a tile** and type the word in their language (e.g. 饺子): the clip
     is synthesized from exactly what they typed, in the board's saved voice,
     and on a non-English board the art renders with **no baked text**.
   - **Rename a tile** to their language: the clip re-generates automatically
     to speak the new word. Only app-generated audio is replaced — a parent's
     own recording survives a rename.
   - **Custom phrases**: board ✏️ → edit a tile → type any phrase → Generate
     — previews and saves a clip in the board voice; that clip is treated as
     the parent's own and is never overwritten by pushes or renames.
   These are per-tile family words — they live outside the taxonomy, so they
   don't need (and don't get) dictionary entries or the review bench.

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
