// Child-safety DISPLAY filter for listening mode (invariant E8).
//
// When the board is listening, every word spoken near the device becomes
// visible text on a child's screen. Words on this list render as the pill
// "Bad Word" instead (parents can also hide ALL non-tile words via the
// listenTilesOnly setting). This list ships to every client through
// /api/sync (`listenBlocklist`) — the same doctrine as match terms: word
// intelligence lives HERE, never ported into a client, so an addition
// reaches every installed app on its next sync with no release.
//
// Matching contract (all three clients): the transcribed token is
// normalized first — lowercased, punctuation stripped ([.,!?;:"()[]{}]),
// digits 0-20 spelled out on native — then compared by EXACT token match
// against this list. So entries must be single lowercase tokens with no
// punctuation, and variants (plurals, -ing forms, compounds) need their
// own entry. Exact matching means no substring false positives (a word
// like "class" or "Scunthorpe" can never trip it).
//
// Scope: profanity, sexual slang, and racial / ethnic / homophobic /
// ableist slurs — the things a parent would not want rendered on an AAC
// board at soccer practice. Deliberately NOT listed: clinical anatomy
// (penis, vagina — a child may genuinely need doctor's-office words),
// reclaimed identity terms (queer), and common words with rare crude
// senses (cracker, fairy, screw) — exact-match over-blocking would cost
// more than it protects. When in doubt, remember the failure mode is a
// masked pill a parent can toggle off, so lean toward inclusion for
// anything unambiguous.
export const BAD_WORDS = [
  // ── profanity core + variants ──────────────────────────────────────────
  'fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fuckers', 'fuckin',
  'motherfucker', 'motherfuckers', 'motherfucking', 'fuckface', 'fuckhead',
  'fuckheads', 'fucktard', 'fucktards', 'dumbfuck', 'dumbfucks',
  'clusterfuck', 'fuckwit', 'fuckwits', 'fuckboy', 'fuckboys',
  'shit', 'shits', 'shitty', 'shitting', 'shitted', 'bullshit', 'horseshit',
  'chickenshit', 'apeshit', 'batshit', 'jackshit', 'shithead', 'shitheads',
  'shitface', 'shitshow', 'shitstorm', 'dipshit', 'dipshits', 'shite',
  'ass', 'asses', 'asshole', 'assholes', 'jackass', 'jackasses', 'dumbass',
  'dumbasses', 'smartass', 'smartasses', 'asshat', 'asshats', 'asswipe',
  'asswipes', 'arse', 'arses', 'arsehole', 'arseholes',
  'bitch', 'bitches', 'bitchy', 'bitching', 'sonofabitch',
  'bastard', 'bastards',
  'damn', 'damnit', 'dammit', 'goddamn', 'goddam', 'goddamnit', 'goddammit',
  'hell', 'hellhole',
  'crap', 'crappy', 'craps',
  'piss', 'pissed', 'pissing', 'pisses',
  'dick', 'dicks', 'dickhead', 'dickheads', 'dickwad', 'dickweed',
  'cock', 'cocks', 'cocksucker', 'cocksuckers',
  'prick', 'pricks',
  'cunt', 'cunts',
  'twat', 'twats',
  'douche', 'douches', 'douchebag', 'douchebags', 'douchey',
  'wanker', 'wankers', 'wank', 'wanking', 'tosser', 'tossers',
  'bollocks', 'bugger', 'buggered',
  'jerkoff', 'jackoff',
  'turd', 'turds',
  'numbnuts', 'nutsack', 'ballsack',
  // ── sexual slang / explicit ────────────────────────────────────────────
  'porn', 'porno', 'pornography', 'pornhub', 'hentai',
  'blowjob', 'blowjobs', 'handjob', 'handjobs', 'rimjob',
  'dildo', 'dildos', 'vibrator',
  'orgasm', 'orgasms', 'orgy',
  'cum', 'cumming', 'jizz',
  'boner', 'boners',
  'tits', 'titties', 'boobs', 'boobies',
  'pussy', 'pussies',
  'whore', 'whores', 'slut', 'sluts', 'slutty', 'skank', 'skanks',
  'hooker', 'hookers',
  'milf', 'milfs',
  'anal', 'butthole', 'buttholes',
  'horny',
  // ── racial / ethnic slurs + variants ───────────────────────────────────
  'nigger', 'niggers', 'nigga', 'niggas', 'negro', 'negros', 'negroes',
  'coon', 'coons', 'darkie', 'darkies', 'sambo',
  'spic', 'spics', 'wetback', 'wetbacks', 'beaner', 'beaners',
  'chink', 'chinks', 'gook', 'gooks', 'zipperhead',
  'jap', 'japs',
  'kike', 'kikes',
  'towelhead', 'towelheads', 'raghead', 'ragheads',
  'redskin', 'redskins', 'injun', 'injuns', 'squaw',
  'wop', 'wops', 'dago', 'dagos', 'kraut', 'krauts',
  'polack', 'polacks',
  'paki', 'pakis',
  'honky', 'honkies',
  'gyppo',
  // ── homophobic / transphobic / ableist slurs ───────────────────────────
  'faggot', 'faggots', 'fag', 'fags',
  'dyke', 'dykes',
  'tranny', 'trannies', 'shemale', 'shemales',
  'homo', 'homos', 'lesbo', 'lesbos',
  'retard', 'retards', 'retarded', 'tard', 'tards',
  'spaz', 'spazz',
  'midget', 'midgets', 'mongoloid',
];
