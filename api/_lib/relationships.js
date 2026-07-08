// Canonical family-relationship taxonomy for the People model.
// See docs/people-data-model.md. Single source of truth, shared by the
// /api/relationships picker endpoint, onboarding capture, and server-side
// validation. Ordered high-use first so a picker surfaces the common ones up top.
//
// Each entry: value (stored on persons.relationship) + label (UI) + flags:
//   side    → ask maternal/paternal (e.g. which grandma)
//   sibling → uses birth_order; multiples display as "Brother 1", "Brother 2"…
//   self    → the child themselves (persons.is_self)
//   age     → 'adult' | 'child' when the relationship pins it down; ABSENT when
//             it can't (a sister can be 4 or 34). Portrait generation adapts
//             the art style by age (adult proportions vs the style's big-eyed
//             child treatment), so pickers show a kid/grown-up choice ONLY for
//             the ambiguous entries — everyone else gets it for free.
//   ageDefault → the picker's pre-selection for ambiguous entries (siblings
//             and cousins of a young AAC child are usually kids themselves).
export const RELATIONSHIPS = [
  // High-use, pinned to the top of the picker.
  { value: 'mother',       label: 'Mother',       age: 'adult' },
  { value: 'father',       label: 'Father',       age: 'adult' },
  { value: 'sister',       label: 'Sister',       sibling: true, ageDefault: 'child' },
  { value: 'brother',      label: 'Brother',      sibling: true, ageDefault: 'child' },
  // Extended family.
  { value: 'grandmother',  label: 'Grandmother',  side: true, age: 'adult' },
  { value: 'grandfather',  label: 'Grandfather',  side: true, age: 'adult' },
  { value: 'aunt',         label: 'Aunt',         side: true, age: 'adult' },
  { value: 'uncle',        label: 'Uncle',        side: true, age: 'adult' },
  { value: 'cousin',       label: 'Cousin',       side: true, ageDefault: 'child' },
  { value: 'stepmother',   label: 'Stepmother',   age: 'adult' },
  { value: 'stepfather',   label: 'Stepfather',   age: 'adult' },
  { value: 'stepsister',   label: 'Stepsister',   sibling: true, ageDefault: 'child' },
  { value: 'stepbrother',  label: 'Stepbrother',  sibling: true, ageDefault: 'child' },
  { value: 'half_sister',  label: 'Half-sister',  sibling: true, ageDefault: 'child' },
  { value: 'half_brother', label: 'Half-brother', sibling: true, ageDefault: 'child' },
  { value: 'guardian',     label: 'Guardian',     age: 'adult' },
  { value: 'family_friend',label: 'Family friend', ageDefault: 'adult' },
  { value: 'caregiver',    label: 'Caregiver',    age: 'adult' },
  { value: 'pet',          label: 'Pet' },
  { value: 'other',        label: 'Other',        ageDefault: 'adult' },
  // Special: the child whose board this is.
  { value: 'self',         label: 'The child (self)', self: true, age: 'child' },
];

export const SIDES = ['maternal', 'paternal'];
export const PRONOUNS = ['she', 'he', 'they'];

const BY_VALUE = new Map(RELATIONSHIPS.map(r => [r.value, r]));
export function isValidRelationship(v)     { return BY_VALUE.has(String(v)); }
export function relationshipNeedsSide(v)   { return !!(BY_VALUE.get(String(v)) || {}).side; }
export function relationshipIsSibling(v)   { return !!(BY_VALUE.get(String(v)) || {}).sibling; }
// 'adult' | 'child' when the relationship alone settles it; null when a
// client-supplied kid/grown-up choice (or nothing) has to decide. Pets return
// null — the age treatment doesn't apply to them.
export function relationshipAgeGroup(v)    { return (BY_VALUE.get(String(v)) || {}).age || null; }
export function relationshipIsSelf(v)      { return !!(BY_VALUE.get(String(v)) || {}).self; }
export function relationshipLabel(v)       { return (BY_VALUE.get(String(v)) || {}).label || String(v); }

// Display label for a sibling when several share a relationship: "Brother",
// or "Brother 1" / "Brother 2"… when there is more than one. `rank` is 1-based
// by birth_order (oldest first); `total` is how many siblings of that kind exist.
export function siblingDisplay(value, rank, total) {
  const base = relationshipLabel(value);
  return (total && total > 1 && rank) ? `${base} ${rank}` : base;
}

// Plain, child-directed family phrase from a persons-style row. Used wherever we
// describe a person TO the child (teaching descriptions, learn-mode) so the wording
// is DRIVEN by the structured relationship/side instead of being guessed from a label.
//   { relationship:'grandmother', side:'maternal' }              → "your grandma on your mom's side"
//   { relationship:'brother' } + { siblingQualifier:'little' }   → "your little brother"
// Returns null when a relationship has no natural child-facing phrase (caller decides).
export function familyPhrase(p, opts = {}) {
  const rel = String((p && p.relationship) || '').toLowerCase();
  const side = (p && p.side === 'maternal') ? "your mom's side"
             : (p && p.side === 'paternal') ? "your dad's side" : null;
  const onSide = side ? ` on ${side}` : '';
  const q = opts.siblingQualifier ? `${opts.siblingQualifier} ` : '';
  switch (rel) {
    case 'self':         return 'you';
    case 'mother':       return 'your mom';
    case 'father':       return 'your dad';
    case 'stepmother':   return 'your stepmom';
    case 'stepfather':   return 'your stepdad';
    case 'sister':       return `your ${q}sister`;
    case 'brother':      return `your ${q}brother`;
    case 'stepsister':   return `your ${q}stepsister`;
    case 'stepbrother':  return `your ${q}stepbrother`;
    case 'half_sister':  return `your ${q}half-sister`;
    case 'half_brother': return `your ${q}half-brother`;
    case 'grandmother':  return `your grandma${onSide}`;
    case 'grandfather':  return `your grandpa${onSide}`;
    case 'aunt':         return `your aunt${onSide}`;
    case 'uncle':        return `your uncle${onSide}`;
    case 'cousin':       return `your cousin${onSide}`;
    case 'guardian':
    case 'caregiver':    return 'someone who takes care of you';
    case 'family_friend':return 'a friend of your family';
    case 'pet':          return 'your pet';
    default:             return null;
  }
}
