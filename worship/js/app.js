/*
 * OnStage Worship — operator console.
 */
(function () {
  "use strict";
  var Books = window.OnStageBooks, Ref = window.OnStageSpeechRef, BibleReg = window.OnStageBible;
  var R = window.OnStageRender, Store = window.OnStageStore, Listener = window.OnStageListener;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = R.esc;

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  var SAMPLE_SONGS = [
    { id: "sample-1", title: "Morning Light (sample)", author: "OnStage sample", copyright: "Sample lyrics – replace with your own songs", ccli: "",
      lyrics: "[Verse 1]\nWe lift our eyes as morning breaks\nYour mercy new on every face\nThe night is gone, the shadows flee\nYour light has come to set us free\n\n[Chorus]\nHallelujah, sing it loud\nLift His name above the crowd\nEvery heart and every voice\nCome before Him and rejoice\n\n[Verse 2]\nYou walk with us through every storm\nYour arms are strong, Your love is warm\nWe have no fear of what's ahead\nFor by Your hand we will be led\n\n[Bridge]\nOpen up the gates\nLet the King come in\nOpen up our hearts\nLet the song begin" },
    { id: "sample-2", title: "Gather Here (sample)", author: "OnStage sample", copyright: "Sample lyrics – replace with your own songs", ccli: "",
      lyrics: "[Verse 1]\nGather here, all who are weary\nGather here, all who are weak\nThere is rest beneath His shelter\nThere is peace for all who seek\n\n[Chorus]\nYou are faithful, You are near\nWe will worship, gathered here\n\n[Verse 2]\nBring your burdens, bring your sorrow\nLay them down before His throne\nGrace enough for every morrow\nNo one ever walks alone" }
  ];
  var SAMPLE_PRES = [
    { id: "pres-welcome", title: "Welcome", slides: "Welcome to church!\nWe're glad you're here\n\nPlease silence your phones\n\nConnect with us after the service\nat the welcome desk" }
  ];

  var settings = Object.assign({
    version: "KJV", vps: 1, maxChars: 260, verseNums: true, showVersion: true, lines: 4, copyright: true, ccli: "",
    aiMode: "live", aiQuotes: true, aiInterim: true, aiFollow: true, aiRest: true, aiLang: "en-US", aiCooldown: 25000,
    logoMediaId: null
  }, Store.get("settings", {}));

  var themes = Store.get("themes", null) || {
    song: Object.assign({}, R.DEFAULT_THEME, { bg: "grad:0", size: 84 }),
    scripture: Object.assign({}, R.DEFAULT_THEME, { bg: "grad:4", size: 70, align: "left", font: "Merriweather", bold: false, lineHeight: 1.4 }),
    presentation: Object.assign({}, R.DEFAULT_THEME, { bg: "grad:5", size: 90 })
  };
  var songs = Store.get("songs", null) || SAMPLE_SONGS.slice();
  var presentations = Store.get("presentations", null) || SAMPLE_PRES.slice();
  var schedule = Store.get("schedule", []);
  var media = []; // {id, name, kind, url, blob}

  var ui = {
    selItem: null,           // selected schedule item id
    preview: null,           // {item, slides, index}
    live: null,              // {item, slides, index}
    black: false, clear: false, logo: false,
    alert: { text: "", on: false }, stageMessage: "",
    videoCmd: null,
    selSong: null, selPres: null, selMedia: null, themeKey: "song",
    bibleSel: null,          // {book, chapter, from, to}
    lastScripture: null      // context for AI follow-ups
  };

  function bible() { return BibleReg.get(settings.version); }
  function saveAll() {
    Store.set("settings", settings); Store.set("themes", themes); Store.set("songs", songs);
    Store.set("presentations", presentations); Store.set("schedule", schedule);
  }
  var saveSoon = debounce(saveAll, 300);
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ------------------------------------------------------------------ */
  /* Backgrounds & slide building                                        */
  /* ------------------------------------------------------------------ */
  function resolveBg(bg) {
    if (bg && bg.indexOf("media:") === 0) {
      var m = mediaById(bg.slice(6));
      return m ? { kind: m.kind, url: m.url, muted: true } : R.resolveBg("grad:0");
    }
    return R.resolveBg(bg);
  }
  function mediaById(id) { for (var i = 0; i < media.length; i++) if (media[i].id === id) return media[i]; return null; }
  function songById(id) { for (var i = 0; i < songs.length; i++) if (songs[i].id === id) return songs[i]; return null; }
  function presById(id) { for (var i = 0; i < presentations.length; i++) if (presentations[i].id === id) return presentations[i]; return null; }

  function parseLyrics(text) {
    var sections = [], cur = null;
    String(text || "").replace(/\r/g, "").split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var label = "";
      var m = lines[0].match(/^\[(.+)\]$/) || lines[0].match(/^((?:verse|chorus|bridge|pre-?chorus|tag|intro|outro|ending|refrain|interlude)\s*\d*)\s*:?$/i);
      if (m) { label = m[1]; lines.shift(); }
      if (!lines.length) return;
      cur = { label: label || (cur ? "" : ""), lines: lines };
      sections.push(cur);
    });
    return sections;
  }

  function chunk(lines, n) {
    if (!n || lines.length <= n) return [lines];
    var out = [];
    for (var i = 0; i < lines.length; i += n) out.push(lines.slice(i, i + n));
    return out;
  }

  function splitLong(text, max) {
    if (text.length <= max) return [text];
    var parts = text.match(/[^.;:!?,]+[.;:!?,]*\s*/g) || [text];
    var out = [], cur = "";
    parts.forEach(function (p) {
      if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ""; }
      cur += p;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function buildSlides(item) {
    var slides = [];
    var theme, bgR;
    if (item.kind === "song") {
      var song = songById(item.songId);
      theme = themes.song; bgR = resolveBg(item.bg || theme.bg);
      if (!song) return [{ type: "text", text: "(song missing)", theme: theme, bgResolved: bgR }];
      parseLyrics(song.lyrics).forEach(function (sec) {
        chunk(sec.lines, +settings.lines).forEach(function (ls, i) {
          slides.push({ type: "text", label: sec.label + (i ? " ·" + (i + 1) : ""), text: ls.join("\n"), theme: theme, bgResolved: bgR });
        });
      });
      if (settings.copyright && slides.length) {
        var last = slides[slides.length - 1];
        var line = [song.title, song.author, song.copyright, song.ccli ? "CCLI Song #" + song.ccli : "", settings.ccli ? "CCLI Licence #" + settings.ccli : ""].filter(Boolean).join(" · ");
        last.ref = line; last.theme = Object.assign({}, theme, { refSize: 26, refColor: "#cfcfcf" });
      }
    } else if (item.kind === "scripture") {
      var b = BibleReg.get(item.version || settings.version);
      theme = themes.scripture; bgR = resolveBg(item.bg || theme.bg);
      var verses = b.passage(item.ref, item.toEnd);
      var vps = Math.max(1, +settings.vps);
      var label = function (vs) {
        var r = { book: item.ref.book, chapter: item.ref.chapter, verse: vs[0].verse, verseEnd: vs.length > 1 ? vs[vs.length - 1].verse : null };
        return Ref.format(r) + (settings.showVersion ? " " + b.id : "");
      };
      for (var i = 0; i < verses.length; i += vps) {
        var group = verses.slice(i, i + vps);
        var joined = group.map(function (v) { return (settings.verseNums ? "[" + v.verse + "] " : "") + v.text; }).join(" ");
        var pieces = vps === 1 ? splitLong(joined, +settings.maxChars) : [joined];
        pieces.forEach(function (p, k) {
          slides.push({ type: "scripture", text: p, ref: label(group), verseNums: settings.verseNums, theme: theme, bgResolved: bgR,
            label: group[0].verse + (group.length > 1 ? "-" + group[group.length - 1].verse : "") + (pieces.length > 1 ? String.fromCharCode(97 + k) : ""),
            verse: group[0].verse, verseEnd: group[group.length - 1].verse, book: item.ref.book, chapter: item.ref.chapter });
        });
      }
    } else if (item.kind === "presentation") {
      var pres = presById(item.presId);
      theme = themes.presentation;
      if (!pres) return [{ type: "text", text: "(presentation missing)", theme: theme, bgResolved: resolveBg(theme.bg) }];
      bgR = resolveBg(pres.bg || theme.bg);
      if (pres.images) {
        pres.images.forEach(function (id, i) {
          var m = mediaById(id);
          slides.push({ type: "media", label: String(i + 1), bgResolved: m ? { kind: m.kind, url: m.url, fit: "contain" } : { css: "#000" }, theme: theme, mediaId: id });
        });
      } else {
        String(pres.slides || "").replace(/\r/g, "").split(/\n\s*\n/).forEach(function (s, i) {
          if (s.trim()) slides.push({ type: "text", label: String(i + 1), text: s.trim(), theme: theme, bgResolved: bgR });
        });
      }
    } else if (item.kind === "media") {
      var md = mediaById(item.mediaId);
      slides.push({ type: "media", label: md ? md.kind : "missing", bgResolved: md ? { kind: md.kind, url: md.url, fit: "contain", loop: true, muted: false } : { css: "#000" }, mediaId: item.mediaId });
    } else if (item.kind === "countdown") {
      theme = themes.presentation;
      slides.push({ type: "countdown", label: "timer", countdown: { target: item.target || (Date.now() + item.minutes * 60000), label: item.label }, theme: theme, bgResolved: resolveBg(theme.bg) });
    }
    return slides.length ? slides : [{ type: "text", text: "", theme: themes.song, bgResolved: resolveBg(themes.song.bg) }];
  }

  /* ------------------------------------------------------------------ */
  /* Items                                                               */
  /* ------------------------------------------------------------------ */
  function songItem(song) { return { id: Store.uid(), kind: "song", songId: song.id, title: song.title }; }
  function presItem(p) { return { id: Store.uid(), kind: "presentation", presId: p.id, title: p.title }; }
  function mediaItem(m) { return { id: Store.uid(), kind: "media", mediaId: m.id, title: m.name }; }
  function scriptureItem(ref, toEnd) {
    var r = { book: ref.book, chapter: ref.chapter, verse: ref.verse, verseEnd: ref.verseEnd };
    var shown = Ref.format(r);
    return { id: Store.uid(), kind: "scripture", ref: r, toEnd: !!toEnd, version: settings.version, title: shown + " (" + settings.version + ")" };
  }

  function addToSchedule(item) {
    schedule.push(item); ui.selItem = item.id;
    renderSchedule(); saveSoon(); toast("Added “" + item.title + "” to schedule");
  }

  /* ------------------------------------------------------------------ */
  /* Preview / live                                                      */
  /* ------------------------------------------------------------------ */
  var previewStage, liveStage, themeStage;

  function setPreview(item, index) {
    if (!item) { ui.preview = null; renderPreview(); return; }
    ui.preview = { item: item, slides: buildSlides(item), index: index || 0 };
    renderPreview();
  }
  function goLive(item, index) {
    if (item.kind === "countdown" && !item.target) item = Object.assign({}, item, { target: Date.now() + item.minutes * 60000 });
    ui.live = { item: item, slides: buildSlides(item), index: Math.max(0, index || 0) };
    ui.live.index = Math.min(ui.live.index, ui.live.slides.length - 1);
    ui.black = false; ui.logo = false;
    if (item.kind === "scripture") noteScripture(ui.live.slides[ui.live.index]);
    renderLive(); pushOutput();
  }
  function setLiveIndex(i) {
    if (!ui.live) return;
    i = Math.max(0, Math.min(ui.live.slides.length - 1, i));
    ui.live.index = i;
    if (ui.live.item.kind === "scripture") noteScripture(ui.live.slides[i]);
    renderLive(); pushOutput();
  }
  function step(d) {
    if (!ui.live) { if (ui.preview) goLive(ui.preview.item, ui.preview.index); return; }
    var n = ui.live.index + d;
    if (n >= ui.live.slides.length || n < 0) {
      // move to next/previous schedule item, like a playlist
      var idx = schedule.findIndex(function (s) { return s.id === ui.live.item.id; });
      if (idx >= 0 && schedule[idx + d]) {
        var it = schedule[idx + d]; ui.selItem = it.id; renderSchedule();
        var sl = buildSlides(it); goLive(it, d > 0 ? 0 : sl.length - 1);
      }
      return;
    }
    setLiveIndex(n);
  }
  function noteScripture(slide) {
    if (slide && slide.book != null) ui.lastScripture = { book: slide.book, chapter: slide.chapter, verse: slide.verse };
  }

  function liveSlide() { return ui.live ? ui.live.slides[ui.live.index] : null; }
  function outState() {
    var s = liveSlide();
    var next = ui.live ? ui.live.slides[ui.live.index + 1] : null;
    var logo = settings.logoMediaId ? mediaById(settings.logoMediaId) : null;
    return {
      slide: s, next: next ? { text: next.text, ref: next.ref } : null, itemTitle: ui.live ? ui.live.item.title : "",
      black: ui.black, clear: ui.clear, logo: ui.logo, logoUrl: logo ? logo.url : null,
      alert: ui.alert, stageMessage: ui.stageMessage, videoCmd: ui.videoCmd
    };
  }

  var outputs = [];
  var bc = null;
  try { bc = new BroadcastChannel("onstage-worship"); bc.onmessage = function (e) { if (e.data && e.data.type === "onstage-hello") pushOutput(); }; } catch (e) {}
  function pushOutput() {
    var st = outState();
    var msg = { type: "onstage-state", state: JSON.parse(JSON.stringify(st)) };
    outputs = outputs.filter(function (w) { return w && !w.closed; });
    outputs.forEach(function (w) { try { w.postMessage(msg, "*"); } catch (e) {} });
    if (bc) try { bc.postMessage(msg); } catch (e) {}
    liveStage.render(st);
    $("#btnBlack").classList.toggle("on", ui.black);
    $("#btnClear").classList.toggle("on", ui.clear);
    $("#btnLogo").classList.toggle("on", ui.logo);
    $("#btnMsg").classList.toggle("on", !!(ui.alert.on || ui.stageMessage));
  }
  window.addEventListener("message", function (e) {
    if (!e.data) return;
    if (e.data.type === "onstage-hello") pushOutput();
    if (e.data.type === "onstage-key") handleKey({ key: e.data.key, preventDefault: function () {}, target: document.body });
  });
  function openWindow(stage) {
    var w = window.open("output.html" + (stage ? "?stage=1" : ""), stage ? "onstage-stage" : "onstage-output",
      "popup=yes,width=" + (stage ? 1100 : 1280) + ",height=" + (stage ? 680 : 720));
    if (!w) { toast("Pop-up blocked – allow pop-ups for this page"); return; }
    outputs.push(w);
    setTimeout(pushOutput, 600);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: schedule, slides                                         */
  /* ------------------------------------------------------------------ */
  var ICONS = { song: "♪", scripture: "✝", media: "▶", presentation: "▤", countdown: "⏱" };
  var dragId = null;
  function renderSchedule() {
    var ol = $("#schedule");
    ol.innerHTML = "";
    schedule.forEach(function (it) {
      var li = document.createElement("li");
      li.draggable = true; li.dataset.id = it.id;
      if (it.id === ui.selItem) li.classList.add("sel");
      if (ui.live && ui.live.item.id === it.id) li.classList.add("is-live");
      li.innerHTML = '<span class="ico ' + it.kind + '">' + ICONS[it.kind] + '</span><span class="t">' + esc(it.title) + "</span>";
      li.onclick = function () { ui.selItem = it.id; renderSchedule(); setPreview(it); };
      li.ondblclick = function () { ui.selItem = it.id; renderSchedule(); setPreview(it); goLive(it, 0); };
      li.ondragstart = function () { dragId = it.id; };
      li.ondragover = function (e) { e.preventDefault(); li.classList.add("drag-over"); };
      li.ondragleave = function () { li.classList.remove("drag-over"); };
      li.ondrop = function (e) {
        e.preventDefault();
        var from = schedule.findIndex(function (s) { return s.id === dragId; });
        var to = schedule.findIndex(function (s) { return s.id === it.id; });
        if (from < 0 || to < 0 || from === to) return;
        var moved = schedule.splice(from, 1)[0];
        schedule.splice(to, 0, moved);
        renderSchedule(); saveSoon();
      };
      ol.appendChild(li);
    });
    $("#schedulePanel").classList.toggle("empty", !schedule.length);
  }

  function thumbBg(slide) {
    var b = slide.bgResolved || {};
    if (b.kind === "image") return "background-image:url(" + JSON.stringify(b.url).replace(/"/g, "'") + ")";
    if (b.kind === "video") return "background:#1a1a1a";
    return "background:" + (b.css || "#000");
  }
  function renderThumbs(host, slides, sel, onClick, onDbl) {
    host.innerHTML = "";
    slides.forEach(function (s, i) {
      var d = document.createElement("div");
      d.className = "thumb" + (i === sel ? " sel" : "");
      d.setAttribute("style", thumbBg(s));
      var txt = s.type === "media" ? ((s.bgResolved || {}).kind === "video" ? "▶ video" : "") :
        s.type === "countdown" ? "⏱ " + (s.countdown.label || "Countdown") : (s.text || "").replace(/\[(\d+)\]\s*/g, "$1 ");
      d.innerHTML = (s.label ? '<span class="lb">' + esc(s.label) + "</span>" : "") + '<div class="tx">' + esc(txt) + '</div><span class="no">' + (i + 1) + "</span>";
      d.onclick = function () { onClick(i); };
      if (onDbl) d.ondblclick = function () { onDbl(i); };
      host.appendChild(d);
    });
    var cur = host.children[sel];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }

  function renderPreview() {
    var p = ui.preview;
    $("#previewTitle").textContent = p ? p.item.title : "";
    previewStage.render({ slide: p ? p.slides[p.index] : null });
    renderThumbs($("#previewSlides"), p ? p.slides : [], p ? p.index : -1,
      function (i) { ui.preview.index = i; renderPreview(); },
      function (i) { goLive(ui.preview.item, i); });
  }
  function renderLive() {
    var l = ui.live;
    $("#liveTitle").textContent = l ? l.item.title : "";
    renderThumbs($("#liveSlides"), l ? l.slides : [], l ? l.index : -1, function (i) { setLiveIndex(i); });
    var s = liveSlide();
    $("#videoCtl").hidden = !(s && s.bgResolved && s.bgResolved.kind === "video");
    renderSchedule();
  }

  /* ------------------------------------------------------------------ */
  /* Scripture library                                                   */
  /* ------------------------------------------------------------------ */
  function fillVersions() {
    var sel = $("#bVersion");
    sel.innerHTML = BibleReg.versions().map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.id) + " — " + esc(v.name) + "</option>"; }).join("");
    sel.value = settings.version;
  }
  function fillBooks() {
    $("#bBook").innerHTML = Books.list.map(function (b) { return '<option value="' + b.index + '">' + b.name + "</option>"; }).join("");
  }
  function setBibleSel(ref, renderList) {
    var b = bible();
    var book = ref.book, ch = ref.chapter || 1;
    var vc = b.verseCount(book, ch);
    var from = ref.verse || 1, to = ref.verseEnd || ref.verse || from;
    ui.bibleSel = { book: book, chapter: ch, from: from, to: Math.max(from, to) };
    $("#bBook").value = book;
    $("#bChapter").innerHTML = range(1, b.chapterCount(book)).map(opt).join("");
    $("#bChapter").value = ch;
    $("#bFrom").innerHTML = range(1, vc).map(opt).join(""); $("#bFrom").value = from;
    $("#bTo").innerHTML = range(1, vc).map(opt).join(""); $("#bTo").value = ui.bibleSel.to;
    if (renderList !== false) renderChapter();
  }
  function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }
  function opt(n) { return "<option>" + n + "</option>"; }
  function renderChapter() {
    var s = ui.bibleSel, b = bible();
    var host = $("#bVerses");
    host.innerHTML = "";
    b.passage({ book: s.book, chapter: s.chapter, verse: null }).forEach(function (v) {
      var d = document.createElement("div");
      d.className = "verse" + (v.verse >= s.from && v.verse <= s.to ? " sel" : "");
      d.innerHTML = "<b>" + s.chapter + ":" + v.verse + "</b><span>" + esc(v.text) + "</span>";
      d.onclick = function (e) {
        if (e.shiftKey) { var a = Math.min(s.from, v.verse), z = Math.max(s.from, v.verse); setBibleSel({ book: s.book, chapter: s.chapter, verse: a, verseEnd: z }); }
        else setBibleSel({ book: s.book, chapter: s.chapter, verse: v.verse });
        bPreview();
      };
      d.ondblclick = function () { bLive(); };
      host.appendChild(d);
    });
    var first = host.querySelector(".sel"); if (first) first.scrollIntoView({ block: "nearest" });
  }
  function bRef() { var s = ui.bibleSel; return { book: s.book, chapter: s.chapter, verse: s.from, verseEnd: s.to > s.from ? s.to : null }; }
  function bPreview() { setPreview(scriptureItem(bRef())); }
  function bLive() { var it = scriptureItem(bRef()); setPreview(it); goLive(it, 0); }

  /* ------------------------------------------------------------------ */
  /* Songs                                                               */
  /* ------------------------------------------------------------------ */
  function renderSongs() {
    var q = $("#songSearch").value.trim().toLowerCase();
    var list = songs.filter(function (s) { return !q || (s.title + " " + s.lyrics + " " + (s.author || "")).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return a.title.localeCompare(b.title); });
    $("#songList").innerHTML = list.map(function (s) {
      return '<li data-id="' + esc(s.id) + '" class="' + (s.id === ui.selSong ? "sel" : "") + '"><span>' + esc(s.title) + "</span><small>" + esc(s.author || "") + "</small></li>";
    }).join("") || '<li class="muted">No songs found</li>';
    renderSongDetail();
  }
  function renderSongDetail() {
    var s = songById(ui.selSong);
    if (!s) { $("#songDetail").innerHTML = '<div class="empty-note">Select a song.</div>'; return; }
    $("#songDetail").innerHTML = "<h3>" + esc(s.title) + '</h3><div class="muted small">' + esc([s.author, s.copyright, s.ccli ? "CCLI #" + s.ccli : ""].filter(Boolean).join(" · ")) + "</div>" +
      parseLyrics(s.lyrics).map(function (sec) { return (sec.label ? '<span class="sec">' + esc(sec.label) + "</span>" : "<br>") + esc(sec.lines.join("\n")); }).join("");
  }
  function editSong(song) {
    var isNew = !song;
    song = song || { id: Store.uid(), title: "", author: "", copyright: "", ccli: "", lyrics: "[Verse 1]\n\n\n[Chorus]\n" };
    modal(isNew ? "New song" : "Edit song",
      '<div class="form"><label>Title<input id="fTitle" value="' + esc(song.title) + '"></label><label>Author<input id="fAuthor" value="' + esc(song.author || "") + '"></label>' +
      '<label>Copyright<input id="fCopy" value="' + esc(song.copyright || "") + '"></label><label>CCLI song #<input id="fCcli" value="' + esc(song.ccli || "") + '"></label>' +
      '<label class="full">Lyrics — separate slides with a blank line; label sections with [Verse 1], [Chorus], [Bridge]…<textarea id="fLyrics" rows="16">' + esc(song.lyrics) + "</textarea></label></div>",
      [{ label: "Cancel" }, { label: "Save song", primary: true, fn: function () {
        song.title = $("#fTitle").value.trim() || "Untitled song";
        song.author = $("#fAuthor").value.trim(); song.copyright = $("#fCopy").value.trim(); song.ccli = $("#fCcli").value.trim();
        song.lyrics = $("#fLyrics").value;
        if (isNew) songs.push(song);
        ui.selSong = song.id; saveSoon(); renderSongs(); refreshOpenItems();
      } }]);
  }

  /* ------------------------------------------------------------------ */
  /* Presentations                                                       */
  /* ------------------------------------------------------------------ */
  function renderPres() {
    $("#presList").innerHTML = presentations.map(function (p) {
      return '<li data-id="' + esc(p.id) + '" class="' + (p.id === ui.selPres ? "sel" : "") + '"><span>' + esc(p.title) + "</span><small>" + (p.images ? p.images.length + " images" : "") + "</small></li>";
    }).join("") || '<li class="muted">No presentations</li>';
    var p = presById(ui.selPres);
    $("#presDetail").innerHTML = p ? "<h3>" + esc(p.title) + "</h3>" + (p.images ? '<div class="muted">' + p.images.length + " image slides</div>" :
      String(p.slides).split(/\n\s*\n/).map(function (s, i) { return '<span class="sec">Slide ' + (i + 1) + "</span>" + esc(s.trim()); }).join("")) :
      '<div class="empty-note">Announcements, sermon points, welcome slides…</div>';
  }
  function editPres(p) {
    var isNew = !p;
    p = p || { id: Store.uid(), title: "", slides: "" };
    if (p.images) { toast("Image presentations can be renamed or deleted only"); }
    var bgOpts = bgOptions(p.bg || "");
    modal(isNew ? "New presentation" : "Edit presentation",
      '<div class="form"><label>Title<input id="fTitle" value="' + esc(p.title) + '"></label><label>Background<select id="fBg"><option value="">Theme default</option>' + bgOpts + "</select></label>" +
      (p.images ? "" : '<label class="full">Slides — separate slides with a blank line<textarea id="fSlides" rows="14">' + esc(p.slides) + "</textarea></label>") + "</div>",
      [{ label: "Cancel" }, { label: "Save", primary: true, fn: function () {
        p.title = $("#fTitle").value.trim() || "Untitled";
        p.bg = $("#fBg").value || undefined;
        if (!p.images) p.slides = $("#fSlides").value;
        if (isNew) presentations.push(p);
        ui.selPres = p.id; saveSoon(); renderPres(); refreshOpenItems();
      } }]);
  }
  function bgOptions(cur) {
    var o = R.GRADIENTS.map(function (g, i) { return '<option value="grad:' + i + '"' + (cur === "grad:" + i ? " selected" : "") + ">Gradient " + (i + 1) + "</option>"; });
    media.forEach(function (m) { o.push('<option value="media:' + m.id + '"' + (cur === "media:" + m.id ? " selected" : "") + ">" + (m.kind === "video" ? "🎞 " : "🖼 ") + esc(m.name) + "</option>"); });
    return o.join("");
  }

  /* ------------------------------------------------------------------ */
  /* Media                                                               */
  /* ------------------------------------------------------------------ */
  function loadMedia() {
    return Store.all("media").then(function (rows) {
      media = rows.sort(function (a, b) { return a.created - b.created; }).map(function (r) {
        return { id: r.id, name: r.name, kind: r.kind, blob: r.blob, url: URL.createObjectURL(r.blob) };
      });
    }).catch(function () { media = []; });
  }
  function renderMedia() {
    var grid = $("#mediaGrid");
    var tiles = R.GRADIENTS.map(function (g, i) { return { id: "grad:" + i, name: i === R.GRADIENTS.length - 1 ? "Black" : "Gradient " + (i + 1), css: g }; })
      .concat(media.map(function (m) { return { id: "media:" + m.id, name: m.name, m: m }; }));
    grid.innerHTML = "";
    tiles.forEach(function (t) {
      var d = document.createElement("div");
      d.className = "mtile" + (ui.selMedia === t.id ? " sel" : "");
      if (t.css) d.style.background = t.css;
      else if (t.m.kind === "image") d.style.backgroundImage = "url('" + t.m.url + "')";
      else { var v = document.createElement("video"); v.src = t.m.url; v.muted = true; v.preload = "metadata"; d.appendChild(v); }
      var tags = [];
      if (themes.song.bg === t.id) tags.push("songs");
      if (themes.scripture.bg === t.id) tags.push("scripture");
      if (t.m && settings.logoMediaId === t.m.id) tags.push("logo");
      d.innerHTML += '<div class="tags">' + tags.map(function (x) { return "<i>" + x + "</i>"; }).join("") + "</div><span>" + esc(t.name) + "</span>";
      d.onclick = function () { ui.selMedia = t.id; renderMedia(); };
      d.ondblclick = function () { ui.selMedia = t.id; mediaAct("live"); };
      grid.appendChild(d);
    });
  }
  function selectedMediaItem() {
    var id = ui.selMedia;
    if (!id) { toast("Select a media tile first"); return null; }
    if (id.indexOf("media:") === 0) { var m = mediaById(id.slice(6)); return m ? mediaItem(m) : null; }
    // a gradient as a plain background slide
    return { id: Store.uid(), kind: "presentation", presId: "__bg_" + id, title: "Background", _bg: id };
  }
  function mediaAct(what) {
    var it = selectedMediaItem(); if (!it) return;
    if (it._bg) { // gradient: make a transient blank presentation
      var pid = it.presId;
      if (!presById(pid)) presentations.push({ id: pid, title: "Background", slides: " ", bg: it._bg, hidden: true });
    }
    if (what === "preview") setPreview(it);
    else if (what === "live") { setPreview(it); goLive(it, 0); }
    else addToSchedule(it);
  }
  function uploadMedia(files) {
    var jobs = Array.prototype.map.call(files, function (f) {
      var kind = /^video\//.test(f.type) ? "video" : /^image\//.test(f.type) ? "image" : null;
      if (!kind) return Promise.resolve(null);
      var rec = { id: Store.uid(), name: f.name.replace(/\.[^.]+$/, ""), kind: kind, blob: f, created: Date.now() };
      return Store.put("media", rec).then(function () {
        var m = { id: rec.id, name: rec.name, kind: kind, blob: f, url: URL.createObjectURL(f) };
        media.push(m); return m;
      });
    });
    return Promise.all(jobs).then(function (r) { r = r.filter(Boolean); renderMedia(); toast(r.length + " file(s) added"); return r; })
      .catch(function (e) { toast("Could not store media: " + e.message); return []; });
  }

  /* ------------------------------------------------------------------ */
  /* Themes                                                              */
  /* ------------------------------------------------------------------ */
  var FONTS = ["DM Sans", "Montserrat", "Oswald", "Merriweather", "Lora", "Playfair Display", "Georgia", "Arial", "Verdana", "Times New Roman"];
  function renderThemeForm() {
    var t = themes[ui.themeKey];
    var f = $("#themeForm");
    var sel = function (name, opts, val) { return '<select name="' + name + '">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(String(v)) + '"' + (String(v) === String(val) ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") + "</select>"; };
    f.innerHTML =
      "<label>Font " + sel("font", FONTS, t.font) + "</label>" +
      '<label>Max size <input type="range" name="size" min="30" max="160" value="' + t.size + '"></label>' +
      '<label>Text colour <input type="color" name="color" value="' + t.color + '"></label>' +
      '<label>Reference colour <input type="color" name="refColor" value="' + t.refColor + '"></label>' +
      '<label>Reference size <input type="range" name="refSize" min="20" max="90" value="' + t.refSize + '"></label>' +
      "<label>Reference at " + sel("refPosition", [["bottom", "Bottom"], ["top", "Top"]], t.refPosition) + "</label>" +
      "<label>Align " + sel("align", [["left", "Left"], ["center", "Center"], ["right", "Right"]], t.align) + "</label>" +
      "<label>Vertical " + sel("valign", [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], t.valign) + "</label>" +
      '<label>Line height <input type="range" name="lineHeight" min="1" max="1.8" step="0.05" value="' + t.lineHeight + '"></label>' +
      '<label>Margins <input type="range" name="padding" min="20" max="300" value="' + t.padding + '"></label>' +
      '<label>Darken background <input type="range" name="dim" min="0" max="0.9" step="0.05" value="' + t.dim + '"></label>' +
      '<label>Background <select name="bg">' + bgOptions(t.bg) + "</select></label>" +
      '<label>Bold <input type="checkbox" name="bold"' + (t.bold ? " checked" : "") + "></label>" +
      '<label>Italic <input type="checkbox" name="italic"' + (t.italic ? " checked" : "") + "></label>" +
      '<label>UPPERCASE <input type="checkbox" name="uppercase"' + (t.uppercase ? " checked" : "") + "></label>" +
      '<label>Shadow <input type="checkbox" name="shadow"' + (t.shadow ? " checked" : "") + "></label>" +
      '<label>Outline <input type="checkbox" name="outline"' + (t.outline ? " checked" : "") + "></label>" +
      '<label><button type="button" data-act="themeReset">Reset theme</button></label>';
    renderThemePreview();
  }
  function renderThemePreview() {
    var t = themes[ui.themeKey];
    var sample = ui.themeKey === "scripture"
      ? { type: "scripture", text: "[16] " + bible().text(42, 3, 16), ref: "John 3:16" + (settings.showVersion ? " " + bible().id : ""), verseNums: true }
      : ui.themeKey === "song" ? { type: "text", text: "We lift our eyes as morning breaks\nYour mercy new on every face" }
      : { type: "text", text: "Welcome to church!\nWe're glad you're here" };
    sample.theme = t; sample.bgResolved = resolveBg(t.bg);
    themeStage.render({ slide: sample });
  }
  function refreshOpenItems() {
    if (ui.preview) { ui.preview.slides = buildSlides(ui.preview.item); ui.preview.index = Math.min(ui.preview.index, ui.preview.slides.length - 1); renderPreview(); }
    if (ui.live) { ui.live.slides = buildSlides(ui.live.item); ui.live.index = Math.min(ui.live.index, ui.live.slides.length - 1); renderLive(); pushOutput(); }
  }

  /* ------------------------------------------------------------------ */
  /* AI Verse Assistant                                                  */
  /* ------------------------------------------------------------------ */
  var listener = new Listener({
    getBible: bible,
    getContext: function () { return settings.aiFollow ? ui.lastScripture : null; }
  });
  var detections = [];
  var transcriptFinal = "";

  function syncListenerOpts() {
    listener.opts.quotes = settings.aiQuotes;
    listener.opts.interim = settings.aiInterim;
    listener.opts.cooldownMs = +settings.aiCooldown;
    if (listener.opts.lang !== settings.aiLang) listener.setLang(settings.aiLang);
  }

  listener.onStatus = function (text, level) {
    var s = $("#aiStatus"); s.textContent = text; s.className = "ai-status " + (level || "");
    if (level === "error" || level === "idle") setMicUI(false);
  };
  listener.onTranscript = function (t) {
    transcriptFinal = t.final;
    renderTranscript(t.interim);
  };
  function renderTranscript(interim) {
    var box = $("#transcript");
    var fin = transcriptFinal.slice(-1500);
    var html = esc(fin);
    // highlight detected references in the transcript
    detections.slice(0, 8).forEach(function (d) {
      if (!d.label) return;
      var name = Books.list[d.ref.book] ? Books.list[d.ref.book].name.replace(/^\d /, "") : "";
      if (!name) return;
      html = html.replace(new RegExp("(" + name + "[^.!?]{0,40}?\\d+)", "i"), "<mark>$1</mark>");
    });
    box.innerHTML = (html || '<span class="muted">Transcript appears here…</span>') + (interim ? ' <span class="interim">' + esc(interim) + "</span>" : "");
    box.scrollTop = box.scrollHeight;
  }

  listener.onDetect = function (d) { handleDetection(d); };

  function handleDetection(d) {
    if (d.kind === "nav") {
      d.direction = d.direction || (d.ref && d.ref.direction) || 1;
      if (ui.live && ui.live.item.kind === "scripture" && settings.aiMode === "live") { step(d.direction); flashStatus((d.direction > 0 ? "Next" : "Previous") + " verse"); }
      else if (ui.lastScripture) {
        var r = { book: ui.lastScripture.book, chapter: ui.lastScripture.chapter, verse: ui.lastScripture.verse + d.direction, verseEnd: null };
        var vc = bible().verseCount(r.book, r.chapter);
        if (r.verse >= 1 && r.verse <= vc) handleDetection({ ref: r, kind: "context", confidence: 0.9, heard: d.heard });
      }
      return;
    }
    var ref = d.ref;
    var label = Ref.format(ref);
    var b = bible();
    var firstVerse = ref.verse || 1;
    var det = {
      id: Store.uid(), ref: { book: ref.book, chapter: ref.chapter, verse: ref.verse, verseEnd: ref.verseEnd },
      label: label, kind: d.kind, confidence: d.confidence, heard: d.heard, time: Date.now(),
      text: b.text(ref.book, ref.chapter, firstVerse), status: ""
    };
    detections.unshift(det);
    detections = detections.slice(0, 40);

    var strong = d.confidence >= 0.8;
    var mode = settings.aiMode;
    if (strong && mode === "live") { acceptDetection(det, "live"); }
    else if (strong && mode === "preview") { acceptDetection(det, "preview"); }
    else { renderDetections(); flashStatus("Suggested " + label + (strong ? "" : " (low confidence – check before showing)")); }
    renderTranscript("");
  }

  function detectionItem(det) {
    // Same chapter already live? just jump to the verse — feels instant.
    var single = det.ref.verse != null && det.ref.verseEnd == null;
    var toEnd = single && settings.aiRest;
    return scriptureItem(det.ref, toEnd || det.ref.verse == null);
  }

  function acceptDetection(det, how) {
    if (how === "live" && ui.live && ui.live.item.kind === "scripture" && det.ref.verse != null && det.ref.verseEnd == null &&
        ui.live.item.version === settings.version) {
      var idx = ui.live.slides.findIndex(function (s) { return s.book === det.ref.book && s.chapter === det.ref.chapter && s.verse <= det.ref.verse && s.verseEnd >= det.ref.verse; });
      if (idx >= 0) { setLiveIndex(idx); det.status = "live"; renderDetections(); flashStatus("Live: " + det.label); return; }
    }
    var item = detectionItem(det);
    if (how === "schedule") { addToSchedule(item); det.status = "added"; }
    else if (how === "preview") { setPreview(item, 0); det.status = "preview"; flashStatus("In preview: " + det.label + " — press Enter to show"); }
    else { setPreview(item, 0); goLive(item, 0); det.status = "live"; flashStatus("Live: " + det.label); }
    renderDetections();
  }

  function renderDetections() {
    var host = $("#detections");
    if (!detections.length) { host.innerHTML = '<div class="empty-note">Nothing detected yet.</div>'; return; }
    host.innerHTML = "";
    detections.forEach(function (det, i) {
      var c = document.createElement("div");
      c.className = "det" + (i === 0 && Date.now() - det.time < 8000 ? " new" : "") + (det.confidence < 0.8 ? " low" : "");
      var kindLabel = { reference: "Said", context: "Follow-up", quote: "Quoted" }[det.kind] || det.kind;
      c.innerHTML = '<div class="det-top"><span class="det-ref">' + esc(det.label) + "</span>" +
        (det.status === "live" ? '<span class="badge live">on screen</span>' : det.status ? '<span class="badge">' + det.status + "</span>" : "") +
        '<span class="badge ' + det.kind + '">' + kindLabel + '</span><span class="conf" title="confidence ' + Math.round(det.confidence * 100) + '%"><i style="width:' + Math.round(det.confidence * 100) + '%"></i></span></div>' +
        '<div class="det-text">' + esc(det.text) + "</div>" +
        (det.heard ? '<div class="det-heard">heard: “' + esc(det.heard) + "”</div>" : "") +
        '<div class="det-actions"><button class="primary" data-a="live">Show live</button><button data-a="preview">Preview</button><button data-a="schedule">+ Schedule</button></div>';
      c.querySelectorAll("button").forEach(function (btn) { btn.onclick = function () { acceptDetection(det, btn.dataset.a); }; });
      host.appendChild(c);
    });
  }
  function flashStatus(text) {
    var s = $("#aiStatus"); s.textContent = text; s.className = "ai-status ok";
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(function () { if (listener.running) { s.textContent = "Listening…"; } }, 5000);
  }
  function setMicUI(on) {
    $("#micBtn").classList.toggle("on", on);
    $("#micLabel").textContent = on ? "Listening — click to stop" : "Start listening";
  }
  function toggleMic() {
    if (listener.running) { listener.stop(); setMicUI(false); return; }
    syncListenerOpts();
    var env = Listener.checkEnvironment();
    if (!Listener.supported) {
      listener.onStatus(env.problems[0].msg + " " + env.problems[0].fix + " You can still test with the box below.", "error");
      return;
    }
    if (location.protocol === "file:") {
      listener.onStatus(env.problems.filter(function (p) { return /file/.test(p.msg); })[0].msg + " " + "Close this window and start OnStage Worship with “Start OnStage Worship.bat” (Windows) or the Mac .command file.", "error");
      return;
    }
    setMicUI(true);
    listener.start().then(function (ok) {
      if (!ok) { setMicUI(false); return; }
      if (!env.good && env.problems.length) toast(env.problems[0].fix);
      bible().buildIndex();
      meterLoop();
    });
  }
  function meterLoop() {
    var bar = $("#micLevel");
    (function f() {
      bar.style.width = Math.round((listener.level || 0) * 100) + "%";
      if (listener.stream) requestAnimationFrame(f); else bar.style.width = "0";
    })();
  }
  function micCheck() {
    modal("Microphone check", '<p class="muted">Say a few words — for example “John 3 16” — while the test runs (about 10 seconds).</p><ul class="checks" id="checks"><li><span class="st warn">…</span><div><b>Testing…</b></div></li></ul>',
      [{ label: "Close" }]);
    if (location.protocol === "file:") {
      $("#checks").innerHTML = checkRow({ name: "How the app was opened", ok: false, detail: "Opened directly from a file, which blocks the microphone.", fix: "Close this window and double-click “Start OnStage Worship.bat” (Windows) or the Mac .command file instead." });
      return;
    }
    var poll = setInterval(function () { if (listener.stream) $("#micLevel").style.width = Math.round(listener.level * 100) + "%"; }, 60);
    listener.diagnose().then(function (checks) {
      clearInterval(poll); $("#micLevel").style.width = "0";
      var bad = checks.filter(function (c) { return !c.ok; }).length;
      var el = $("#checks"); if (!el) return;
      el.innerHTML = checks.map(checkRow).join("") +
        (bad ? "" : '<li><span class="st ok">✓</span><div><b>All good</b>Press <b>Start listening</b> and the AI will follow the sermon.</div></li>');
    });
  }
  function checkRow(c) {
    var cls = !c.ok ? "bad" : c.warn ? "warn" : "ok";
    return '<li><span class="st ' + cls + '">' + (!c.ok ? "✕" : c.warn ? "!" : "✓") + "</span><div><b>" + esc(c.name) + "</b>" + esc(c.detail || "") +
      (c.fix ? '<div class="fix">How to fix: ' + esc(c.fix) + "</div>" : "") + "</div></li>";
  }
  function renderAiOpts() {
    $$("#aiMode button").forEach(function (b) { b.classList.toggle("on", b.dataset.mode === settings.aiMode); });
    $("#optQuotes").checked = settings.aiQuotes; $("#optInterim").checked = settings.aiInterim;
    $("#optFollow").checked = settings.aiFollow; $("#optRest").checked = settings.aiRest;
    $("#optLang").value = settings.aiLang; $("#optCooldown").value = String(settings.aiCooldown);
  }

  /* ------------------------------------------------------------------ */
  /* Modals                                                              */
  /* ------------------------------------------------------------------ */
  function modal(title, body, buttons) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    var foot = $("#modalFoot"); foot.innerHTML = "";
    (buttons || [{ label: "Close" }]).forEach(function (b) {
      var btn = document.createElement("button");
      btn.textContent = b.label; if (b.primary) btn.className = "primary";
      btn.onclick = function () { if (b.fn && b.fn() === false) return; if (!b.keep) closeModal(); };
      foot.appendChild(btn);
    });
    $("#modalBg").classList.add("open");
    var f = $("#modalBody input, #modalBody textarea"); if (f) setTimeout(function () { f.focus(); }, 30);
  }
  function closeModal() { $("#modalBg").classList.remove("open"); }

  function pickFile(accept, multiple) {
    return new Promise(function (resolve) {
      var inp = $("#fileInput");
      inp.value = ""; inp.accept = accept || ""; inp.multiple = !!multiple;
      inp.onchange = function () { resolve(inp.files); };
      inp.click();
    });
  }
  function readText(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); }); }
  function download(name, obj) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */
  function selectedScheduleIndex() { return schedule.findIndex(function (s) { return s.id === ui.selItem; }); }
  var ACTIONS = {
    newSchedule: function () {
      if (schedule.length && !confirm("Start a new, empty schedule?")) return;
      schedule = []; ui.selItem = null; renderSchedule(); saveSoon();
    },
    openSchedule: function () {
      pickFile(".json,application/json").then(function (fs) {
        if (!fs || !fs[0]) return;
        readText(fs[0]).then(function (t) {
          try {
            var d = JSON.parse(t);
            (d.songs || []).forEach(function (s) { if (!songById(s.id)) songs.push(s); });
            (d.presentations || []).forEach(function (p) { if (!presById(p.id)) presentations.push(p); });
            schedule = d.schedule || d.items || [];
            renderSchedule(); renderSongs(); renderPres(); saveSoon(); toast("Schedule opened");
          } catch (e) { toast("That file is not an OnStage schedule"); }
        });
      });
    },
    saveSchedule: function () {
      var used = {}; schedule.forEach(function (it) { if (it.songId) used[it.songId] = 1; if (it.presId) used[it.presId] = 1; });
      download("service-" + new Date().toISOString().slice(0, 10) + ".onstage.json", {
        app: "OnStage Worship", type: "schedule", saved: new Date().toISOString(), schedule: schedule,
        songs: songs.filter(function (s) { return used[s.id]; }), presentations: presentations.filter(function (p) { return used[p.id]; })
      });
    },
    openOutput: function () { openWindow(false); },
    openStage: function () { openWindow(true); },
    toggleBlack: function () { ui.black = !ui.black; pushOutput(); },
    toggleClear: function () { ui.clear = !ui.clear; pushOutput(); },
    toggleLogo: function () {
      if (!settings.logoMediaId) { toast("Choose a logo in Media → “Use as logo”"); }
      ui.logo = !ui.logo; pushOutput();
    },
    clearLive: function () { ui.live = null; ui.black = false; ui.clear = false; ui.logo = false; renderLive(); pushOutput(); },
    goLive: function () { if (ui.preview) goLive(ui.preview.item, ui.preview.index); },
    moveUp: function () { var i = selectedScheduleIndex(); if (i > 0) { schedule.splice(i - 1, 0, schedule.splice(i, 1)[0]); renderSchedule(); saveSoon(); } },
    moveDown: function () { var i = selectedScheduleIndex(); if (i >= 0 && i < schedule.length - 1) { schedule.splice(i + 1, 0, schedule.splice(i, 1)[0]); renderSchedule(); saveSoon(); } },
    removeItem: function () { var i = selectedScheduleIndex(); if (i >= 0) { schedule.splice(i, 1); ui.selItem = schedule[i] ? schedule[i].id : (schedule[i - 1] || {}).id; renderSchedule(); saveSoon(); } },
    videoPlay: function () { ui.videoCmd = { id: Store.uid(), action: "play" }; pushOutput(); },
    videoPause: function () { ui.videoCmd = { id: Store.uid(), action: "pause" }; pushOutput(); },
    videoRestart: function () { ui.videoCmd = { id: Store.uid(), action: "restart" }; pushOutput(); },
    toggleMic: toggleMic,
    micCheck: micCheck,
    clearDetections: function () { detections = []; renderDetections(); },
    closeModal: closeModal,

    bPreview: bPreview, bLive: bLive,
    bAdd: function () { addToSchedule(scriptureItem(bRef())); },

    songNew: function () { editSong(null); },
    songEdit: function () { var s = songById(ui.selSong); if (s) editSong(s); else toast("Select a song first"); },
    songDelete: function () {
      var s = songById(ui.selSong); if (!s || !confirm("Delete “" + s.title + "”?")) return;
      songs = songs.filter(function (x) { return x !== s; }); ui.selSong = null; saveSoon(); renderSongs();
    },
    songPreview: function () { var s = songById(ui.selSong); if (s) setPreview(songItem(s)); },
    songLive: function () { var s = songById(ui.selSong); if (s) { var it = songItem(s); setPreview(it); goLive(it, 0); } },
    songAdd: function () { var s = songById(ui.selSong); if (s) addToSchedule(songItem(s)); else toast("Select a song first"); },
    songImport: function () {
      pickFile(".txt,.json,text/plain,application/json", true).then(function (fs) {
        Promise.all(Array.prototype.map.call(fs || [], function (f) {
          return readText(f).then(function (t) {
            if (/\.json$/i.test(f.name)) {
              var d = JSON.parse(t); var arr = Array.isArray(d) ? d : (d.songs || []);
              arr.forEach(function (s) { if (s.title && s.lyrics) { s.id = s.id || Store.uid(); if (!songById(s.id)) songs.push(s); } });
              return arr.length;
            }
            var lines = t.replace(/\r/g, "").split("\n");
            var title = f.name.replace(/\.[^.]+$/, "");
            if (lines[0] && lines[1] === "") { title = lines[0].trim(); lines = lines.slice(2); }
            songs.push({ id: Store.uid(), title: title, author: "", copyright: "", ccli: "", lyrics: lines.join("\n").trim() });
            return 1;
          });
        })).then(function (n) { saveSoon(); renderSongs(); toast("Imported " + n.reduce(function (a, b) { return a + b; }, 0) + " song(s)"); })
          .catch(function () { toast("Could not import that file"); });
      });
    },
    songExport: function () { download("onstage-songs.json", { app: "OnStage Worship", type: "songs", songs: songs }); },

    mediaUpload: function () { pickFile("image/*,video/*", true).then(function (fs) { if (fs && fs.length) uploadMedia(fs); }); },
    mediaPreview: function () { mediaAct("preview"); },
    mediaLive: function () { mediaAct("live"); },
    mediaAdd: function () { mediaAct("schedule"); },
    bgSongs: function () { if (!ui.selMedia) return toast("Select a background"); themes.song.bg = ui.selMedia; saveSoon(); renderMedia(); refreshOpenItems(); toast("Song background set"); },
    bgScripture: function () { if (!ui.selMedia) return toast("Select a background"); themes.scripture.bg = ui.selMedia; saveSoon(); renderMedia(); refreshOpenItems(); toast("Scripture background set"); },
    bgLogo: function () {
      if (!ui.selMedia || ui.selMedia.indexOf("media:") !== 0) return toast("Upload and select an image to use as the logo");
      settings.logoMediaId = ui.selMedia.slice(6); saveSoon(); renderMedia(); pushOutput(); toast("Logo set — press L to show it");
    },
    mediaDelete: function () {
      if (!ui.selMedia || ui.selMedia.indexOf("media:") !== 0) return toast("Built-in backgrounds can't be deleted");
      var id = ui.selMedia.slice(6), m = mediaById(id);
      if (!m || !confirm("Delete “" + m.name + "”?")) return;
      Store.del("media", id).then(function () { media = media.filter(function (x) { return x.id !== id; }); ui.selMedia = null; renderMedia(); });
    },

    presNew: function () { editPres(null); },
    presEdit: function () { var p = presById(ui.selPres); if (p) editPres(p); else toast("Select a presentation"); },
    presDelete: function () {
      var p = presById(ui.selPres); if (!p || !confirm("Delete “" + p.title + "”?")) return;
      presentations = presentations.filter(function (x) { return x !== p; }); ui.selPres = null; saveSoon(); renderPres();
    },
    presPreview: function () { var p = presById(ui.selPres); if (p) setPreview(presItem(p)); },
    presLive: function () { var p = presById(ui.selPres); if (p) { var it = presItem(p); setPreview(it); goLive(it, 0); } },
    presAdd: function () { var p = presById(ui.selPres); if (p) addToSchedule(presItem(p)); else toast("Select a presentation"); },
    presImages: function () {
      pickFile("image/*", true).then(function (fs) {
        if (!fs || !fs.length) return;
        var sorted = Array.prototype.slice.call(fs).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
        uploadMedia(sorted).then(function (ms) {
          if (!ms.length) return;
          var p = { id: Store.uid(), title: (prompt("Presentation name", "Imported slides") || "Imported slides"), images: ms.map(function (m) { return m.id; }) };
          presentations.push(p); ui.selPres = p.id; saveSoon(); renderPres();
        });
      });
    },

    themeReset: function () {
      var base = { song: { bg: "grad:0", size: 84 }, scripture: { bg: "grad:4", size: 70, align: "left", font: "Merriweather", bold: false, lineHeight: 1.4 }, presentation: { bg: "grad:5", size: 90 } }[ui.themeKey];
      themes[ui.themeKey] = Object.assign({}, R.DEFAULT_THEME, base); saveSoon(); renderThemeForm(); refreshOpenItems();
    },

    bibleImport: function () {
      pickFile(".json,application/json").then(function (fs) {
        if (!fs || !fs[0]) return;
        readText(fs[0]).then(function (t) {
          try {
            var id = (prompt("Short name for this version (e.g. ESV, NKJV)", fs[0].name.replace(/\.[^.]+$/, "").toUpperCase()) || "").trim().toUpperCase();
            if (!id) return;
            var data = BibleReg.fromJSON(JSON.parse(t), id, id);
            BibleReg.add(data);
            Store.put("bibles", data).catch(function () {});
            fillVersions(); toast(id + " imported");
          } catch (e) { toast("Import failed: " + e.message); }
        });
      });
    },
    backupExport: function () {
      download("onstage-backup-" + new Date().toISOString().slice(0, 10) + ".json", { app: "OnStage Worship", type: "backup", settings: settings, themes: themes, songs: songs, presentations: presentations, schedule: schedule });
    },
    backupImport: function () {
      pickFile(".json,application/json").then(function (fs) {
        if (!fs || !fs[0]) return;
        readText(fs[0]).then(function (t) {
          try {
            var d = JSON.parse(t);
            if (d.type !== "backup") throw new Error("not a backup file");
            if (!confirm("Replace your songs, presentations, themes and schedule with this backup?")) return;
            settings = Object.assign(settings, d.settings || {}); themes = d.themes || themes; songs = d.songs || songs;
            presentations = d.presentations || presentations; schedule = d.schedule || schedule;
            saveAll(); location.reload();
          } catch (e) { toast("Restore failed: " + e.message); }
        });
      });
    },

    messages: function () {
      modal("Alerts & stage messages",
        '<div class="form"><label class="full">Scrolling alert on the main screen (e.g. nursery call, car lights)<input id="fAlert" value="' + esc(ui.alert.text) + '" placeholder="Parent of child #42, please come to the nursery"></label>' +
        '<label class="full">Message on the stage display only (preacher / band)<input id="fStage" value="' + esc(ui.stageMessage) + '" placeholder="5 minutes left"></label></div>',
        [{ label: "Hide all", fn: function () { ui.alert = { text: ui.alert.text, on: false }; ui.stageMessage = ""; pushOutput(); } },
         { label: "Show", primary: true, fn: function () { ui.alert = { text: $("#fAlert").value.trim(), on: !!$("#fAlert").value.trim() }; ui.stageMessage = $("#fStage").value.trim(); pushOutput(); } }]);
    },
    countdown: function () {
      modal("Countdown timer",
        '<div class="form"><label>Minutes<input id="fMin" type="number" min="1" max="600" value="5"></label><label>…or count down to a time<input id="fAt" type="time"></label>' +
        '<label class="full">Label<input id="fLbl" value="Service begins in"></label></div>',
        [{ label: "Add to schedule", fn: function () { addToSchedule(countdownItem(false)); } },
         { label: "Start now (live)", primary: true, fn: function () { var it = countdownItem(true); setPreview(it); goLive(it, 0); } }]);
    },
    help: function () {
      modal("OnStage Worship — help",
        '<p class="muted">Build your service in the <b>Schedule</b>, check slides in <b>Preview</b> and drive the projector from <b>Live</b>. Click <b>▣ Output</b> and drag that window onto the projector, then double-click it for full screen.</p>' +
        "<table>" + [["→ ↓ Space PgDn", "Next slide (moves on to the next schedule item at the end)"], ["← ↑ PgUp", "Previous slide"], ["1 – 9", "Jump to slide number in Live"], ["Enter", "Send Preview to Live"],
          ["B", "Black screen"], ["C", "Clear text (keep background)"], ["L", "Show logo"], ["Esc", "Clear live"], ["M", "Start / stop AI listening"], ["A", "Show the newest AI suggestion live"], ["Ctrl+S", "Save schedule"]]
          .map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</table>" +
        '<h3>AI Verse Assistant</h3><p class="muted">Press <b>Start listening</b> and point a microphone (or an audio feed from the desk) at the preacher. When a verse is mentioned — “John chapter three verse sixteen”, “Romans 8:28”, “first Corinthians thirteen four through seven” — it is put on screen automatically. ' +
        "It also recognises verses that are read aloud without a reference, and follow-ups like “verse 17” or “next verse”. Choose <b>Auto live</b>, <b>Auto preview</b> (you press Enter) or <b>Suggest only</b>. " +
        "Chapter-only mentions (“Mark 1”) are never shown automatically; they appear as suggestions.</p>" +
        '<p class="muted">Speech recognition uses the browser’s built-in engine: use Google Chrome or Microsoft Edge and open the app over <code>http://localhost</code> or <code>https://</code>. Audio is processed by the browser’s speech service.</p>');
    }
  };
  function countdownItem(now) {
    var at = $("#fAt").value, mins = Math.max(1, +$("#fMin").value || 5), label = $("#fLbl").value.trim();
    var it = { id: Store.uid(), kind: "countdown", minutes: mins, label: label, title: "Countdown " + (at || mins + " min") };
    if (at) {
      var t = new Date(); var p = at.split(":"); t.setHours(+p[0], +p[1], 0, 0); if (t < new Date()) t.setDate(t.getDate() + 1);
      it.target = t.getTime(); it.fixedTime = true;
    } else if (now) it.target = Date.now() + mins * 60000;
    return it;
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                            */
  /* ------------------------------------------------------------------ */
  function handleKey(e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
      if (e.key === "Escape") t.blur();
      return;
    }
    if ($("#modalBg").classList.contains("open")) { if (e.key === "Escape") closeModal(); return; }
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "S")) { e.preventDefault(); ACTIONS.saveSchedule(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") { e.preventDefault(); step(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { e.preventDefault(); step(-1); }
    else if (k === "Enter") { e.preventDefault(); ACTIONS.goLive(); }
    else if (k === "b" || k === "B" || k === ".") ACTIONS.toggleBlack();
    else if (k === "c" || k === "C") ACTIONS.toggleClear();
    else if (k === "l" || k === "L") ACTIONS.toggleLogo();
    else if (k === "Escape") ACTIONS.clearLive();
    else if (k === "m" || k === "M") toggleMic();
    else if (k === "a" || k === "A") { if (detections[0]) acceptDetection(detections[0], "live"); }
    else if (/^[1-9]$/.test(k) && ui.live) setLiveIndex(+k - 1);
  }

  /* ------------------------------------------------------------------ */
  /* Wire up                                                             */
  /* ------------------------------------------------------------------ */
  function init() {
    previewStage = R.createStage($("#previewMonitor"), { muted: true });
    liveStage = R.createStage($("#liveMonitor"), { muted: true });
    themeStage = R.createStage($("#themeMonitor"), { muted: true });

    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-act]");
      if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); ACTIONS[el.dataset.act](); }
    });
    document.addEventListener("keydown", handleKey);
    $("#modalBg").addEventListener("mousedown", function (e) { if (e.target === this) closeModal(); });

    // tabs
    $$("#tabs button").forEach(function (b) {
      b.onclick = function () {
        $$("#tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
        $$(".tab").forEach(function (t) { t.classList.toggle("on", t.dataset.tab === b.dataset.tab); });
        if (b.dataset.tab === "themes") { renderThemeForm(); setTimeout(themeStage.scale, 0); }
        if (b.dataset.tab === "media") renderMedia();
      };
    });

    // scripture
    fillVersions(); fillBooks();
    $("#bVersion").onchange = function () { settings.version = this.value; saveSoon(); setBibleSel({ book: ui.bibleSel.book, chapter: Math.min(ui.bibleSel.chapter, bible().chapterCount(ui.bibleSel.book)) }); };
    $("#bBook").onchange = function () { setBibleSel({ book: +this.value, chapter: 1 }); };
    $("#bChapter").onchange = function () { setBibleSel({ book: ui.bibleSel.book, chapter: +this.value }); };
    $("#bFrom").onchange = function () { var f = +this.value; setBibleSel({ book: ui.bibleSel.book, chapter: ui.bibleSel.chapter, verse: f, verseEnd: Math.max(f, ui.bibleSel.to) }); bPreview(); };
    $("#bTo").onchange = function () { setBibleSel({ book: ui.bibleSel.book, chapter: ui.bibleSel.chapter, verse: ui.bibleSel.from, verseEnd: Math.max(ui.bibleSel.from, +this.value) }); bPreview(); };
    $("#bQuick").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var r = bible().parse(this.value);
      if (!r) { toast("Couldn't find that reference"); return; }
      setBibleSel(r);
      if (r.verse != null) { if (e.shiftKey) bLive(); else bPreview(); }
    });
    $("#bSearchForm").onsubmit = function (e) {
      e.preventDefault();
      var q = $("#bSearch").value.trim(); if (!q) return;
      var res = bible().search(q, 300);
      var host = $("#bVerses");
      host.innerHTML = '<div class="empty-note">' + res.length + (res.length >= 300 ? "+" : "") + " result(s) for “" + esc(q) + "”</div>";
      res.forEach(function (v) {
        var d = document.createElement("div"); d.className = "verse res";
        d.innerHTML = "<b>" + esc(Ref.format(v)) + "</b><span>" + esc(v.text) + "</span>";
        d.onclick = function () { setBibleSel(v, false); bPreview(); };
        d.ondblclick = function () { setBibleSel(v, false); bLive(); };
        host.appendChild(d);
      });
    };
    setBibleSel({ book: 42, chapter: 3, verse: 16 });

    // songs / presentations lists
    $("#songSearch").oninput = renderSongs;
    $("#songList").onclick = function (e) { var li = e.target.closest("li[data-id]"); if (li) { ui.selSong = li.dataset.id; renderSongs(); ACTIONS.songPreview(); } };
    $("#songList").ondblclick = function (e) { if (e.target.closest("li[data-id]")) ACTIONS.songAdd(); };
    $("#presList").onclick = function (e) { var li = e.target.closest("li[data-id]"); if (li) { ui.selPres = li.dataset.id; renderPres(); ACTIONS.presPreview(); } };
    $("#presList").ondblclick = function (e) { if (e.target.closest("li[data-id]")) ACTIONS.presAdd(); };
    presentations = presentations.filter(function (p) { return !p.hidden; });

    // themes
    $$("#themePick button").forEach(function (b) { b.onclick = function () { ui.themeKey = b.dataset.theme; $$("#themePick button").forEach(function (x) { x.classList.toggle("on", x === b); }); renderThemeForm(); }; });
    $("#themeForm").addEventListener("input", function (e) {
      var el = e.target; if (!el.name) return;
      var t = themes[ui.themeKey];
      t[el.name] = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
      renderThemePreview(); saveSoon(); refreshOpenItemsSoon(); renderMedia();
    });

    // settings
    var bind = function (sel, key, kind) {
      var el = $(sel);
      if (kind === "chk") el.checked = !!settings[key]; else el.value = settings[key];
      el.addEventListener("change", function () {
        settings[key] = kind === "chk" ? el.checked : kind === "num" ? +el.value : el.value;
        saveSoon(); refreshOpenItems(); syncListenerOpts(); renderAiOpts();
      });
    };
    bind("#sVps", "vps", "num"); bind("#sMaxChars", "maxChars", "num"); bind("#sVerseNums", "verseNums", "chk"); bind("#sShowVersion", "showVersion", "chk");
    bind("#sLines", "lines", "num"); bind("#sCopyright", "copyright", "chk"); bind("#sCcli", "ccli");
    bind("#optQuotes", "aiQuotes", "chk"); bind("#optInterim", "aiInterim", "chk"); bind("#optFollow", "aiFollow", "chk"); bind("#optRest", "aiRest", "chk");
    bind("#optLang", "aiLang"); bind("#optCooldown", "aiCooldown", "num");
    $$("#aiMode button").forEach(function (b) { b.onclick = function () { settings.aiMode = b.dataset.mode; saveSoon(); renderAiOpts(); }; });
    renderAiOpts();

    $("#simForm").onsubmit = function (e) {
      e.preventDefault();
      var v = $("#simInput").value.trim(); if (!v) return;
      transcriptFinal = (transcriptFinal + " " + v).slice(-4000);
      listener.process(v, true, "sim:" + Date.now());
      renderTranscript("");
      $("#simInput").value = "";
    };

    renderSchedule(); renderSongs(); renderPres(); renderPreview(); renderLive(); renderDetections();
    var env0 = Listener.checkEnvironment();
    if (env0.problems.length) {
      var st = $("#aiStatus");
      st.className = "ai-status warn";
      st.textContent = "⚠ " + env0.problems[0].msg + " " + env0.problems[0].fix;
    }

    // Async: imported Bibles, media
    Store.all("bibles").then(function (rows) { rows.forEach(function (b) { BibleReg.add(b); }); fillVersions(); }).catch(function () {});
    loadMedia().then(function () { renderMedia(); refreshOpenItems(); pushOutput(); });
    pushOutput();
    // Build the quote index when idle so the first detection is instant.
    setTimeout(function () {
      if (window.requestIdleCallback) requestIdleCallback(function () { bible().buildIndex(); });
      else bible().buildIndex();
    }, 1500);
  }
  var refreshOpenItemsSoon = debounce(refreshOpenItems, 150);

  // expose for debugging/tests
  window.OnStageApp = { ui: ui, process: function (t) { listener.process(t, true, "api:" + Date.now()); }, handleDetection: handleDetection, settings: settings };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
