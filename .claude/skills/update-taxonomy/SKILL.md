---
name: update-taxonomy
description: >-
  Checklist and conventions for adding, editing, or retiring taxonomy rows in
  My World Tap to Talk. Use whenever a task touches vocabulary: "add a word",
  "add tiles/boards", "rename a tile", edits to taxonomy rows, match terms,
  pronunciations, translations, or listening-mode coverage. A taxonomy row now
  fans out into SIX surfaces — prompt/image, match terms (listening mode),
  six-language translations, audio, milestones grammar, and store/board
  placement — and this skill walks each one so nothing ships half-wired.
---

# Update Taxonomy

The taxonomy is the product's vocabulary spine. One row = one word a child can
tap. But a row is no longer just a label + image prompt: it feeds listening
mode, six languages, milestone detection, and the store. Adding a word and
skipping a step below produces a tile that *looks* done and silently fails one
audience (the Chinese tester, the listening strip, the milestone push).

**The one rule that governs everything: the English `label` is the row's
IDENTITY, forever.** Style-default image lookups, shop matching, publish
tools, analytics, and the translation dictionary all key on the English label
(and `taxonomy_slug`). Localizing a label = breaking every one of those.
Translations are a *display + audio layer* (see `api/_lib/i18n.js` header),
never a label rewrite.

## Where edits happen

- UI: `/admin/taxonomy` (admin only). API: `api/admin/_taxonomy-crud.js`
  (multiplexed; every write is audited to `taxonomy_audit`).
- Bulk/scripted edits go through the same endpoint — never raw SQL, or the
  audit trail and validation are bypassed.
- Migrations live in `api/init.js`; endpoints that read new columns must keep
  a pre-migration fallback query (try new-column SELECT, catch → old SELECT).

## Checklist for a NEW word (run every section)

### 1. The row itself
- `id`: `[a-z0-9_]+(.[a-z0-9_]+)*` — convention is `section.label`-ish slugs
  (see create-board in `api/admin/_lab-boards.js`: `[section,label,word].map(slugify).join('.')`).
- `column`: one of People, Nouns, Verbs, Needs, Events. This is not cosmetic —
  milestone combo classification (`classifyCombo` in `api/_lib/milestones.js`)
  keys on section, so a verb filed under Nouns degrades combo detection.
- `label`: short, English, toddler-real ("tummy" not "abdomen"). Check for an
  existing row first (`GET /api/admin/taxonomy?q=`) — homonyms are handled by
  category context, not duplicate labels.
- `category`/`subcategory`: set them; they drive folder placement, the
  feelings blocklist in milestones (`FEELING_CATS` contains-match on
  expression/feeling/emotion), and translation homonym overrides.
- `phase`, `status` (draft|published), `core`, `audience`
  (universal|parent|therapist|school_team|family), `authoringKind`.
  Non-universal / non-canonical rows are EXCLUDED from translation coverage
  and store surfaces by design.
- `pronunciation`: only when TTS mangles the label ("read" the verb, names).

### 2. Prompt + image (defer to the `aac-prompt-author` skill)
- `promptTemplate`, `subjectMode`, `parentPhotoBehavior`, `rolesPresent`,
  `objectsPresent`, `hasRelationship`, `relatedImages` — author these with the
  aac-prompt-author skill; it owns groundedness/pairing rules.
- New rows appear automatically in the defaults view (`/admin/defaults`) for
  per-style image generation. Generate or queue images for every active style.
- Non-English boards render with `suppressBakedText` (no text baked into the
  art) — you do NOT author a separate prompt per language.

### 3. Match terms — listening mode (`match_terms` column)
The morphology engine (`api/_lib/word-match.js`) auto-generates regular
English inflections at /api/sync time (loves/loving/loved, cries/crying/cried,
hugging/hugged via CVC doubling). Curate `matchTerms` (≤24, ≤60 chars) ONLY for
what generation can't produce:
- Irregular forms not in the `IRREGULAR` map (went/ate/mice…). If the word is a
  common verb/noun with irregular inflection, prefer ADDING IT TO THE MAP in
  word-match.js (base-form key) so every tile with that label benefits — use
  curated terms for one-off rows.
- Synonyms & regional words ("soda" for juice? no — only true same-tile words:
  "granny"→grandma, "telly"→tv, "paci"→pacifier).
- Multi-word labels ("all done", "ice cream") get NO generated inflections —
  curate any variants you want matched.
- Comparatives (-er/-est) are never generated (junk like "cookier") — curate
  "bigger"/"biggest" on "big" if wanted.

NEVER port matching logic to a client. iOS/Android/web tokenizers only index
the pre-expanded strings shipped by /api/sync; the label always wins the index
over another tile's variant. New variants reach devices on their next sync.

