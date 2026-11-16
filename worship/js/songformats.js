/*
 * OnStage Worship — song file importers.
 * Reads the lyric formats churches get from licensed sources:
 *   - CCLI SongSelect plain text (.txt) and SongSelect import files (.usr)
 *   - ChordPro (.cho .chordpro .chopro .pro .crd)
 *   - OpenLyrics XML (.xml) – used by OpenLP, Worship Extreme and others
 *   - plain text, and OnStage .json song libraries
 * Each parser returns [{title, author, copyright, ccli, lyrics}] where lyrics
 * use OnStage's "[Section]" + blank-line format.
 */
(function (root) {
  var SECTION_RE = /^(verse|chorus|refrain|bridge|pre-?chorus|tag|ending|intro|outro|interlude|instrumental|misc|vamp|turnaround|coda|chant|channel|hook|post-?chorus)(\s*\d+[a-z]?)?\s*:?$/i;

  function clean(s) { return String(s || "").replace(/\r/g, "").replace(/ /g, " "); }
  function titleCase(s) { return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function block(label, lines) { return (label ? "[" + label + "]\n" : "") + lines.join("\n"); }

  /* CCLI SongSelect "Lyrics" .txt download */
  function parseSongSelectText(text, fallbackTitle) {
    var lines = clean(text).split("\n");
    var i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    var title = (lines[i] || fallbackTitle || "Untitled").trim();
    i++;
    var song = { title: title, author: "", copyright: "", ccli: "", lyrics: "" };
    var blocks = [], cur = null, footer = false;
    for (; i < lines.length; i++) {
      var l = lines[i].trim();
      var cm = l.match(/^CCLI Song\s*#?\s*(\d+)/i);
      if (cm) { song.ccli = cm[1]; footer = true; continue; }
      if (footer) {
        if (/^(©|\(c\)|copyright)/i.test(l)) song.copyright = l.replace(/^(©|\(c\)|copyright)\s*/i, "© ");
        else if (/For use solely|CCLI Licen[cs]e|Terms of Use|songselect/i.test(l)) { /* skip */ }
        else if (l && !song.author) song.author = l.replace(/\s*\|\s*/g, ", ");
        continue;
      }
      if (!l) { cur = null; continue; }
      if (!cur && SECTION_RE.test(l)) { cur = { label: titleCase(l.replace(/:$/, "")), lines: [] }; blocks.push(cur); continue; }
      if (!cur) { cur = { label: "", lines: [] }; blocks.push(cur); }
      cur.lines.push(l);
    }
    song.lyrics = blocks.filter(function (b) { return b.lines.length; }).map(function (b) { return block(b.label, b.lines); }).join("\n\n");
    return [song];
  }

  /* CCLI SongSelect .usr import file (INI-style) */
  function parseUSR(text) {
    var t = clean(text), get = function (k) { var m = t.match(new RegExp("^" + k + "=(.*)$", "mi")); return m ? m[1].trim() : ""; };
    var ccli = (t.match(/^\[S\s+A?(\d+)\]/mi) || [])[1] || "";
    var fields = get("Fields").split("/t");
    var words = get("Words").split("/t");
    var blocks = words.map(function (w, i) {
      var ls = w.split("/n").map(function (x) { return x.trim(); }).filter(Boolean);
      return ls.length ? block(fields[i] ? titleCase(fields[i].trim()) : "", ls) : "";
    }).filter(Boolean);
    var copy = get("Copyright");
    return [{ title: get("Title") || "Untitled", author: get("Author").replace(/\s*\|\s*/g, ", "),
      copyright: copy ? "© " + copy.replace(/^©\s*/, "") : "", ccli: ccli, lyrics: blocks.join("\n\n") }];
  }

  /* ChordPro */
  function parseChordPro(text, fallbackTitle) {
    var t = clean(text), dir = function (k) { var m = t.match(new RegExp("\\{(?:" + k + ")\\s*:\\s*([^}]*)\\}", "i")); return m ? m[1].trim() : ""; };
    var song = { title: dir("title|t") || fallbackTitle || "Untitled", author: dir("lyricist|artist|composer|subtitle|st"),
      copyright: dir("copyright"), ccli: dir("ccli") || ((t.match(/\{meta:\s*ccli\s+(\d+)\}/i) || [])[1] || ""), lyrics: "" };
    var blocks = [], label = null, lines = [], chorus = null, loose = [];
    t.split("\n").forEach(function (raw) {
      var line = raw.trim();
      var m = line.match(/^\{(start_of_(\w+)|so([vcbt]))(?:\s*:\s*([^}]*))?\}$/i);
      if (m) {
        var kind = (m[2] || { v: "verse", c: "chorus", b: "bridge", t: "tab" }[m[3].toLowerCase()]).toLowerCase();
        label = (m[4] || titleCase(kind)).trim(); lines = [];
        return;
      }
      if (/^\{(end_of_\w+|eo[vcbt])\}$/i.test(line)) {
        if (lines.length) { blocks.push([label, lines]); if (/chorus|refrain/i.test(label)) chorus = [label, lines.slice()]; }
        label = null; lines = []; return;
      }
      if (/^\{chorus\}$/i.test(line)) { if (chorus) blocks.push(chorus); return; }
      var c = line.match(/^\{(?:comment|c|comment_italic|ci)\s*:\s*([^}]*)\}$/i);
      if (c && label === null) { if (loose.length) { blocks.push(["", loose]); loose = []; } label = null; loose.label = c[1].trim(); return; }
      if (/^\{|^#/.test(line)) return;
      var txt = raw.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
      if (label !== null) { if (txt) lines.push(txt); return; }
      // Lyrics outside environments: blank lines separate slides.
      if (!txt) { if (loose.length) { blocks.push([loose.label || "", loose]); loose = []; } return; }
      if (SECTION_RE.test(txt) && !loose.length) { loose.label = titleCase(txt.replace(/:$/, "")); return; }
      loose.push(txt);
    });
    if (loose.length) blocks.push([loose.label || "", loose]);
    song.lyrics = blocks.map(function (b) { return block(b[0], b[1]); }).join("\n\n");
    return [song];
  }

  /* OpenLyrics XML */
  var OL_NAMES = { v: "Verse", c: "Chorus", b: "Bridge", p: "Pre-Chorus", i: "Intro", e: "Ending", o: "Other" };
  function parseOpenLyrics(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Not valid XML");
    var q = function (tag) { var e = doc.getElementsByTagName(tag)[0]; return e ? e.textContent.trim() : ""; };
    var authors = Array.prototype.map.call(doc.getElementsByTagName("author"), function (a) { return a.textContent.trim(); }).filter(Boolean);
    var verses = {};
    Array.prototype.forEach.call(doc.getElementsByTagName("verse"), function (v) {
      var name = v.getAttribute("name") || "";
      var parts = [];
      Array.prototype.forEach.call(v.getElementsByTagName("lines"), function (ln) {
        var html = new XMLSerializer().serializeToString(ln)
          .replace(/<br\s*\/?>/gi, "\n").replace(/<comment>[\s\S]*?<\/comment>/gi, "").replace(/<chord[^>]*\/>/gi, "")
          .replace(/<[^>]+>/g, "");
        var tmp = document.createElement("textarea"); tmp.innerHTML = html;
        tmp.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) { parts.push(x); });
      });
      var m = name.match(/^([a-z])(\d*)([a-z]?)$/i);
      var label = m ? (OL_NAMES[m[1].toLowerCase()] || "Verse") + (m[2] ? " " + m[2] : "") : name;
      verses[name] = block(label, parts);
    });
    var order = q("verseOrder").split(/\s+/).filter(Boolean);
    var keys = order.length ? order.filter(function (k) { return verses[k]; }) : Object.keys(verses);
    if (!keys.length) keys = Object.keys(verses);
    return [{ title: q("title") || "Untitled", author: authors.join(", "), copyright: q("copyright") ? "© " + q("copyright").replace(/^©\s*/, "") : "",
      ccli: q("ccliNo"), lyrics: keys.map(function (k) { return verses[k]; }).join("\n\n") }];
  }

  /* Plain text: first line is the title when followed by a blank line. */
  function parsePlain(text, fallbackTitle) {
    if (/CCLI Song\s*#/i.test(text)) return parseSongSelectText(text, fallbackTitle);
    var lines = clean(text).split("\n");
    var title = fallbackTitle || "Untitled";
    if (lines[0] && lines[1] !== undefined && !lines[1].trim()) { title = lines[0].trim(); lines = lines.slice(2); }
    // Turn "Verse 1" / "Chorus" heading lines into [labels]
    var out = lines.map(function (l) { var x = l.trim(); return SECTION_RE.test(x) ? "[" + titleCase(x.replace(/:$/, "")) + "]" : l; });
    return [{ title: title, author: "", copyright: "", ccli: "", lyrics: out.join("\n").replace(/\[([^\]]+)\]\n\n/g, "[$1]\n").trim() }];
  }

  /* Pick a parser from the file name and content. */
  function parse(name, text) {
    var base = String(name || "").replace(/\.[^.]+$/, "");
    var ext = (String(name).match(/\.([^.]+)$/) || [])[1] || "";
    ext = ext.toLowerCase();
    if (ext === "json") {
      var d = JSON.parse(text); var arr = Array.isArray(d) ? d : (d.songs || []);
      return arr.filter(function (s) { return s && s.title && s.lyrics; });
    }
    if (ext === "usr" || /^\[File\][\s\S]*Type=SongSelect/i.test(text)) return parseUSR(text);
    if (ext === "xml" || /<song[\s>][\s\S]*openlyrics/i.test(text)) return parseOpenLyrics(text);
    if (/^(cho|chordpro|chopro|pro|crd)$/.test(ext) || /\{(title|t|start_of_verse|sov)\s*[:}]/i.test(text)) return parseChordPro(text, base);
    return parsePlain(text, base);
  }

  root.OnStageSongFormats = { parse: parse, parseSongSelectText: parseSongSelectText, parseUSR: parseUSR, parseChordPro: parseChordPro, parseOpenLyrics: parseOpenLyrics };
})(this);
