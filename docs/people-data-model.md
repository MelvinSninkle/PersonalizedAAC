# People data model — design spec (name vs. relationship)

Status: **proposed, for review** (no code changes yet).
Goal: let features ask for *"the child's mother"* and get her **name, photo, pronoun,
and relationship** directly — instead of parsing a label string like "Papa Gary".

---

## 1. How people work today (ground truth)

A person is just a **board tile** plus a **reference photo + voice**:

| Where | What's stored |
|---|---|
| `items` (the board tile) | `label` (e.g. "Papa Gary"), `image_url`, `category_id`, `section='people'` |
| `onboard-subject.js` (capture) | a photo, a free-text `name`, optional `pronunciation`, and `role = child \| parent` |
| taxonomy library "Family" | generic skeletons only: "Mom", "Dad", "Brother", "Grandma"… |

**There is no relationship data.** Implications:
- "Papa Gary" is opaque text — nothing says *grandfather*, or which *side*.
- `role` only distinguishes the child from a grown-up. It is **not** a relationship.
- The `relation` column that exists (`child_access.relation`) is **account access**
  (parent/therapist/school_team) — unrelated to board people. Do not reuse it.
- `generate-descriptions.js` already *wants* this data — it tries to write
  "your grandma on your mom's side" but is guessing, because the structure isn't there.

## 2. Proposed model

A real person is an **identity**, not a tile. One person (Mama) can power several
tiles/slides and owns one photo + voice. So introduce a per-child `persons` table as
the source of truth; people-tiles point at it.

```sql
CREATE TABLE persons (
  id            BIGSERIAL PRIMARY KEY,
  child_id      TEXT NOT NULL,            -- whose board
  display_name  TEXT NOT NULL,            -- shown + spoken on the tile  ("Papa Gary", "Mama")
  given_name    TEXT,                     -- the real first name         ("Gary", "Sarah")
  relationship  TEXT NOT NULL,            -- enum, see below
  side          TEXT,                     -- 'maternal' | 'paternal' | NULL
  pronoun       TEXT,                     -- 'she' | 'he' | 'they'
  is_self       BOOLEAN NOT NULL DEFAULT FALSE,
  reference_key TEXT,                     -- stylized subject-anchor photo (already created at onboarding)
  voice_key     TEXT,                     -- TTS clip (already created at onboarding)
  pronunciation TEXT,                     -- "say it as…" (phonetic; existing concept)
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE items ADD COLUMN person_id BIGINT REFERENCES persons(id);  -- people tiles only
```

**`relationship` enum (flat) + `side` to disambiguate** (avoids a combinatorial blow-up
like "maternal_grandmother"):

```
self, mother, father, sister, brother, grandmother, grandfather,
aunt, uncle, cousin, stepparent, family_friend, caregiver, pet,
teacher, therapist, doctor, other
```
"Grandma on mom's side" = `relationship=grandmother, side=maternal`.

### Why two name fields
- **`display_name`** — the AAC-facing text the device shows and speaks ("Mama").
- **`given_name`** — the real name behind it ("Sarah"). Powers *"call her by name"*
  and disambiguates relationship-words. Optional, but recommended for adults.

### `pronoun` vs `pronunciation`
- `pronoun` = grammatical (she/he/they) → "add **her** photo", "call **her**".
- `pronunciation` = phonetic ("say it as…") → already captured today; keep it.

## 3. How features consume it

| Feature | Query / use |
|---|---|
| "Add the child's mom to a slideshow, call her by name" | `SELECT … FROM persons WHERE child_id=$1 AND relationship='mother'` → `given_name`, `pronoun`, `reference_key` |
| Description generation | pass `relationship` + `side` → deterministic "grandma on your mom's side" |
| Tile / slide image gen | `reference_key` anchors the person's look (centralized, not re-derived) |
| Pronoun-aware sentence building | `pronoun` |

## 4. Capture + UI changes (build phase)

- **Onboarding Step 1 "The people"** (`onboard.html`, `onboard-subject.js`): add a
  **relationship dropdown** (+ conditional **side**), **given name**, **pronoun**.
  Replace coarse `role=child|parent` with `relationship` (the child is `is_self=true`).
  Keep photo + pronunciation as-is.
- **A people-management screen** (in `parent.html`) to add/edit family after onboarding.

## 5. Migration of existing people

For each `section='people'` item per child, create a `persons` row, `display_name = label`,
and carry over the existing reference/voice keys. **Best-effort** infer `relationship`
from label/category ("Mama"→mother, "Dada"→father, "Papa X"→grandfather,
"Grandma/Nana X"→grandmother, siblings→brother/sister) and **flag inferred rows for
parent confirmation** rather than trusting the guess. Fletcher's 6 (Dada, Mama, Sawyer,
Fletcher, Papa Gary, Grandma Jane) can be pre-mapped and confirmed.

## 6. Open questions to settle before building

1. **Storage** — dedicated `persons` table (recommended) vs. just adding columns to `items`.
2. **Enum granularity** — keep the tight set above, or add step-/half-/in-law/pets/pros?
3. **Track `side`** (maternal/paternal)? (recommended: yes — needed for "mom's side".)
4. **Keep both `given_name` and `display_name`?** (recommended: yes.)
5. **Replace onboarding's `role=child|parent`** with the relationship dropdown? (recommended: yes.)
6. **People stay personal** (per `child_id`); the library keeps only generic "Mom/Dad"
   skeletons. Confirm real identities live only in `persons`, never the canonical library.
