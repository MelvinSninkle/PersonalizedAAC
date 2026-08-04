// Emergency Beacon — the lost-child mode. A parent activates it remotely;
// the board then intermittently speaks a caretaker broadcast in the board's
// voice and flashes a screen of the child's family photos and an emergency
// phone number, adapting its announcement frequency to the device's battery.
//
// THIS FEATURE IS NEVER PAYWALLED. No entitlement check may ever guard any
// beacon path (enforced by the surface-audit invariants), and clip synthesis
// bypasses nothing security-wise but is never budget-gated: a lapsed
// subscription must not silence a lost child's beacon.
//
// Everything the beacon needs at emergency time is prepared at SETUP time:
// the spoken clips are synthesized when the parent saves the emergency
// number and cached on the device, because the device that needs them may
// have no network when it is lost. Activation is the only step that needs
// connectivity.
import { synthesizeVoice, loadChildVoiceId } from './onboarding-render.js';

// The broadcast script, per board language. The family's own language always
// LEADS the announcement cycle; the parent chooses additional community
// languages at setup (English is on by default for non-English boards).
// Non-English scripts are machine-authored pending native-speaker review —
// reviewable in one place here, deliberately NOT in label_translations (the
// beacon must not depend on a dictionary row someone can edit or delete).
export const BEACON_SCRIPTS = {
  en: {
    message: 'Please pay attention. The person holding this device is a vulnerable person and cannot be located by their caretaker. This message is being broadcast by their caretaker. Please take them into your care and contact authorities.',
    call: 'Please call this number to reach my family:',
    titleFamily: 'This is My Family',
    titlePhone: 'This is a Phone Number to Call my Family',
  },
  zh: {
    message: '请注意。持有此设备的人是需要特殊照顾的人，他的监护人现在找不到他。此信息由他的监护人播放。请照顾他，并联系警方。',
    call: '请拨打这个号码联系我的家人：',
    titleFamily: '这是我的家人',
    titlePhone: '请拨打这个电话联系我的家人',
  },
  es: {
    message: 'Atención, por favor. La persona que lleva este dispositivo es una persona vulnerable y su cuidador no puede localizarla. Este mensaje lo emite su cuidador. Por favor, cuide de ella y avise a las autoridades.',
    call: 'Por favor, llame a este número para contactar a mi familia:',
    titleFamily: 'Esta es mi familia',
    titlePhone: 'Este es un número para llamar a mi familia',
  },
  fr: {
    message: "Votre attention s'il vous plaît. La personne qui porte cet appareil est une personne vulnérable et son accompagnant ne parvient pas à la localiser. Ce message est diffusé par son accompagnant. Veuillez la prendre en charge et contacter les autorités.",
    call: 'Veuillez appeler ce numéro pour joindre ma famille :',
    titleFamily: 'Voici ma famille',
    titlePhone: 'Voici un numéro pour appeler ma famille',
  },
  pt: {
    message: 'Atenção, por favor. A pessoa que carrega este aparelho é uma pessoa vulnerável e seu cuidador não consegue localizá-la. Esta mensagem está sendo transmitida pelo seu cuidador. Por favor, cuide dela e contate as autoridades.',
    call: 'Por favor, ligue para este número para falar com minha família:',
    titleFamily: 'Esta é minha família',
    titlePhone: 'Este é um número para ligar para minha família',
  },
  de: {
    message: 'Bitte um Aufmerksamkeit. Die Person mit diesem Gerät ist eine schutzbedürftige Person und kann von ihrer Betreuungsperson nicht gefunden werden. Diese Nachricht wird von ihrer Betreuungsperson gesendet. Bitte kümmern Sie sich um sie und verständigen Sie die Behörden.',
    call: 'Bitte rufen Sie diese Nummer an, um meine Familie zu erreichen:',
    titleFamily: 'Das ist meine Familie',
    titlePhone: 'Unter dieser Nummer erreichen Sie meine Familie',
  },
};

export const BEACON_LANGS = Object.keys(BEACON_SCRIPTS);

