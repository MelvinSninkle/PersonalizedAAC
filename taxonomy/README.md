# Taxonomy — the canonical word/tile library

The **taxonomy** is the global, admin-curated template that sits *above* any one
child's board. It's the invariant "language map": every child gets the same
skeleton (same slugs, same category → subcategory structure), and only the
**media is personalized** and (later) the **labels/phonetics localized**. Per‑child
boards (`categories` + `items`) are *instances* of this template.

Edited at **`/admin/taxonomy`** (admin role only). Stored in the `taxonomy` table;
every import / bulk op auto-snapshots, and there's a full audit log.

## Row fields

| field | meaning |
|---|---|
| `id` | stable slug, dot-separated lowercase: `nouns.food.drinks.milk`. **Never reused** — it's the cross-child / cross-language anchor. |
| `column` | board section: `People` / `Nouns` / `Verbs` / `Needs`. |
| `category`, `subcategory` | nesting (free text; the same text groups tiles on the board). |
| `label` | the canonical word shown on the tile. |
| `pronunciation` | TTS override (how the voice should say it, e.g. `Cheery-ohs`). |
| `subject_mode` | `child_as_subject` (the child) · `person` (a real person) · `object` (a thing) · `concept` (abstract word). |
| `parent_photo_behavior` | how an uploaded photo is used: `override` (the subject *is* the photo) · `supplement` (photo steers style) · `none`. |
| `prompt_template` | the image-generation prompt. Tokens: `{style}`, `{color}`, `{reference}` (child photo), `{parent_photo}`. |
| `phase` | rollout grouping: `v1_core` / `v1_extended` / `v2` / `later`. |
| **`core`** | **`true`** = part of the Level‑0 starter board a brand-new child begins with; **`false`** = grows in later. A whole category/subcategory is "non-core" when its tiles are — flip a group at once via the toolbar filter + **Bulk action → Mark non-core**. |
| `status` | `draft` (invisible to generation) / `published`. |
| `notes` | admin/SLP guidance (also where we currently park scene hints like "Scene: pantry"). |

## Loading the draft

1. Open `/admin/taxonomy` (you need the admin token — log into the main app first).
2. **Import…** → upload `seed-core-v1.csv` (or paste it). Leave new rows as `draft`.
3. Review prompts/levels with the SLP, set `core` where appropriate, then **Publish**.

## "Bring in the current one"

**Import live board…** pulls a child's existing `categories`/`items` (default
`fletcherpeterson`) into the taxonomy as `draft` rows with derived slugs + default
prompts. Snapshot-first, only inserts new ids. Use it to seed from Fletcher's real
board, then reconcile against the canonical seed above.

## What this draft deliberately leaves for later (designed-for, not built)

- **Scene tags** for the "snap your pantry → auto-fill" flow. Today the target
  scene is parked in `notes` (`Scene: pantry`); it'll graduate to a real
  `scene_tags` column + a scenes table.
- **Competency levels** — `phase` + `core` are the coarse stand-in until the
  leveling model is decided; per-concept mastery (from `game_attempts`) will drive
  auto-unlock.
- **Standard-asset caching** — generate each `subject_mode = object/concept`,
  `parent_photo_behavior = none` tile once per art-style and reuse across all
  children (the pre-baked standard library).
- **Shareable boards** — because instances reference taxonomy slugs, a board can
  later be exported/shared as "a set of slugs + any custom additions."
