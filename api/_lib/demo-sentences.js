// Curated demo sentences for the fluent-sentence showcase — the sentence
// constructor's membership feature ("I want ice cream" spoken as ONE natural
// utterance instead of three stitched word clips).
//
// The practice board can never call live TTS (signed-out /api/tts refuses),
// so these are PRE-RENDERED per demo voice into
//   demo-audio/<voiceId>/sentences/<sha16>.mp3
// (same factHash recipe as teaching-fact clips — _lab-demo-audio.js) and the
// demo constructors play the clip when the staged sentence matches one of
// these. That is the show-of-value; real boards speak ANY sentence fluently
// through the metered TTS path.
//
// Curation rules: every sentence must be BUILDABLE from standard-library
// tiles a demo board actually shows (core pivots + common nouns), short
// enough to stage in a few taps, and the kind of thing a child actually
// needs to say. Keep the list small — it exists to demo the feature, and
// every entry costs one clip per demo voice.
export const DEMO_SENTENCES = [
  'I want ice cream',
  'I want more',
  'I want juice',
  'I want to play',
  'I want to go outside',
  'I need help',
  'I am all done',
  'I am hungry',
  'I am thirsty',
  'I feel happy',
  'more please',
  'I love you',
];
