---
name: aac-prompt-author
description: >-
  Rewrite and author image-generation prompts for the personalized AAC board
  (Fletcher's World). Use when editing or bulk-rewriting taxonomy prompt_template
  values, authoring prompts for new vocabulary, or populating the personalization
  metadata (roles_present, objects_present, has_relationship, related_images).
  Enforces grounded, in-context imagery; never anthropomorphizes objects; makes
  verbs concrete physical actions; keeps paired concepts consistent; and writes
  the prompt and its metadata together as one job.
---

# AAC Image-Prompt Author

## Why this skill exists (read first)
The whole product rests on one idea: **a child with communication support needs can
only point to a word if the picture matches the thing in their actual world.**
Fletcher is a gestalt language processor — he retrieves language in whole chunks
tied to real, concrete experience. A generic clip-art fridge is a *different
object* than the one in his kitchen. A smiley face on a cup makes the cup *not a
cup*. Optimize for **recognition and groundedness for a real child**, never for
aesthetics or brevity. Token input is cheap; a child not recognizing their own
world is the only expensive failure.

Two consequences:
1. **Consistency is a feature.** If "open"/"close" don't share a setup, the child
   re-learns the scene instead of reading the one thing that changed. Paired
   concepts must share a reference and generate as a dependent set.
2. **The board must be able to become *theirs*.** The default board is a starting
   point. Personalization (their spoon, their sibling) cascades only if every
   prompt is tagged with consistent roles/objects. **Write the prompt and the
   metadata as one job, never separately** — untagged prompts kill personalization.

## What this skill does (active, not passive)
When writing or revising a prompt:
- Apply the construction rules below.
- **Raise concerns and flag anything that looks off.**
- **Brainstorm scenarios with the user when a word is ambiguous** (e.g. "can" the
  modal verb vs "can" the container) instead of guessing.
- Emit the taxonomy metadata in every case.

## Construction rules

### Universal spec (every prompt)
- **Square 1:1, frame-filling.** The single subject is centered and fills almost
  the whole frame with minimal empty space. *(Enforced in code by `SQUARE_RULE` in
  `api/_lib/onboarding-render.js`; don't restate framing in each prompt — but write
  subjects that suit a tight square.)*
- **Caption: the label in black text on a solid white band at the bottom**, same on
  every tile. *(Enforced in code by `captionRule`; do NOT bake captions or "no
  text" clauses into prompt_template — two caption instructions are what made the
  lettering drift.)*
- Photographic / realistic style consistent with the child's single styled
  reference image (see Style strategy).
- **No anthropomorphic faces or expressions on inanimate objects, ever.**

### Nouns / objects
- Show the object **in use and in context**, not isolated on a plain background.
  - fridge → *open, food visible inside (eggs, fruit, vegetables, a milk jug)*
  - cup → *a child's cup on a kitchen table with a little juice in it*
- Prefer the **everyday in-the-home** version over a catalog/stock version.
- Spend the tokens on concrete, recognizable detail.

### Verbs
- Show **the child (`{reference}`) performing a concrete physical action on a real
  object** — not standing beside the word.
  - open → *{reference} lifting the lid off a jar*
  - eat → *{reference} taking a bite of a sandwich at the table*
- Choose one clear physical activity; embody it.

### Opposite / paired concepts (verbs AND adjectives)
For pairs like open/close, big/little, up/down, on/off:
- Use the **same reference setup** for both; change only the action/direction.
- Include a **directional arrow** for motion (open = up arrow, lid raised; close =
  down arrow, lid lowered).
- Set `has_relationship=true` and list the partner in `related_images` so they
  generate as a dependent set.

## Role vocabulary (closed, consistent across ALL prompts)
The child is always the **`{reference}` token** (the live token the generators
fill with the child's likeness — this is the canonical "child"/"user" anchor; do
not invent `child`/`user` strings). Other people use a **fixed** set in
`roles_present` so personalization can find them later:

`child` (≡ the `{reference}` subject) · `sibling` · `peer` (another child, e.g.
"play" → catch with a `peer`) · `caregiver` · `parent` · `adult`

> **OPEN DECISION (confirm with Andrew):** the exact closed role list above, and
> whether the metadata records the child as `child` while the prompt text uses
> `{reference}`. Default assumed: prompt text = `{reference}`, metadata role =
> `child`. Lock this before the full run — it drives the whole cascade.

## Metadata to emit (with every prompt)
| field | how to fill |
|---|---|
| `roles_present` | every role from the closed set that appears in the prompt |
| `objects_present` | the vocabulary objects in the prompt (for the reverse index) — e.g. "open the jar" → `jar` |
| `has_relationship` | true if part of a paired/related set |
| `related_images` | the taxonomy ids it must generate with (the pair/set) |
| `personalized` | leave `false` (a hard stop flipped only when a parent personalizes; never set it here) |

## Style & reference strategy
Feeding child photo + style image + style prompt into every generation gives **poor
consistency**. Instead:
1. Generate family members **once** from the style image to establish the look.
2. For everything else, use **only the single styled child photo** (`{reference}`)
   as the reference, with a **minimal** prompt. That one image is the de-facto
   stylesheet. Write prompts assuming this single-reference model — less is more.

## Generation ordering (the service handles it; skill only flags)
Related sets generate **alphabetically**; the earlier word's output becomes the
later word's reference (close→open, big→little). The skill's only job is correct
`has_relationship` + `related_images`. No dependency graph.

## Settled vs open
**Settled (already enforced in code / decided):**
- Square 1:1, frame-filling (`SQUARE_RULE`).
- Black-on-white caption band (`captionRule`) — never in prompt_template.
- Child embodiment via `{reference}`; no faces on objects.

**Open — confirm before the full 1,200 run:**
- The closed `roles_present` vocabulary + child-token convention (above).
- Exact output px (we generate 1:1 square; confirm the pixel target if it matters
  for the provider).

## How to run a rewrite
1. Operate per taxonomy row (id, label, column, category, current prompt_template).
2. Rewrite prompt_template to the rules; populate the metadata fields.
3. **Sample first:** rewrite ~20 representative rows (objects, verbs, a pair, a
   person tile, a no-face object) and have Andrew evaluate before the batch.
4. Run the full pass on **Sonnet**. The ~1,200 existing prompts are **rewritten**,
   not preserved — only the underlying words carry over. (Every overwrite is now
   captured in `taxonomy_prompt_versions`, so a bad batch is recoverable.)
5. Output as a CSV importable at `/admin/taxonomy` (the importer maps these columns
   and preserves metadata on update).
