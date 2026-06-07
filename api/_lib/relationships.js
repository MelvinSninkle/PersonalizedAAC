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
