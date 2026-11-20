# OnStage Worship — desktop app

This folder turns the OnStage Worship web app (`../worship`) into an installable
program for **Windows, macOS and Linux**. It uses [Electron](https://www.electronjs.org/).

The desktop app adds:

- **Offline AI verse detection.** Speech is recognised on the computer itself
  by Whisper base (English), with Silero voice-activity detection, through
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). No internet is needed,
  and audio never leaves the machine.
- **Real projector support.** The output and the stage display open full screen
  on the screen you choose (*Screens* button or menu). The console stays on the
  laptop, and the display is kept awake while an output is open.
- **Native menus and save dialogs.** Fonts are bundled, so everything works
  offline.

## How the speech engine works

```
microphone ─▶ AudioWorklet (16 kHz) ─▶ IPC ─▶ speech-worker.js (utility process)
                                                 Silero VAD → Whisper base.en (int8)
console page ◀─ interim / final text ◀─ IPC ◀────┘
     └─▶ speechref.js (reference + sound-alike book matching) ─▶ projector
```

While someone speaks, `speech-worker.js` transcribes the phrase so far every
~1.2 s ("interim"), and transcribes it again when they pause ("final"). Both are
fed to the same detector the browser version uses.

## Develop

```bash
cd desktop
npm install
npm run fetch-models      # Whisper + VAD, ~155 MB, checked by SHA-256
npm start                 # copies ../worship into ./web and starts the app
ONSTAGE_USE_SOURCE=1 npx electron .   # load ../worship directly while editing
npm run selftest          # offline speech + detection + output window check
```

When running as root on Linux, add `--no-sandbox`.

## Build installers

```bash
npm run dist:win     # dist/OnStage-Worship-Setup-<version>.exe  (NSIS, per-user, no admin)
npm run dist:mac     # dist/OnStage-Worship-<version>-mac-<arch>.dmg  (run on a Mac)
npm run dist:linux   # dist/*.AppImage and *.deb
```

GitHub Actions (`.github/workflows/desktop.yml`) builds and self-tests all of
them on real Windows, macOS and Linux machines. Pushing a tag such as `v1.0.0`
publishes them as a GitHub Release.

### Signing (optional, later)

The installers are not code-signed yet:

- **Windows** shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS** asks for **System Settings → Privacy & Security → Open Anyway** the first time.

To remove these warnings, buy a code-signing certificate (Windows) and an Apple
Developer ID (macOS). Then add them as `CSC_LINK`/`CSC_KEY_PASSWORD` (and Apple
notarisation secrets) to the workflow.

## Files

| File | Purpose |
|---|---|
| `main.js` | Windows, menus, screens, microphone permission, speech engine process, self-test |
| `preload.js` | The small, fixed API the page sees as `window.onstageDesktop` |
| `speech-worker.js` | Offline speech recognition (runs in its own process) |
| `scripts/prepare-web.js` | Copies `../worship` into `./web` for packaging |
| `scripts/fetch-models.js` | Downloads and verifies the speech models |
| `electron-builder.yml` | Installer settings |
| `THIRD-PARTY-NOTICES.txt` | Licences of bundled software, models, Bibles, hymns and fonts |