### 4. Translations — all six languages
Languages: en (identity) + zh, es, fr, pt, de. Two places, in this order:
1. **Bundled dictionaries** `api/_lib/i18n/{zh,es,fr,pt,de}.json` — add one
   entry per language: `{ "en": "<label>", "t": "<translation>" }`, plus
   `"section"` / `"category"` keys ONLY when the same English word needs
   different translations by context (the established homonym pattern:
   drink noun vs verb, chicken food vs animal, watch verb vs clock, orange
   color vs fruit, help needs vs verbs). Match the file's register: toddler
   caregiver speech (xixi, Pipi, 尿尿, pipí), German nouns capitalized.
   NOTE: `.gitignore` has a blanket `*.json` rule — `!api/_lib/i18n/*.json`
   un-ignores these; confirm new dictionary files actually got committed.
2. **Live DB** — seed via Lab → Translations (`POST /api/admin/lab?action=translations`
   `{op:'seed', lang}`) per language. Seeding never overwrites rows a native
   speaker marked `reviewed`.

Verify coverage: `GET /api/admin/lab?action=translations&lang=<l>` returns
`coverage.missingWords` — it must not contain your new label (for any of the
five languages). The CSV export/import loop is how native testers correct
entries; imported rows become `reviewed`.

If translated later than shipped: existing tiles keep their English audio
until re-pushed — see step 6.

### 5. Milestones grammar (only for CORE/pivot words)
If the new word is an opener/pivot ("gimme", "wanna") or a needs-strip content
word, add it to the right set in `api/_lib/milestones.js`: `PIVOTS`,
`CONTENT_NEEDS`, `FEELING_PIVOTS`, or `NOISE_WORDS` (pure response words like
"yes" that must never count as a combination). Ordinary nouns/verbs/people
need nothing — section membership covers them.

### 6. Audio + publishing
- New tiles synthesize speech on demand; the spoken text is
  translation.pron → translation.label → taxonomy.pronunciation → label
  (`spokenTextFor` in `api/_lib/seed-board.js`).
- After changing a label's pronunciation or its translation, re-push sounds to
  affected children: Lab → Publish (pushSounds translates per-child board
  language before the cache stamp, so stale English audio gets replaced).

### 7. Store / board placement
- If the word belongs on a themed/store board, manage it in the defaults view
  or Lab → Boards (`board_catalog`: store-only flag, free vs credits).
  Store-only boards are excluded from default placement (`placementRows`
  filter in seed-board.js).
- Layout/sort order: the defaults layout screens; don't hand-edit sort in SQL.

## Checklist for EDITING an existing row
- **Renaming a label is a migration, not an edit.** The label is identity:
  style-default images, translation rows (keyed by `label_norm`), shop
  matching, and analytics all reference it. If a rename is truly needed,
  update the translation dictionary keys in all five files + DB rows, verify
  style-default lookups still resolve, and re-check translation coverage.
- Prompt changes → regenerate the style-default images (aac-prompt-author).
- Adding `matchTerms` or `pronunciation` → no client work; next sync picks it
  up (re-push sounds if pronunciation changed).
- Archiving (`archived: true`) removes it from coverage reports and placement;
  it does not delete children's existing tiles.

## Adding a whole NEW LANGUAGE
1. New dictionary `api/_lib/i18n/<code>.json` mirroring an existing file's
   entry set ("t" field; section/category homonym overrides). Build it FROM
   es.json's entry list so coverage is identical, and assert no missing keys.
2. Add to `BOARD_LANGUAGES` (api/_lib/i18n.js) and `LANGUAGE_LABELS`
   (api/_lib/onboarding.js) — the server whitelist.
3. Add the option to BOTH tester-gated pickers: onboard.html `#in-lang`,
   parent.html `#lang-pick`; and the voices lab language select
   (admin/voices.html) if not present.
4. Non-Latin scripts: rendering already suppresses baked tile text for ALL
   non-English boards — no prompt work needed.
5. Language access stays gated to admin + `language_tester` role until
   validated by a native-speaker tester (grant via role_grants pre-add).
6. Seed the language in Lab → Translations; add at least one tagged voice for
   it in the voices lab; run the CSV export → native review → import loop.

## Verify before you're done
- `node --check api/_lib/word-match.js api/_lib/i18n.js` and
  `python3 -c "import json; json.load(open('api/_lib/i18n/<lang>.json'))"`
  for every dictionary you touched.
- Translation coverage clean for all five languages (step 4).
- `git status` shows the dictionary JSONs as tracked (gitignore trap above).
- If you touched anything beyond taxonomy rows (new endpoint, new surface),
  run the `surface-audit` skill — and extend it if you created a new surface;
  that skill's self-extension rule applies here too.
