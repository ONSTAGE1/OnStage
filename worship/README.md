# OnStage Worship

Church presentation software for songs, scripture, media and announcements, with an **AI Verse Assistant**. It listens to the preacher through a microphone and puts Bible verses on screen as soon as they are mentioned.

It runs in the browser and needs no install or build step.

## Install as a desktop program

Download the `OnStage-Worship.zip` release (or this `worship/` folder) and follow **READ ME FIRST.txt**:

- **Windows:** double-click `Start OnStage Worship.bat`. It opens the app in its own Edge/Chrome window and adds a desktop shortcut.
- **Mac:** right-click `index.html` → Open With → Google Chrome, or double-click `Start OnStage Worship (Mac).command`.
- **Anything else:** opening `index.html` in Chrome or Edge works the same way. The microphone, saved data and the projector window all work from the file.
- **Any computer:** when the app is opened from a web address, Chrome/Edge shows an **Install app** button. The app then works offline, except for speech recognition.

## Quick start (developers)

```bash
cd OnStage            # repository root
python3 -m http.server 8000
```

Open **http://localhost:8000/worship/** in **Google Chrome** or **Microsoft Edge**.

1. Click **▣ Output**, drag the new window onto the projector screen and double-click it to go full screen.
2. Optionally click **Stage display** for a confidence monitor (current slide, next slide, clock, countdown, messages).
3. Build the service in the **Schedule** from the library tabs. Click an item to preview it and double-click to send it live.
4. Click **Start listening** in the AI panel when the sermon begins.

> The microphone only works over `http://localhost` or `https://`. Opening `index.html` straight from disk (`file://`) may block it. Any static host works, including GitHub Pages.

## AI Verse Assistant

| The preacher says… | What happens |
|---|---|
| "Turn with me to **John chapter three verse sixteen**" | John 3:16 goes on screen |
| "**Romans 8:28**", "**first Corinthians thirteen four through seven**" | The single verse or the whole range is shown |
| "Psalm **one hundred and nineteen** verse **one oh five**", "John **316**" | Spoken numbers and run-together numbers are understood |
| "Look at **verse 18**", "**chapter 4** verse 2", "**next verse**" | Follow-up phrases use the passage already on screen |
| *Reads "Trust in the Lord with all your heart…" without giving a reference* | Matched to **Proverbs 3:5** by quote recognition |
| "I will **mark 1** thing…" | Chapter-only mentions like this are **never** shown automatically. They appear as low-confidence suggestions |

**Modes**
- **Auto live**: confident detections go straight to the projector.
- **Auto preview**: detections load into Preview, and the operator presses **Enter** to show them.
- **Suggest only**: detections appear as cards with **Show live / Preview / + Schedule** buttons. Press **A** to show the newest one.

**How it works**
- `js/listener.js` streams microphone audio through the browser's speech recognition (Web Speech API). It keeps the recogniser running and reacts to interim results once the numbers are clearly complete.
- `js/speechref.js` turns speech into references. It converts number words, knows spoken book names and common mis-hearings ("Philippines" → Philippians), handles ranges and single-chapter books, and checks every reference against the Bible so impossible ones are thrown away.
- `js/bible.js` handles quote recognition. An idf-weighted inverted index over all 31,102 verses, confirmed by word-pair overlap, matches verses that are read aloud. KJV forms are folded ("believeth" ≈ "believes"), so modern wording still matches. A lookup takes about 1 ms.
- A repeat guard stops the same verse from re-triggering every time the preacher repeats it.

Speech recognition is done by the browser's speech service: in Chrome, audio is sent to Google for transcription. Reference detection and verse matching run locally.

You can try the detector without a microphone by typing a sentence into the **Test** box in the AI panel.

## Features

- **Schedule**: drag to reorder, save and open `.onstage.json` service files (the songs and presentations they use are included), and an auto-saved working schedule. At the end of an item, the arrow keys move on to the next one.
- **Preview / Live**: separate monitors with slide thumbnails, number keys jump to a slide, and video play/pause/restart controls.
- **Songs**: 30 built-in public-domain hymns, "Find online" buttons for CCLI SongSelect and Hymnary.org, importers for SongSelect `.txt`/`.usr`, ChordPro, OpenLyrics `.xml`, plain text and `.json` (or drag files onto the list), library with search, an editor with `[Verse 1]` / `[Chorus]` / `[Bridge]` sections, a maximum number of lines per slide, copyright/CCLI line, import from `.txt` or `.json`, and export.
- **Scripture**: five free translations built in (KJV, BSB, NHEB, ASV, BBE; public domain / CC0, each loaded on first use), book/chapter/verse pickers, quick entry (`jn 3 16`, `1 Cor 13:4-7`; press Shift+Enter to go live), keyword search, verses per slide, and automatic splitting of long verses. You can import other translations your church is licensed for as JSON.
- **Media**: upload images and videos (stored in the browser's IndexedDB), use them as song or scripture backgrounds or as the logo, or show them full screen. Built-in gradient backgrounds are included.
- **Presentations**: text slides for announcements and sermon points, or **Images → slides** to import a PowerPoint/Keynote deck exported as images.
- **Themes**: separate song, scripture and presentation themes with font, size, colours, alignment, shadow, outline, background dimming and reference position. Text auto-fits.
- **Live controls**: Black (B), Clear text (C), Logo (L), Clear all (Esc).
- **Alerts**: a scrolling ticker on the main screen (e.g. nursery calls) and private messages on the stage display.
- **Countdown**: count down a number of minutes or to a clock time, shown on the screen and on the stage display.
- **Backup**: export and restore everything from Settings.

## Keyboard shortcuts

| Key | Action |
|---|---|
| → ↓ Space PgDn / ← ↑ PgUp | Next / previous slide (presentation clickers work) |
| 1–9 | Jump to slide |
| Enter | Preview → Live |
| B / C / L / Esc | Black / Clear text / Logo / Clear all |
| M | Start/stop AI listening |
| A | Show newest AI suggestion live |
| Ctrl+S | Save schedule |

## Files

```
worship/
  index.html        operator console
  output.html       projector output (?stage=1 → stage display)
  css/              console + shared render styles
  js/books.js       book names and spoken aliases
  js/speechref.js   spoken-reference detector (works in Node too)
  js/bible.js       Bible access, search, quote recognition
  js/listener.js    microphone / speech recognition
  js/render.js      slide renderer shared by all screens
  js/store.js       localStorage + IndexedDB persistence
  js/app.js         console UI
  data/kjv.js       King James Version (public domain)
```

The two sample songs are placeholder lyrics. Add your own songs, and use them under your CCLI licence where that applies.
