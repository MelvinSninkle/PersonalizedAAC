# Add-image quality audit — why the Lab wins, and the alignment plan

## The four pipelines (there are four, not three)

| # | Surface | Endpoint → renderer | Prompt source |
|---|---------|--------------------|---------------|
| 1 | **Taxonomy Lab** (fantastic) | `lab?action=generate` → `_lab-generate.js` | Hand-curated per-word `prompt_template`, wrapped in the tunable `lab_settings.master_prompt`, + style-guide image **and** style *description text*, + per-row/route model resolution, + a human picking the best of N |
| 2 | **Seed / store / retries** (good) | `seed_jobs` → `renderTaxonomyTile` | Same as the Lab: master prompt + template + style desc + child anchor |
| 3 | **Parent app & board adds** (lackluster) | `tile_jobs` → `renderStyledPhoto` | ONE hardcoded sentence: *"Re-illustrate this photograph as a {style} of {subject}…"* + style image + the photo |
| 4 | **Web board add modal** (lackluster, drifted) | `/api/generate-image` | A THIRD hardcoded prompt — similar to #3 but separately evolved (its own ref clause + copyright-fallback machinery) |

## How they're the same
Square rule, caption band, no-face guard, style-guide image attachment, nano-banana
default for objects, keystone tier for people (fixed earlier). The chrome matches.

## How they're different — the five real quality gaps

1. **The photo is the canvas, not a fact sheet.** "Re-illustrate this photograph"
   tells the model to preserve the photo's *composition* — the cluttered counter, the
   off-axis angle, the dim kitchen light, the half-cropped subject. Lab prompts
   describe an idealized scene (centered, clean, in-context, well-lit) and the model
   paints that. No style transfer can rescue a bad composition it was ordered to keep.
2. **The curated prompt language never touches photo adds.** All the prompt-author
   discipline (grounded in-context scenes, concrete physical framing, no
   anthropomorphizing) lives in `prompt_template`s — paths 3 & 4 never see any of it.
3. **Master-prompt tuning doesn't propagate.** Every improvement made to
   `lab_settings.master_prompt` upgrades paths 1 & 2 instantly; paths 3 & 4 run frozen
   hardcoded strings. They've been drifting apart for months.
4. **Style arrives as pixels only.** The Lab sends the style image AND its text
   description ("flat cel shading, thick linework…"); `renderStyledPhoto` sends only
   the image with a generic "match this style" clause. Words + pixels beat pixels.
5. **One-shot vs. survivorship.** Lab quality is partly selection: you generate N,
   star the best. Parents ship take #1. (Guided retry now helps, but the first take
   should be Lab-grade.)

Also: no `model_routes` resolution on photo adds, and path 4 duplicates path 3 badly.

## The alignment plan — "describe → compose → render"

Make a photo add BE a Lab generation whose content description is written by a vision
model instead of by hand:

**Stage 1 — Describe (new, ~1¢).** gpt-4o-mini looks at the photo + the parent's
name/hint and writes a Lab-grade content description in the prompt-template voice:
the subject's faithful specifics (exact colors, shape, materials, distinctive
features — "a sky-blue sippy cup with two curved handles and a white spout lid"),
an idealized in-context composition, no brands, no clutter. This replaces
"re-illustrate this photograph" as the creative instruction.

**Stage 2 — Compose (shared).** Run that content through the SAME wrapper the Lab
uses: `lab_settings.master_prompt` with `{content}/{label}/{style_description}/
{no_face_rule}`. Factor one `composeTilePrompt()` shared by `_lab-generate`,
`renderTaxonomyTile`, and the photo path — from then on, master-prompt tuning
upgrades every surface at once.

**Stage 3 — Render (photo demoted to reference).** Attach images in Lab order:
style guide first, then the photo with the legend *"Image N shows the real {label} —
match its exact colors, shape, and distinctive details, but compose the scene as
described above."* The photo stops dictating composition and starts guaranteeing
identity. People keep the keystone-portrait branch unchanged.

**Plus three force multipliers**
- **Taxonomy shortcut:** when the label matches a taxonomy row (parent photographs a
  "cup"), skip Stage 1 and use the curated `prompt_template` with the photo as the
  identity reference — this is exactly the proven regen-with mechanism.
- **Kill path 4:** point `/api/generate-image` at the upgraded shared renderer so the
  web modal and the app produce identical results.
- **Bench first:** add a "two-stage" toggle to the Add-Tile Lab so the new pipeline
  can be A/B'd against the current one on real photos before parents feel it.

**Cost:** +1 vision call (~$0.001–0.01) per add; image-generation cost unchanged; no
schema changes (tile_jobs already stores everything needed).
