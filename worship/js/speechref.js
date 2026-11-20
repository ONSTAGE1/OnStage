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

  var VERSE_MISHEARD = { vers: 1, versed: 1, versus: 1, versa: 1, verce: 1, worse: 1 };
  function isNumTok(t) { return !!t && /^\d{1,3}$/.test(t); }

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
    // "versten" -> "verse ten" (engines glue the word onto the number)
    s = s.replace(/\bvers(?:e)?(?=(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, "verse ");
    var tokens = s.split(/\s+/).filter(Boolean);
    // Ordinals before a book name: "first john", "second kings", "1st peter", roman numerals
    var numLike = function (t) { return !!t && (/^\d/.test(t) || isNumWord(t)); };
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk === "first" && numLike(tokens[i - 1]) && numLike(tokens[i + 1])) tokens[i] = "verse";
      else if (tk in ORDINALS) tokens[i] = String(ORDINALS[tk]);
      else if ((tk === "ii") && tokens[i + 1]) tokens[i] = "2";
      else if ((tk === "iii") && tokens[i + 1]) tokens[i] = "3";
    }
    tokens = wordsToNumbers(tokens);
    // Speech engines often mishear "verse" ("vers", "versus", "worse") right next to numbers.
    for (var j = 0; j < tokens.length; j++) {
      var tj = tokens[j];
      if (VERSE_MISHEARD[tj] && (isNumTok(tokens[j - 1]) || isNumTok(tokens[j + 1]))) tokens[j] = "verse";
      else if (tj === "ate" && (isNumTok(tokens[j - 1]) || isNumTok(tokens[j + 1]))) tokens[j] = "8";                 // "chapter ate"
      else if (tj === "ate" && tokens[j - 1] && /(?:ah|ea|ai|ia|us|es|on|an|ms|ts)$/.test(tokens[j - 1]) && j > 1 && !isNumTok(tokens[j - 1])) tokens[j] = "8"; // "Hosea ate verse ten"
      else if (tj === "for" && isNumTok(tokens[j - 1]) && isNumTok(tokens[j + 1])) tokens[j] = "verse";               // "six for fifteen"
      else if (tj === "for" && tokens[j - 1] === "verse" && !isNumTok(tokens[j + 1])) tokens[j] = "4";                // "verse for"
      else if ((tj === "too" || tj === "to" || tj === "tu") && tokens[j - 1] === "verse" && isNumTok(tokens[j - 2]) && !isNumTok(tokens[j + 1])) tokens[j] = "2"; // "ten verse too"
    }
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
    if (ch && (ch > chapters) && v1 == null && String(ch).length >= 3) {
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
  var NUM_CH = "(\\d{1,4})";
  var SEP_V = "(?:\\s*(?::|-|verses?|vs|v|(?:and|in)\\s+verse|,)\\s*|\\s+)";
  var RANGE = "(?:\\s*(?:-|to|through|thru|till|until|and)\\s*(?:verses?\\s*)?" + NUM + ")?";

  function bookRegex(mode) {
    var t = aliasTable(mode);
    // book [chapter] C [sep V [range V2]]
    return new RegExp("(?:^|\\s)(" + t.re + ")\\s+(?:chapter\\s+|chap\\s+|ch\\s+)?" + NUM_CH +
      "(?:" + SEP_V + NUM + RANGE + ")?(?=\\s|$)", "g");
  }

  /* "chapter 3 of John", "the 3rd chapter of John verse 16" */
  function chapterOfRegex(mode) {
    var t = aliasTable(mode);
    return new RegExp("(?:^|\\s)(?:chapter\\s+" + NUM + "|(?:the\\s+)?" + NUM + "\\s+chapter)\\s+(?:of|in)\\s+(?:the\\s+)?(?:book\\s+of\\s+)?(" + t.re + ")" +
      "(?:\\s+(?:verses?|v)\\s+" + NUM + RANGE + ")?(?=\\s|$)", "g");
  }


  /* ---------------------------------------------------------------------
   * Sound-alike book matching.
   * Speech engines often mishear rare book names ("limitations" for
   * Lamentations, "do to rhyme" for Deuteronomy) but get the numbers right.
   * When clear chapter/verse numbers follow some unrecognised words, those
   * words are matched to the closest-sounding book that has that chapter and
   * verse.
   * ------------------------------------------------------------------- */
  var EXTRA_FORMS = {
    "Psalms": ["sahm", "sam", "salm", "sound", "psalmof"], "Song of Solomon": ["songofsongs", "songsofsolomon", "signofsolomon", "signusolomon"],
    "Numbers": ["number"], "Deuteronomy": ["dooteronomy", "duteronomy", "dotorun", "dotorhyme"], "Ecclesiastes": ["ecclesiastics", "eclesiastes", "eclesiasts"],
    "Philippians": ["filipians", "philippines"], "Colossians": ["kolosians", "colosians", "classin", "classins", "collisions", "calossians"],
    "Philemon": ["filemon", "filaymon", "feynman", "filemen", "fileman", "filein"], "Galatians": ["galayshuns", "gallations", "galations", "gala"],
    "Zechariah": ["zachariah", "zakariah", "zukariah", "sukaria"], "Habakkuk": ["habakuk", "habakook", "havecook", "haveacut"],
    "Obadiah": ["obadaya", "obadiya", "obadi"], "Nehemiah": ["neemiah", "nehemaya", "namiya", "namemya"], "Hosea": ["hozeya", "hozaya", "hosay"],
    "Haggai": ["hagai", "hagay", "hagthy", "hagi"], "Jude": ["jude", "dude"], "Lamentations": ["limitations"], "Jeremiah": ["jeremy", "germiah"],
    "Zephaniah": ["zefaniah", "zephanya", "zephay"], "Nahum": ["naham", "nayhum"], "Micah": ["mika", "mica"], "Ezra": ["esra"],
    "Jonah": ["jona"], "Joel": ["jole"], "Amos": ["amoss"]
  };
  var STOP_WORDS = { a: 1, an: 1, the: 1, to: 1, of: 1, in: 1, on: 1, at: 1, and: 1, me: 1, my: 1, we: 1, us: 1, is: 1, it: 1, or: 1, for: 1, with: 1, so: 1, now: 1, that: 1, this: 1, i: 1, you: 1, your: 1, our: 1, be: 1, by: 1, as: 1, um: 1, uh: 1, if: 1, let: 1, lets: 1, turn: 1, open: 1, read: 1, go: 1, chapter: 1, chap: 1, verse: 1, verses: 1, and_: 1 };

  function lettersOf(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ""); }
  function isVowelCh(c) { return "aeiouy".indexOf(c) >= 0; }

  /* Collapse spelling variants into a rough sound: ph/f, ck/k, c/k, ch/k ... */
  function soundOf(s) {
    s = lettersOf(s);
    s = s.replace(/^ps/, "s").replace(/^(kn|gn|pn)/, "n").replace(/^wr/, "r").replace(/^x/, "z").replace(/x/g, "ks")
      .replace(/tion|sion|cian|[ts]ians?\b/g, function (m) { return m.charAt(m.length - 1) === "s" ? "shuns" : "shun"; })
      .replace(/ph/g, "f").replace(/ck/g, "k").replace(/ch/g, "k")
      .replace(/sh/g, "S").replace(/th/g, "t").replace(/c(?=[eiy])/g, "s").replace(/[cq]/g, "k")
      .replace(/z/g, "s").replace(/v/g, "f").replace(/w/g, "u");
    s = s.replace(/([aeiouy])h/g, "$1");           // silent h after a vowel (Nahum, Obadiah)
    return s.replace(/(.)\1+/g, "$1");             // doubled letters
  }
  function skeletonOf(snd) { return snd.replace(/[aeiouy]/g, ""); }

  var SUB_PAIR = { bp: 1, pb: 1, dt: 1, td: 1, gk: 1, kg: 1, sj: 1, js: 1, jg: 1, gj: 1 };
  function subCost(a, b) {
    if (a === b) return 0;
    var va = isVowelCh(a), vb = isVowelCh(b);
    if (va && vb) return 0.3;
    if (va !== vb) return 1;
    if (SUB_PAIR[a + b]) return 0.4;
    if ((a === "m" && b === "n") || (a === "n" && b === "m")) return 0.6;
    if ((a === "l" && b === "r") || (a === "r" && b === "l")) return 0.7;
    return 1;
  }
  function indelCost(c) { return isVowelCh(c) ? 0.4 : (c === "h" || c === "u" ? 0.5 : 1); }
  function indelTotal(s) { var t = 0; for (var i = 0; i < s.length; i++) t += indelCost(s.charAt(i)); return t; }

  function weightedDistance(a, b) {
    var prev = [0], i, j;
    for (j = 0; j < b.length; j++) prev.push(prev[j] + indelCost(b.charAt(j)));
    for (i = 0; i < a.length; i++) {
      var cur = [prev[0] + indelCost(a.charAt(i))];
      for (j = 0; j < b.length; j++) {
        cur.push(Math.min(prev[j + 1] + indelCost(a.charAt(i)), cur[j] + indelCost(b.charAt(j)), prev[j] + subCost(a.charAt(i), b.charAt(j))));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function similarity(a, b) {
    var denom = Math.max(indelTotal(a), indelTotal(b));
    if (!denom) return 0;
    return Math.max(0, 1 - weightedDistance(a, b) / denom);
  }
  /* 0..1 how alike two spoken forms sound (letters only). */
  function soundScore(heard, target) {
    var a = soundOf(heard), b = soundOf(target);
    var full = similarity(a, b);
    var sa = skeletonOf(a), sb = skeletonOf(b);
    var skel = (sa && sb) ? similarity(sa, sb) : full;
    return 0.5 * full + 0.5 * skel;
  }

  var fuzzyForms = null;
  function fuzzyTable() {
    if (fuzzyForms) return fuzzyForms;
    fuzzyForms = [];
    Books.list.forEach(function (b) {
      var m = b.name.match(/^([123]) /), ord = m ? +m[1] : 0, forms = {};
      var add = function (f) { f = lettersOf(f.replace(/^[123]\s+/, "").replace(/^book of /, "")); if (f.length >= 3) forms[f] = 1; };
      add(b.name); b.spoken.forEach(add);
      (EXTRA_FORMS[b.name] || EXTRA_FORMS[b.name.replace(/^[123] /, "")] || []).forEach(add);
      fuzzyForms.push({ book: b.index, ord: ord, forms: Object.keys(forms) });
    });
    return fuzzyForms;
  }

  /* Best books for a few heard words; returns [{book, score}] best first. */
  function fuzzyBooks(words, ord) {
    var heard = lettersOf(words.join(""));
    if (heard.length < 3) return [];
    var out = [];
    fuzzyTable().forEach(function (e) {
      if (ord !== e.ord) return;
      var best = 0;
      for (var i = 0; i < e.forms.length; i++) {
        var sc = soundScore(heard, e.forms[i]);
        if (sc > best) best = sc;
      }
      out.push({ book: e.book, score: best });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  var RANGE_WORD = { "-": 1, to: 1, through: 1, thru: 1, till: 1, until: 1, and: 1 };
  /* Read "N [verse M [- M2]]" starting at token i. */
  function numbersAt(tokens, i) {
    var j = i, ch = +tokens[j++], v1 = null, v2 = null, verseWord = false;
    var t = tokens[j];
    if (t === ":" || t === "-" || t === "verse" || t === "verses" || t === "vs" || t === "v" || t === ",") { verseWord = true; j++; }
    else if ((t === "and" || t === "in") && tokens[j + 1] === "verse") { verseWord = true; j += 2; }
    if (isNumTok(tokens[j])) {
      v1 = +tokens[j++];
      if (RANGE_WORD[tokens[j]] && (isNumTok(tokens[j + 1]) || (tokens[j + 1] === "verse" && isNumTok(tokens[j + 2])))) {
        j += tokens[j + 1] === "verse" ? 3 : 2; v2 = +tokens[j - 1];
      }
    }
    return { ch: ch, v1: v1, v2: v2, verseWord: verseWord, next: j };
  }

  function fuzzyDetect(norm, bible, covered) {
    var tokens = norm.split(" "), offs = [], pos = 0, out = [];
    tokens.forEach(function (t) { offs.push(pos); pos += t.length + 1; });
    var i = 0;
    while (i < tokens.length) {
      if (!isNumTok(tokens[i])) { i++; continue; }
      var chapterWord = tokens[i - 1] === "chapter" || tokens[i - 1] === "chap";
      var endW = (chapterWord ? i - 2 : i - 1);
      var nums = numbersAt(tokens, i);
      var startChar = offs[Math.max(0, endW - 2)], endChar = nums.next < tokens.length ? offs[nums.next] - 1 : norm.length;
      if (endW < 0 || overlaps(covered, offs[Math.max(0, endW)], endChar)) { i = Math.max(i + 1, nums.next); continue; }
      // a bare "N" with no chapter word and no verse is too weak to guess a book from
      if (!chapterWord && nums.v1 == null) { i = nums.next; continue; }

      var best = null;
      for (var k = 1; k <= 3 && endW - k + 1 >= 0; k++) {
        var w = tokens.slice(endW - k + 1, endW + 1), ord = 0;
        if (/^[123]$/.test(w[0]) && w.length > 1) { ord = +w[0]; w = w.slice(1); }
        if (w.some(isNumTok) || w.some(function (x) { return x === "chapter" || x === "verse" || x === "verses"; })) continue;
        if (w.every(function (x) { return STOP_WORDS[x]; })) continue;
        if (STOP_WORDS[w[0]] && w.length === 1) continue;
        var cands = fuzzyBooks(w, ord);
        for (var c = 0; c < cands.length && c < 4; c++) {
          if (cands[c].score < 0.7) break;
          var res = resolve(bible, cands[c].book, nums.ch, nums.v1, nums.v2);
          if (!res) continue;
          var rival = cands.slice(c + 1).filter(function (x) { return x.score >= cands[c].score - 0.05; })
            .some(function (x) { return !!resolve(bible, x.book, nums.ch, nums.v1, nums.v2); });
          var cand = { res: res, score: cands[c].score, ambiguous: rival, from: endW - k + 1 - (ord ? 1 : 0), heard: tokens.slice(endW - k + 1 - (ord ? 1 : 0), endW + 1).join(" ") };
          if (!best || cand.score > best.score + 0.001) best = cand;
          break;
        }
      }
      if (best) {
        var r = best.res;
        r.kind = "reference"; r.fuzzy = true; r.score = best.score; r.ambiguous = best.ambiguous;
        r.index = offs[best.from]; r.end = endChar; r.text = norm.slice(r.index, endChar); r.heardAs = best.heard;
        out.push(r); covered.push([r.index, r.end]);
      }
      i = Math.max(i + 1, nums.next);
    }
    return out;
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

    if (mode === "spoken" && options.fuzzy !== false) {
      fuzzyDetect(norm, bible, covered).forEach(function (f) { found.push(f); });
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
