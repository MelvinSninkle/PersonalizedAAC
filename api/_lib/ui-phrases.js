// The child-facing PROSE the product speaks and shows beyond the tiles
// themselves — quiz questions, slideshow frames, scheduler nudges. Tile words
// come from label_translations via the taxonomy dictionary; these frames are
// the other half of "the board speaks the child's language".
//
// Storage: the SAME label_translations table, under the reserved section
// 'ui' — one row per phrase, keyed by the normalized ENGLISH phrase text
// (self-documenting in the workbench and in CSV exports: the translator sees
// the actual sentence, writes their language's version, and keeps the {word}
// placeholder where the tile word gets substituted). Reusing the table means
// the whole existing loop — workbench editing, CSV export → native review →
// import, reviewed-protection — works on phrases with no new machinery.
//
// Delivery: /api/sync attaches `uiPhrases: { key: translatedText }` for
// non-English boards (missing keys = untranslated → clients keep their
// English default, same graceful degradation displayLabel uses).
//
// Adding a phrase here makes it appear in the Translations coverage report
// and the gaps CSV for every language automatically. Keep {word} exactly —
// clients substitute the tile's displayLabel into it.
export const UI_PHRASES = [
  { key: 'slide_first_person', en: 'I can see a {word}',
    hint: 'Slideshow caption + speech when the parent chose first-person labels' },
  { key: 'quiz_who_what', en: 'Who or what is the {word}?',
    hint: 'Clue-quiz fallback question when a tile has no clues' },
  { key: 'sched_game', en: "Let's do a game!",
    hint: 'Scheduled game nudge, spoken, default when the parent typed no prompt' },
  { key: 'sched_question', en: 'A quick question.',
    hint: 'Scheduled question intro, spoken, default when the parent typed no prompt' },
  { key: 'sched_checkin', en: 'Time for a check-in.',
    hint: 'Scheduled check-in toast, spoken, default when the parent typed no prompt' },
];

const norm = (s) => String(s || '').trim().toLowerCase();

/// Translated phrases for a language, from an already-loaded translation map
/// (i18n.js loadTranslationMap): { key: text } for every phrase that HAS a
/// translation. Untranslated phrases are simply absent — the client keeps its
/// English default rather than speaking a half-translated board's mix twice.
export function uiPhrasesFrom(trMap) {
  if (!trMap) return null;
  const out = {};
  for (const p of UI_PHRASES) {
    const hit = trMap.get(`ui||${norm(p.en)}`);
    if (hit && hit.label) out[p.key] = hit.label;
  }
  return Object.keys(out).length ? out : null;
}
