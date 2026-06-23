# Sample rewrites — evaluate the standard before the full run

Representative tiles across every rule category. "Before" is the current
generic/under-specified style; "After" is this skill's standard. Captions and
square framing are intentionally **not** in the prompt text (enforced in code).
`personalized` is `false` on all of these.

---

### nouns.home.fridge — "refrigerator" (object, in-context)
- **Before:** `A {style} of a refrigerator, a single clear subject centered…`
- **After:** `A {style} of a real kitchen refrigerator standing open, the door swung wide so the shelves are visible inside — a carton of eggs, a jug of milk, bright fruit and vegetables, a few jars on the door. Everyday home kitchen, not a showroom.`
- roles_present: `[]` · objects_present: `[refrigerator, eggs, milk, fruit, vegetables]` · has_relationship: false

### nouns.home.cup — "cup" (object, no face, in use)
- **Before:** `A {style} of a cute friendly cup…`  ← cute-ification risk
- **After:** `A {style} of a child's plastic cup with a little juice in it, sitting on a kitchen table. A plain everyday cup — absolutely no face, eyes, or smile on it.`
- roles_present: `[]` · objects_present: `[cup]` · has_relationship: false
- ⚠ flag: "cute/friendly" wording removed — it was causing anthropomorphic faces.

### nouns.school.lunch — "lunchbox" (object, in context)
- **After:** `A {style} of an open child's lunchbox on a table, showing the food inside — a sandwich cut in half, apple slices, a few crackers, a small drink. The real packed-lunch version, not an empty container.`
- objects_present: `[lunchbox, sandwich, apple, crackers]`

### verbs.actions.open — "open" (verb = concrete action; PAIR)
- **Before:** `A {style} of {reference} opening something…`
- **After:** `A {style} of {reference} lifting the lid straight off a glass jar with both hands, the lid raised above the jar. A clear UP arrow beside the lid showing the opening motion. Same kitchen-table setup as "close".`
- roles_present: `[child]` · objects_present: `[jar]` · has_relationship: **true** · related_images: `[verbs.actions.close]`

### verbs.actions.close — "close" (PAIR partner, shared setup)
- **After:** `A {style} of {reference} pressing the lid down onto the same glass jar with both hands, lid seated on top. A clear DOWN arrow beside the lid showing the closing motion. Same kitchen-table setup as "open".`
- roles_present: `[child]` · objects_present: `[jar]` · has_relationship: **true** · related_images: `[verbs.actions.open]`

### verbs.actions.eat — "eat" (verb, child + real object)
- **After:** `A {style} of {reference} taking a bite of a sandwich at the kitchen table, both hands holding it, mid-bite and clearly enjoying it.`
- roles_present: `[child]` · objects_present: `[sandwich]`

### verbs.social.share — "share" (verb, child + peer)
- **After:** `A {style} of {reference} handing one of two cookies across a small table to a peer (another child the same age), both reaching toward the same cookie.`
- roles_present: `[child, peer]` · objects_present: `[cookie]`
- → when a sibling is later added, this `peer` becomes a regeneration candidate.

### needs.describe.big — "big" (adjective; PAIR)
- **After:** `A {style} of {reference} holding a big beach ball that fills their arms, standing next to a tiny ball on the floor for scale. Same setup as "little"; here the BIG ball is the focus.`
- roles_present: `[child]` · objects_present: `[ball]` · has_relationship: **true** · related_images: `[needs.describe.little]`

### needs.describe.little — "little" (PAIR partner)
- **After:** `A {style} of {reference} holding a tiny ball pinched between two fingers, the big beach ball resting on the floor beside them for scale. Same setup as "big"; here the LITTLE ball is the focus.`
- roles_present: `[child]` · objects_present: `[ball]` · has_relationship: **true** · related_images: `[needs.describe.big]`

### people.family.me — "Me" (person portrait)
- **After:** `A {style} head-and-shoulders portrait based on {reference} — warm, natural, clearly recognizable as this child.`
- roles_present: `[child]` · objects_present: `[]`

### people.community.friend — "Friend" (peer, NOT the child)
- **After:** `A {style} head-and-shoulders portrait of a friendly peer — another child about the same age. A generic peer, not {reference}.`
- roles_present: `[peer]` · objects_present: `[]`
- ⚠ note: stays a generic peer; never collapses to `{reference}`.

### nouns.vehicles.bike — "bicycle" (object, child's own version)
- **After:** `A {style} of a child's bicycle with training wheels parked on a driveway, helmet hanging on the handlebars. The everyday kid's bike, not an adult road bike.`
- objects_present: `[bicycle, helmet]`

---

## What to check when evaluating
1. Is each object recognizable as **the thing in a real home**, in use?
2. Do verbs show **the child doing a concrete action on a real object**?
3. Do pairs share a setup + show the directional arrow + link via `related_images`?
4. Are `roles_present` / `objects_present` complete (so the reverse index + sibling
   cascade work)?
5. Any wording that could make a model add a **face to an object**?

If this standard looks right, the full run rewrites all ~1,200 the same way on
Sonnet, output as an importable CSV.
