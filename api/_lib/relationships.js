// Canonical family-relationship taxonomy for the People model.
// See docs/people-data-model.md. Single source of truth, shared by the
// /api/relationships picker endpoint, onboarding capture, and server-side
// validation. Ordered high-use first so a picker surfaces the common ones up top.
//
// Each entry: value (stored on persons.relationship) + label (UI) + flags:
//   side    → ask maternal/paternal (e.g. which grandma)
//   sibling → uses birth_order; multiples display as "Brother 1", "Brother 2"…
//   self    → the child themselves (persons.is_self)
export const RELATIONSHIPS = [
  // High-use, pinned to the top of the picker.
  { value: 'mother',       label: 'Mother' },
  { value: 'father',       label: 'Father' },
  { value: 'sister',       label: 'Sister',       sibling: true },
  { value: 'brother',      label: 'Brother',      sibling: true },
  // Extended family.
  { value: 'grandmother',  label: 'Grandmother',  side: true },
  { value: 'grandfather',  label: 'Grandfather',  side: true },
  { value: 'aunt',         label: 'Aunt',         side: true },
  { value: 'uncle',        label: 'Uncle',        side: true },
  { value: 'cousin',       label: 'Cousin',       side: true },
  { value: 'stepmother',   label: 'Stepmother' },
  { value: 'stepfather',   label: 'Stepfather' },
  { value: 'stepsister',   label: 'Stepsister',   sibling: true },
  { value: 'stepbrother',  label: 'Stepbrother',  sibling: true },
  { value: 'half_sister',  label: 'Half-sister',  sibling: true },
  { value: 'half_brother', label: 'Half-brother', sibling: true },
  { value: 'guardian',     label: 'Guardian' },
  { value: 'family_friend',label: 'Family friend' },
  { value: 'caregiver',    label: 'Caregiver' },
  { value: 'pet',          label: 'Pet' },
  { value: 'other',        label: 'Other' },
  // Special: the child whose board this is.
  { value: 'self',         label: 'The child (self)', self: true },
];

export const SIDES = ['maternal', 'paternal'];
export const PRONOUNS = ['she', 'he', 'they'];

const BY_VALUE = new Map(RELATIONSHIPS.map(r => [r.value, r]));
export function isValidRelationship(v)     { return BY_VALUE.has(String(v)); }
export function relationshipNeedsSide(v)   { return !!(BY_VALUE.get(String(v)) || {}).side; }
export function relationshipIsSibling(v)   { return !!(BY_VALUE.get(String(v)) || {}).sibling; }
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
