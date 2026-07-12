// Board content translations — a DISPLAY + AUDIO layer over the canonical
// English taxonomy, never a rewrite of it. English labels stay the identity
// everywhere (style-default lookups, Word Shop matching, publish tools,
// analytics); a child whose settings.language isn't 'en' gets:
//   · displayLabel on sync'd items/categories (clients render it, data keeps
//     the English label underneath)
//   · seeded voice clips synthesized from the translated text
//
// The dictionary is keyed by ENGLISH label (case-insensitive), with optional
// section (board column) and category narrowing for homonyms — "orange" the
// color vs the fruit, "watch" the verb vs the noun. Lookup precedence:
// section+category → section → category → bare label.
//
// label_translations is the runtime store (admin-editable via the Lab, CSV
// round-trip for native-speaker review). api/_lib/i18n/<lang>.json is the
// bundled seed a Lab click imports.
import { readFileSync } from 'node:fs';

export const BOARD_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文（简体）· Simplified Chinese' },
  { code: 'es', label: 'Español · Spanish' },
  { code: 'fr', label: 'Français · French' },
  { code: 'pt', label: 'Português (Brasil) · Portuguese' },
  { code: 'de', label: 'Deutsch · German' },
];

const norm = (s) => String(s || '').trim().toLowerCase();

export async function ensureTranslations(db) {
  await db`
    CREATE TABLE IF NOT EXISTS label_translations (
      lang          TEXT NOT NULL,
      section       TEXT NOT NULL DEFAULT '',
      category_norm TEXT NOT NULL DEFAULT '',
      label_norm    TEXT NOT NULL,
      label         TEXT NOT NULL,
      pronunciation TEXT,
      status        TEXT NOT NULL DEFAULT 'machine',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lang, section, category_norm, label_norm)
    )`;
}

// The bundled seed dictionary for a language ('' when none is shipped).
export function bundledDictionary(lang) {
  try {
    const raw = readFileSync(new URL(`./i18n/${lang}.json`, import.meta.url), 'utf8');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

/// Map keyed `${section}|${category}|${label}` (all normed, '' = wildcard).
export async function loadTranslationMap(db, lang) {
  if (!lang || lang === 'en') return null;
  try {
    const rows = await db`
      SELECT section, category_norm, label_norm, label, pronunciation
      FROM label_translations WHERE lang = ${lang}`;
    if (!rows.length) return null;
    const map = new Map();
    for (const r of rows) {
      map.set(`${r.section}|${r.category_norm}|${r.label_norm}`,
              { label: r.label, pronunciation: r.pronunciation || null });
    }
    return map;
  } catch (_) { return null; }
}

/// Resolve one label. Returns { label, pronunciation } or null.
export function translate(map, { label, section = '', category = '' } = {}) {
  if (!map || !label) return null;
  const l = norm(label), s = norm(section), c = norm(category);
  return map.get(`${s}|${c}|${l}`)
      || map.get(`${s}||${l}`)
      || map.get(`|${c}|${l}`)
      || map.get(`||${l}`)
      || null;
}

/// The child's board language ('en' default).
export async function childLanguage(db, childId) {
  try {
    const row = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const l = row && row.settings && row.settings.language;
    return (typeof l === 'string' && l) ? l : 'en';
  } catch (_) { return 'en'; }
}