export async function ensureBeacon(db) {
  await db`
    CREATE TABLE IF NOT EXISTS beacon_state (
      child_id     TEXT PRIMARY KEY,
      phone        TEXT,
      langs        JSONB,
      active       BOOLEAN NOT NULL DEFAULT FALSE,
      activated_at TIMESTAMPTZ,
      activated_by TEXT,
      battery      INT,
      charging     BOOLEAN,
      lat          DOUBLE PRECISION,
      lng          DOUBLE PRECISION,
      accuracy     DOUBLE PRECISION,
      last_seen    TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  // Safe zones (geofencing): the fence check runs ON the device from GPS, so
  // a device with no network can still light its own beacon on zone exit —
  // this closes the "activation can't reach an offline device" gap.
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS zones JSONB`;
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS armed BOOLEAN NOT NULL DEFAULT FALSE`;
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS alert_minutes INT NOT NULL DEFAULT 10`;
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS staged_at TIMESTAMPTZ`;
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS staged_zone TEXT`;
  await db`ALTER TABLE beacon_state ADD COLUMN IF NOT EXISTS zone_state TEXT`;
  // Per-child pre-rendered clips. A table (not just settings JSON) because
  // /api/media's ownership union must know these child-scoped blob keys
  // belong to this child (audit A2 — a key in no table is served as a shared
  // library asset, and a beacon clip contains the family's phone number).
  await db`
    CREATE TABLE IF NOT EXISTS beacon_clips (
      child_id  TEXT NOT NULL,
      lang      TEXT NOT NULL,
      kind      TEXT NOT NULL,           -- 'message' | 'phone'
      sound_key TEXT NOT NULL,
      text      TEXT NOT NULL,
      built_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (child_id, lang, kind)
    )`;
}

/// The phone number as spoken text: digit by digit, with pauses.
export function spokenPhone(phone) {
  return String(phone || '').replace(/\D/g, '').split('').join(', ');
}

/// Synthesize (or refresh) the beacon clips for a child in their board voice.
/// Idempotent per (text, voice): unchanged texts re-use the shared TTS cache
/// for free. Returns { built, failed }.
export async function buildBeaconClips(db, childId, { phone, langs }) {
  const { put } = await import('@vercel/blob');
  const { createHash } = await import('node:crypto');
  const voiceId = await loadChildVoiceId(db, childId);
  let built = 0, failed = 0;
  for (const lang of langs) {
    const s = BEACON_SCRIPTS[lang];
    if (!s) continue;
    const texts = [
      { kind: 'message', text: s.message },
      { kind: 'phone', text: `${s.call} ${spokenPhone(phone)}` },
    ];
    for (const t of texts) {
      const cur = (await db`SELECT text, sound_key FROM beacon_clips
                            WHERE child_id = ${childId} AND lang = ${lang} AND kind = ${t.kind}`)[0];
      if (cur && cur.text === t.text) continue;   // already current
      const mp3 = await synthesizeVoice({ text: t.text, voiceId, db, childId, kind: 'beacon' });
      if (!mp3) { failed++; continue; }
      const stamp = createHash('sha256').update(t.text).digest('hex').slice(0, 12);
      const key = `onboarding/${childId}/beacon/${lang}-${t.kind}-${stamp}.mp3`;
      await put(key, mp3, { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false });
      await db`INSERT INTO beacon_clips (child_id, lang, kind, sound_key, text)
               VALUES (${childId}, ${lang}, ${t.kind}, ${key}, ${t.text})
               ON CONFLICT (child_id, lang, kind)
               DO UPDATE SET sound_key = ${key}, text = ${t.text}, built_at = NOW()`;
      built++;
    }
  }
  return { built, failed };
}

/// The beacon payload a board needs, or null when unconfigured. Attached to
/// /api/sync so the device caches clips + config long before any emergency.
export async function beaconFor(db, childId) {
  try {
    await ensureBeacon(db);
    const st = (await db`SELECT phone, langs, active, activated_at, zones, armed, alert_minutes
                         FROM beacon_state WHERE child_id = ${childId}`)[0];
    if (!st || !st.phone) return null;
    const clips = await db`SELECT lang, kind, sound_key FROM beacon_clips WHERE child_id = ${childId}`;
    const langs = Array.isArray(st.langs) ? st.langs : ['en'];
    const titles = {};
    for (const l of langs) {
      if (BEACON_SCRIPTS[l]) titles[l] = { family: BEACON_SCRIPTS[l].titleFamily, phone: BEACON_SCRIPTS[l].titlePhone };
    }
    return {
      active: !!st.active,
      activatedAt: st.activated_at || null,
      phone: st.phone,
      langs, titles,
      zones: Array.isArray(st.zones) ? st.zones : [],
      armed: !!st.armed,
      alertMinutes: Number.isFinite(Number(st.alert_minutes)) ? Number(st.alert_minutes) : 10,
      clips: clips.map((c) => ({ lang: c.lang, kind: c.kind, key: c.sound_key })),
    };
  } catch (_) { return null; }
}
