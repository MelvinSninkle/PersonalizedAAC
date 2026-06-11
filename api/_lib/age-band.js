// One source of truth for the developmental band from a birth date.
// Bands mirror taxonomy.acquisition_age values; ordering is what lets a board
// filter say "show me everything ≤ this child's current band."
export const AGE_BANDS = ['12-18m', '18-30m', '2-3y', '3-4y', '4y+'];
const BAND_RANK = Object.fromEntries(AGE_BANDS.map((b, i) => [b, i]));

// Months between two dates, integer floor. Treats "today" as the second arg.
function monthsBetween(birth, now) {
  const b = new Date(birth), n = new Date(now);
  if (isNaN(b)) return null;
  let m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) m -= 1;
  return m;
}

// Earliest band a child should be shown given their birth date. Errs younger
// (a 13-month-old gets '12-18m', not '18-30m'). Children below 12 months stay
// at '12-18m' (the floor); anyone older than 60 months gets '4y+'.
export function bandForBirthDate(birthDate, now = new Date()) {
  const months = monthsBetween(birthDate, now);
  if (months == null) return null;
  if (months < 18) return '12-18m';
  if (months < 30) return '18-30m';
  if (months < 36) return '2-3y';
  if (months < 48) return '3-4y';
  return '4y+';
}

// Is `tileBand` at-or-below `childBand`? Tiles with no band (Personalize
// placeholders, custom additions) always pass — the parent put them there.
export function tileFitsAge(tileBand, childBand) {
  if (!tileBand) return true;
  if (!childBand) return true;
  return (BAND_RANK[tileBand] ?? 99) <= (BAND_RANK[childBand] ?? -1);
}
