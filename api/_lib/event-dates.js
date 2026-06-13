// Calendar resolver for the special-day event tiles. Returns the EVENT KEYS
// (e.g. 'christmas', 'birthday', 'easter') that match a given date, given a
// child's birth date. Fixed-date holidays are a lookup; floating ones are
// computed; 'birthday' fires on the MM-DD of the child's birth_date.
//
// Conservative US calendar by default (the user listed US holidays). New
// events can be added by either (a) extending FIXED if the date is fixed,
// (b) extending FLOATING with a resolver function, or (c) adding logic for
// per-child events (like birthday). Each event_key in here must also exist
// as an is_event taxonomy row for the runtime to render it.

// MM-DD → key.
const FIXED = {
  '01-01': 'new_years_day',
  '02-14': 'valentines_day',
  '03-17': 'st_patricks_day',
  '04-01': 'april_fools',
  '07-04': 'independence_day',
  '10-31': 'halloween',
  '12-24': 'christmas_eve',
  '12-25': 'christmas',
  '12-31': 'new_years_eve',
};

// Easter Sunday (Meeus/Anonymous algorithm). Returns Date in local time.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
// Nth `weekday` (0=Sun … 6=Sat) of `month` (1-12) in `year`.
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + 7 * (n - 1));
}
// Last `weekday` of month.
function lastWeekday(year, month, weekday) {
  const last = new Date(year, month, 0);              // day 0 of next month = last day
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month - 1, last.getDate() - offset);
}
const sameMd = (d, m, day) => d.getMonth() + 1 === m && d.getDate() === day;

// floating[key](year) → Date for that year's instance
const FLOATING = {
  easter:           y => easterSunday(y),
  mothers_day:      y => nthWeekday(y, 5, 0, 2),      // 2nd Sunday of May
  fathers_day:      y => nthWeekday(y, 6, 0, 3),      // 3rd Sunday of June
  memorial_day:     y => lastWeekday(y, 5, 1),         // last Monday of May
  thanksgiving:     y => nthWeekday(y, 11, 4, 4),      // 4th Thursday of November
};

// All known event keys (drives admin filters and the taxonomy seed).
export const EVENT_KEYS = [
  ...Object.values(FIXED),
  ...Object.keys(FLOATING),
  'birthday',
];

// Which event keys fire on this date, for this child? Returns [{key, label}]
// — empty when nothing's happening today. `birthDate` may be null (then
// 'birthday' simply never matches).
export function eventsOnDate(date, birthDate = null) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const out = [];
  if (FIXED[`${mm}-${dd}`]) out.push(FIXED[`${mm}-${dd}`]);
  for (const [key, fn] of Object.entries(FLOATING)) {
    const inst = fn(d.getFullYear());
    if (sameMd(d, inst.getMonth() + 1, inst.getDate())) out.push(key);
  }
  if (birthDate) {
    const b = new Date(birthDate);
    if (!isNaN(b) && b.getMonth() === d.getMonth() && b.getDate() === d.getDate()) out.push('birthday');
  }
  return out;
}

// For event_key + year, return the YYYY-MM-DD it falls on (used for caching
// generated images by year so each Christmas gets its own picture).
export function eventDateFor(eventKey, year, birthDate = null) {
  const fixedKey = Object.keys(FIXED).find(k => FIXED[k] === eventKey);
  if (fixedKey) return `${year}-${fixedKey}`;
  if (FLOATING[eventKey]) {
    const d = FLOATING[eventKey](year);
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (eventKey === 'birthday' && birthDate) {
    const b = new Date(birthDate);
    if (!isNaN(b)) return `${year}-${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}`;
  }
  return null;
}
