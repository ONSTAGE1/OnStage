/*
 * OnStage Worship — spoken Bible reference detection.
 *
 * Turns free speech such as
 *   "turn with me to first Corinthians chapter thirteen verses four through seven"
 *   "John three sixteen"   "Romans 8:28"   "Psalm one hundred and nineteen verse 105"
 * into structured references, validated against the loaded Bible so that
 * impossible references (e.g. "John 30") are discarded.
 *
 * It also understands follow-up phrases that rely on context:
 *   "verse 17", "verses 18 to 20", "chapter 4 verse 2", "next verse", "previous verse"
 *
 * Pure functions, no DOM — works in the browser and in Node for testing.
 */
(function (root) {
  var Books = root.OnStageBooks || (typeof require !== "undefined" ? require("./books.js") : null);

  var UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  var TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var ORDINALS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50
  };

  // Words a recogniser sometimes writes instead of a number ("John to 3", "for")
  // are deliberately NOT mapped – too many false positives.

  function isNumWord(w) {
    return w in UNITS || w in TEENS || w in TENS || w === "hundred";
  }

  /* Convert runs of number words to digits.
     "twenty eight" -> 28, "one hundred and nineteen" -> 119,
     "three sixteen" -> "3 16" (two separate numbers, as people say references). */
  function wordsToNumbers(tokens) {
    var out = [];
    var i = 0;
    while (i < tokens.length) {
      var w = tokens[i];
      if (!isNumWord(w) || (w === "hundred")) {
        if (w === "hundred") { out.push("100"); i++; continue; }
        out.push(w); i++; continue;
      }
      // Parse one number starting at i.
      var val = 0, consumed = 0;
      var j = i;
      var t = tokens[j];
      if (t in UNITS) {
        val = UNITS[t]; j++;
        if (tokens[j] === "hundred") {
          val *= 100; j++;
          if (tokens[j] === "and" && tokens[j + 1] && (tokens[j + 1] in UNITS || tokens[j + 1] in TEENS || tokens[j + 1] in TENS)) j++;
          var rest = parseUnder100(tokens, j);
          if (rest) { val += rest.value; j = rest.next; }
        }
      } else {
        var r = parseUnder100(tokens, j);
        val = r.value; j = r.next;
      }
      consumed = j - i;
      out.push(String(val));
      i += consumed;
    }
    return out;
  }

  function parseUnder100(tokens, j) {
    var t = tokens[j];
    if (t in TEENS) return { value: TEENS[t], next: j + 1 };
    if (t in TENS) {
      var v = TENS[t];
      var n = tokens[j + 1];
      if (n in UNITS && UNITS[n] > 0) return { value: v + UNITS[n], next: j + 2 };
      // "twenty-eight" already split by hyphen handling
      return { value: v, next: j + 1 };
    }
    if (t in UNITS) return { value: UNITS[t], next: j + 1 };
    return null;
  }

  /* Normalise raw transcript text into a canonical lower-case string. */
  function normalize(text) {
    var s = String(text || "").toLowerCase();
    s = s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'");
    // Keep "3:16" style colons and "16-18" style dashes between digits.
    s = s.replace(/(\d)\s*:\s*(\d)/g, "$1 : $2");
    s = s.replace(/(\d)\s*-\s*(\d)/g, "$1 - $2");
    // "twenty-eight" -> "twenty eight"
    s = s.replace(/([a-z])-([a-z])/g, "$1 $2");
    s = s.replace(/(\d+)(st|nd|rd|th)\b/g, "$1");
    s = s.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
    s = s.replace(/[^a-z0-9:\- ']+/g, " ");
    s = s.replace(/'s\b/g, "s").replace(/'/g, "");
    var tokens = s.split(/\s+/).filter(Boolean);
    // Ordinals before a book name: "first john", "second kings", "1st peter", roman numerals
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk in ORDINALS) tokens[i] = String(ORDINALS[tk]);
      else if ((tk === "ii") && tokens[i + 1]) tokens[i] = "2";
      else if ((tk === "iii") && tokens[i + 1]) tokens[i] = "3";
    }
    tokens = wordsToNumbers(tokens);
    // Split glued abbreviations like "1cor" handled by alias list; also "3:16" already spaced.
    return tokens.join(" ");
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  var aliasCache = {};
  function aliasTable(mode) {
    if (aliasCache[mode]) return aliasCache[mode];
    var entries = [];
    Books.list.forEach(function (b) {
      var names = b.spoken.slice();
      if (mode === "typed") names = names.concat(b.typed, [b.name.toLowerCase()]);
      names.forEach(function (n) { entries.push({ alias: n, book: b.index }); });
      // "1 john" also said as "one john"/"i john" – handled by normalize().
    });
    entries.sort(function (a, b) { return b.alias.length - a.alias.length; });
    var map = {};
    entries.forEach(function (e) { if (!(e.alias in map)) map[e.alias] = e.book; });
    var re = entries.map(function (e) { return escapeRe(e.alias).replace(/ /g, "\\s*"); }).join("|");
    aliasCache[mode] = { map: map, re: re };
    return aliasCache[mode];
  }

  function lookupAlias(table, text) {
    var key = text.replace(/\s+/g, " ").trim();
    if (key in table.map) return table.map[key];
    var compact = key.replace(/\s+/g, "");
    for (var a in table.map) if (a.replace(/\s+/g, "") === compact) return table.map[a];
    return -1;
  }

  /* Validate (and repair) chapter/verse numbers against the Bible. */
  function resolve(bible, book, ch, v1, v2) {
    var chapters = bible.chapterCount(book);
    // "John 316" -> try splitting glued numbers into chapter + verse.
    if (ch && (ch > chapters) && v1 == null && String(ch).length >= 2) {
      var s = String(ch);
      for (var k = 1; k < s.length; k++) {
        var c = parseInt(s.slice(0, k), 10), v = parseInt(s.slice(k), 10);
        if (c >= 1 && c <= chapters && v >= 1 && v <= bible.verseCount(book, c) && s.charAt(k) !== "0") {
          ch = c; v1 = v; break;
        }
      }
    }
    // Single-chapter books: "Jude 3" means Jude 1:3
    if (chapters === 1 && ch > 1 && v1 == null) { v1 = ch; ch = 1; }
    if (!ch || ch < 1 || ch > chapters) return null;
    var vc = bible.verseCount(book, ch);
    if (v1 != null) {
      if (v1 < 1 || v1 > vc) return null;
      if (v2 != null) {
        if (v2 <= v1 || v2 > vc) v2 = null; // ignore impossible range end
      }
    }
    return { book: book, chapter: ch, verse: v1 == null ? null : v1, verseEnd: v2 == null ? null : v2 };
  }

  var NUM = "(\\d{1,3})";
  var SEP_V = "(?:\\s*(?::|verses?|vs|v|and\\s+verse|,)\\s*|\\s+)";
  var RANGE = "(?:\\s*(?:-|to|through|thru|till|until|and)\\s*(?:verses?\\s*)?" + NUM + ")?";

  function bookRegex(mode) {
    var t = aliasTable(mode);
    // book [chapter] C [sep V [range V2]]
    return new RegExp("(?:^|\\s)(" + t.re + ")\\s+(?:chapter\\s+|chap\\s+|ch\\s+)?" + NUM +
      "(?:" + SEP_V + NUM + RANGE + ")?(?=\\s|$)", "g");
  }

  /* "chapter 3 of John", "the 3rd chapter of John verse 16" */
  function chapterOfRegex(mode) {
    var t = aliasTable(mode);
    return new RegExp("(?:^|\\s)(?:chapter\\s+" + NUM + "|(?:the\\s+)?" + NUM + "\\s+chapter)\\s+(?:of|in)\\s+(?:the\\s+)?(?:book\\s+of\\s+)?(" + t.re + ")" +
      "(?:\\s+(?:verses?|v)\\s+" + NUM + RANGE + ")?(?=\\s|$)", "g");
  }

  /*
   * Detect references in a transcript fragment.
   * options.mode: "spoken" (default) or "typed"
   * options.context: last reference shown {book, chapter, verse} – enables
   *                  "verse 17" / "next verse" follow-ups.
   * Returns [{book, chapter, verse, verseEnd, kind, index, end, text}]
   */
  function detect(text, bible, options) {
    options = options || {};
    var mode = options.mode || "spoken";
    var norm = normalize(text);
    var found = [];
    var covered = [];
    var m;

    var re = bookRegex(mode);
    while ((m = re.exec(norm))) {
      var start = m.index + (m[0].charAt(0) === " " ? 1 : 0);
      var book = lookupAlias(aliasTable(mode), m[1]);
      if (book < 0) continue;
      var r = resolve(bible, book, parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null, m[4] ? parseInt(m[4], 10) : null);
      if (!r) continue;
      r.kind = "reference"; r.index = start; r.end = m.index + m[0].length; r.text = m[0].trim();
      found.push(r); covered.push([start, r.end]);
    }

    var re2 = chapterOfRegex(mode);
    while ((m = re2.exec(norm))) {
      var s2 = m.index + (m[0].charAt(0) === " " ? 1 : 0);
      if (overlaps(covered, s2, m.index + m[0].length)) continue;
      var b2 = lookupAlias(aliasTable(mode), m[3]);
      if (b2 < 0) continue;
      var r2 = resolve(bible, b2, parseInt(m[1] || m[2], 10), m[4] ? parseInt(m[4], 10) : null, m[5] ? parseInt(m[5], 10) : null);
      if (!r2) continue;
      r2.kind = "reference"; r2.index = s2; r2.end = m.index + m[0].length; r2.text = m[0].trim();
      found.push(r2); covered.push([s2, r2.end]);
    }

    var ctx = options.context;
    if (ctx && mode === "spoken") {
      // "chapter 4 verse 2" (same book)
      var re3 = /(?:^|\s)chapter\s+(\d{1,3})(?:\s+(?:verses?|v)\s+(\d{1,3})(?:\s*(?:-|to|through|thru)\s*(\d{1,3}))?)?(?=\s|$)/g;
      while ((m = re3.exec(norm))) {
        var s3 = m.index + (m[0].charAt(0) === " " ? 1 : 0);
        if (overlaps(covered, s3, m.index + m[0].length)) continue;
        var r3 = resolve(bible, ctx.book, parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : null, m[3] ? parseInt(m[3], 10) : null);
        if (!r3) continue;
        r3.kind = "context"; r3.index = s3; r3.end = m.index + m[0].length; r3.text = m[0].trim();
        found.push(r3); covered.push([s3, r3.end]);
      }
      // "verse 17", "verses 18 to 20" (same chapter)
      var re4 = /(?:^|\s)(?:verses?|look at verse|in verse)\s+(\d{1,3})(?:\s*(?:-|to|through|thru|and)\s*(\d{1,3}))?(?=\s|$)/g;
      while ((m = re4.exec(norm))) {
        var s4 = m.index + (m[0].charAt(0) === " " ? 1 : 0);
        if (overlaps(covered, s4, m.index + m[0].length)) continue;
        var r4 = resolve(bible, ctx.book, ctx.chapter, parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : null);
        if (!r4) continue;
        r4.kind = "context"; r4.index = s4; r4.end = m.index + m[0].length; r4.text = m[0].trim();
        found.push(r4); covered.push([s4, r4.end]);
      }
      // navigation commands
      var re5 = /(?:^|\s)(next verse|following verse|verse after that|previous verse|verse before)(?=\s|$)/g;
      while ((m = re5.exec(norm))) {
        var s5 = m.index + (m[0].charAt(0) === " " ? 1 : 0);
        var dir = /next|following|after/.test(m[1]) ? 1 : -1;
        found.push({ kind: "nav", direction: dir, index: s5, end: m.index + m[0].length, text: m[1] });
      }
    }

    found.sort(function (a, b) { return a.index - b.index; });
    found.forEach(function (f) {
      f.normalized = norm;
      f.complete = f.end < norm.length;
      // Confidence: a verse number or the word "chapter" makes it explicit.
      // "I will mark 1 thing" -> Mark 1 is only a weak, chapter-only guess.
      if (f.kind !== "nav") f.explicit = f.verse != null || /chapter|chap\b/.test(f.text) || f.kind === "context";
    });
    return found;
  }

  function overlaps(list, s, e) {
    for (var i = 0; i < list.length; i++) if (s < list[i][1] && e > list[i][0]) return true;
    return false;
  }

  function format(ref) {
    if (!ref) return "";
    var s = Books.list[ref.book].name + " " + ref.chapter;
    if (ref.verse != null) s += ":" + ref.verse + (ref.verseEnd != null ? "-" + ref.verseEnd : "");
    return s;
  }

  var api = { normalize: normalize, detect: detect, format: format, resolve: resolve, aliasTable: aliasTable, lookupAlias: lookupAlias };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OnStageSpeechRef = api;
})(this);
