# Listening mode

Turn the kid board into a live word-board: the parent taps **Listening mode** in
the parent dashboard, the iPad's branding strip becomes a one-tile-high horizontal
slider, and anything said near the iPad is rendered there as the child's own tiles
— using the same greedy-longest matching as Message the Board.

## How it works (already shipped, web side)

- **Parent app** (`parent.html`, "Listening mode" panel): the toggle POSTs a live
  command to `/api/live` — `{ kind:'cmd', action:'listen-start' }` / `'listen-stop'`.
- **Board** (`app.html`): the always-on live listener (`applyCmd`) receives the
  command and calls `setListenMode(on)`:
  - adds `body.listening`, which hides the `<h1>` branding + Play button and shows
    `#listen-bar` (a one-tile-high strip) in the header.
  - builds a local lexicon from the board's items (People/Nouns/Verbs/Needs) and
    starts speech recognition.
  - each partial transcript is tokenized **client-side** with the same rule as
    `api/message-to-board.js` (greedy-longest: try the longest phrase as one tile,
    shrink to single words; unmatched words render as text) and drawn into the
    strip, newest-in-view. Tile chips are tappable to play their recorded voice.
- The feature never hijacks an active game/slideshow/edit session.

The speech engine is abstracted behind `speechPlugin()` →
`window.Capacitor.Plugins.SpeechRecognition`. If that plugin isn't present (plain
Safari or local dev), the strip shows "Open the installed app to use the mic"
instead of erroring — everything else still works.

## Native step required (one-time, in Xcode) — gives the board its microphone

Apple's native speech-to-text isn't reachable from web JS, and the Web Speech API
does **not** run inside the Capacitor WKWebView. So the installed app needs the
community speech plugin (Apple `SFSpeechRecognizer` under the hood — online now,
on-device offline when enabled).

1. Install (already added to `package.json`):
   ```bash
   npm install
   ```
2. Add the two usage strings to the **Capacitor app's** `Info.plist`
   (`ios/App/App/Info.plist` — NOT `kid-ios/`):
   ```xml
   <key>NSMicrophoneUsageDescription</key>
   <string>My World listens so spoken words appear as picture tiles on the board.</string>
   <key>NSSpeechRecognitionUsageDescription</key>
   <string>My World turns speech into the child's picture tiles in listening mode.</string>
   ```
3. Sync + rebuild:
   ```bash
   npx cap sync ios
   npx cap open ios     # then ▶ Run / archive to TestFlight
   ```

The first time listening mode starts on the iPad, iOS shows the mic + speech
permission prompts once; grant them.

## Offline (follow-up)

The plugin uses Apple's online recognition by default. On-device offline
recognition is a per-request option; flip it on in `kickSpeech()`
(`app.html`) once we want offline. No UI/protocol changes needed.

## Verifying

- Online, installed app: open the board on the iPad, tap **Listening mode** in the
  parent dashboard, grant permissions, and speak — words that exist on the board
  appear as tiles; others appear as text chips; the strip scrolls to the newest.
- Tap **Stop listening** (or `listen-stop`) — the branding returns and the mic
  releases (the iOS mic indicator turns off).
