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

## Which app gets what (important — there are TWO Xcode projects)

- **"My World" board app = the Capacitor project** (generated `ios/App/…`, loads the
  live site). This is the one that needs the speech plugin + the Info.plist keys +
  a rebuild. Listening mode runs here.
- **Parent app = `kid-ios/` (standalone SwiftUI)**. A totally separate Xcode project.
  It does NOT need any of the speech/plist steps — only rebuild it to pick up
  unrelated changes (e.g. the home-screen colors).

Everything below is for the **Capacitor board app**.

## Native runbook (one-time) — gives the board its microphone

Apple's native speech-to-text isn't reachable from web JS, and the Web Speech API
does **not** run inside the Capacitor WKWebView, so the installed app needs the
community speech plugin (Apple `SFSpeechRecognizer` under the hood).

### 1. Terminal (in the repo folder on the Mac)

```bash
npm install                 # pulls in @capacitor-community/speech-recognition (already in package.json)
# If there is no ios/ folder yet (first time only):  npx cap add ios
npx cap sync ios            # copies the plugin + config into ios/ and runs `pod install`
npx cap open ios            # opens the project in Xcode
```

If `npx cap sync ios` complains about CocoaPods: `sudo gem install cocoapods`, then
re-run it.

### 2. Xcode — add the two permission strings (the part you asked about)

iOS refuses to use the mic/speech unless the app declares *why*. Two ways — pick one:

**GUI way**
1. In the left sidebar, click the blue **App** icon at the very top.
2. Select the **App** target → the **Info** tab (a.k.a. "Custom iOS Target Properties").
3. Hover any row, click the small **`+`**. Start typing **`Privacy - Microphone Usage
   Description`**, pick it, and set the value to a sentence, e.g.
   *"My World listens so spoken words appear as picture tiles on the board."*
4. Click **`+`** again, add **`Privacy - Speech Recognition Usage Description`**, value
   e.g. *"My World turns speech into the child's picture tiles in listening mode."*

(Those friendly names are the same as the raw keys `NSMicrophoneUsageDescription`
and `NSSpeechRecognitionUsageDescription`.)

**Faster "paste" way**
1. In the sidebar open **`App/App/Info.plist`**.
2. Right-click it → **Open As → Source Code**.
3. Paste these two pairs on a new line just **before** the final `</dict>`:
   ```xml
   <key>NSMicrophoneUsageDescription</key>
   <string>My World listens so spoken words appear as picture tiles on the board.</string>
   <key>NSSpeechRecognitionUsageDescription</key>
   <string>My World turns speech into the child's picture tiles in listening mode.</string>
   ```

### 3. Build to the iPad

1. Plug in the iPad (or use the same wireless device you normally deploy to).
2. Pick it from the device dropdown at the top of Xcode.
3. **Signing & Capabilities** → make sure your **Team** is selected (same as before).
4. Press **▶** to run, or **Product → Archive** → distribute to **TestFlight** the way
   you normally ship to the child's iPad.

### 4. First run

The first time listening mode starts on the iPad, iOS shows the **microphone** and
**speech recognition** permission prompts once — tap **Allow** on both. After that
it never asks again.

## 5. (Optional, advanced) Make it work fully offline

**You can skip this at first — listening works over the internet without it.** Do it
later when you want on-device/offline recognition.

The web side **already requests on-device** recognition: `kickSpeech()` calls
`SpeechRecognition.start({ …, requiresOnDeviceRecognition: true })`. Apple's
`SFSpeechRecognizer` then runs fully offline (no network) for languages the device
has downloaded.

⚠️ **Native enforcement:** the mainline `@capacitor-community/speech-recognition`
plugin doesn't read that option, so to make iOS honor it you must set the flag in
the plugin's Swift once. In `node_modules/@capacitor-community/speech-recognition/
ios/.../Plugin.swift` (or the Pod source), where the recognition request is built:

```swift
let request = SFSpeechAudioBufferRecognitionRequest()
request.requiresOnDeviceRecognition = true   // <-- add this line
```

Persist it across `npm install` with `patch-package`:

```bash
npx patch-package @capacitor-community/speech-recognition
```

(commit the generated `patches/` file). Then `npx cap sync ios` + rebuild. Offline
needs iOS 13+ and the language pack present under Settings → General → Keyboard /
Dictation; if a device lacks on-device support the plugin falls back to online.

## Timeout

Listening auto-stops after **2 minutes with no speech heard** (`LISTEN_IDLE_MS` in
`app.html`); every recognized phrase resets the timer. The child can also stop it
anytime with the on-board 🎙️ button (it turns red / "⏹️ Stop" while listening),
or the parent can stop it from the dashboard.

## Verifying

- Online, installed app: open the board on the iPad, tap **Listening mode** in the
  parent dashboard, grant permissions, and speak — words that exist on the board
  appear as tiles; others appear as text chips; the strip scrolls to the newest.
- Tap **Stop listening** (or `listen-stop`) — the branding returns and the mic
  releases (the iOS mic indicator turns off).
