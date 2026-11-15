/*
 * OnStage Worship — Bible access, keyword search and spoken-quote recognition.
 */
(function (root) {
  var Books = root.OnStageBooks;
  var Ref = root.OnStageSpeechRef;

  function Bible(data) {
    this.id = data.id;
    this.name = data.name;
    this.books = data.books; // [book][chapter][verse] -> text
    this._index = null;
  }

  Bible.prototype.chapterCount = function (b) { return (this.books[b] || []).length; };
  Bible.prototype.verseCount = function (b, c) { return ((this.books[b] || [])[c - 1] || []).length; };
  Bible.prototype.text = function (b, c, v) {
    var ch = (this.books[b] || [])[c - 1];
    return ch ? clean(ch[v - 1] || "") : "";
  };

  function clean(t) { return String(t).replace(/\s+/g, " ").trim(); }

  /* Returns [{book, chapter, verse, text}] for a reference. When toEnd is
     true and only one verse is given, the rest of the chapter is included. */
  Bible.prototype.passage = function (ref, toEnd) {
    var out = [];
    var vc = this.verseCount(ref.book, ref.chapter);
    var start = ref.verse || 1;
    var end = ref.verseEnd || (ref.verse == null || toEnd ? vc : ref.verse);
    for (var v = start; v <= end; v++) {
      out.push({ book: ref.book, chapter: ref.chapter, verse: v, text: this.text(ref.book, ref.chapter, v) });
    }
    return out;
  };

  /* Parse a typed reference such as "jn 3 16", "1 Cor 13:4-7", "Psalm 23". */
  Bible.prototype.parse = function (q) {
    var r = Ref.detect(q, this, { mode: "typed" });
    if (r.length) return r[0];
    // Book only, allow prefix: "gen" -> Genesis 1
    var n = Ref.normalize(q);
    if (!n) return null;
    for (var i = 0; i < Books.list.length; i++) {
      var b = Books.list[i];
      var names = [b.name.toLowerCase()].concat(b.spoken, b.typed);
      for (var j = 0; j < names.length; j++) {
        if (names[j].indexOf(n) === 0 || n === names[j]) return { book: i, chapter: 1, verse: null, verseEnd: null };
      }
    }
    return null;
  };

  /* Keyword search – all words must appear. */
  Bible.prototype.search = function (q, limit) {
    limit = limit || 200;
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var res = [];
    if (!words.length) return res;
    for (var b = 0; b < this.books.length; b++) {
      var book = this.books[b];
      for (var c = 0; c < book.length; c++) {
        var ch = book[c];
        for (var v = 0; v < ch.length; v++) {
          var t = ch[v].toLowerCase();
          var ok = true;
          for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) < 0) { ok = false; break; }
          if (ok) {
            res.push({ book: b, chapter: c + 1, verse: v + 1, text: clean(ch[v]) });
            if (res.length >= limit) return res;
          }
        }
      }
    }
    return res;
  };

  /* ---------- Quote recognition ----------
     When a preacher reads a verse aloud without naming it, we match the
     words heard against every verse using an idf-weighted inverted index,
     then confirm with word-pair (bigram) overlap. Archaic KJV forms are
     folded ("believeth" ~ "believes", "thee" ~ "you") so modern reading
     still matches. */

  var FOLD = { thee: "you", thou: "you", ye: "you", thy: "your", thine: "your", hath: "has", doth: "does",
    art: "are", shalt: "shall", wilt: "will", hast: "have", unto: "to", saith: "says", spake: "spoke" };
  var STOP = { the: 1, and: 1, of: 1, to: 1, a: 1, in: 1, that: 1, is: 1, it: 1, for: 1, be: 1, he: 1, his: 1,
    i: 1, you: 1, your: 1, they: 1, them: 1, with: 1, not: 1, all: 1, shall: 1, will: 1, was: 1, are: 1, but: 1, as: 1,
    my: 1, me: 1, him: 1, on: 1, which: 1, have: 1, has: 1, by: 1, from: 1, this: 1, so: 1, we: 1, us: 1, an: 1, or: 1,
    at: 1, were: 1, there: 1, their: 1, our: 1, said: 1, what: 1, who: 1, when: 1, if: 1, no: 1, out: 1, up: 1, one: 1 };

  function stem(w) {
    if (FOLD[w]) return FOLD[w];
    if (w.length > 5 && /eth$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /est$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    return String(text).toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/'/g, "").split(/\s+/).filter(Boolean).map(stem);
  }

  Bible.prototype.buildIndex = function () {
    if (this._index) return this._index;
    var refs = [], postings = Object.create(null), verseTokens = [];
    var id = 0;
    for (var b = 0; b < this.books.length; b++) {
      for (var c = 0; c < this.books[b].length; c++) {
        var ch = this.books[b][c];
        for (var v = 0; v < ch.length; v++) {
          var tk = tokens(ch[v]);
          refs.push([b, c + 1, v + 1]);
          verseTokens.push(tk);
          var seen = Object.create(null);
          for (var k = 0; k < tk.length; k++) {
            var w = tk[k];
            if (STOP[w] || seen[w]) continue;
            seen[w] = 1;
            (postings[w] || (postings[w] = [])).push(id);
          }
          id++;
        }
      }
    }
    var N = id, idf = Object.create(null);
    for (var w2 in postings) idf[w2] = Math.log(N / postings[w2].length);
    this._index = { refs: refs, postings: postings, idf: idf, tokens: verseTokens, scores: new Float32Array(N) };
    return this._index;
  };

  /* Find the verse being quoted in `text` (the last ~30 spoken words).
     Returns {book, chapter, verse, score} or null. */
  Bible.prototype.matchQuote = function (text, opts) {
    opts = opts || {};
    var idx = this.buildIndex();
    var words = tokens(text).slice(-30);
    if (words.length < 6) return null;
    var scores = idx.scores; scores.fill(0);
    var touched = [];
    var uniq = Object.create(null);
    words.forEach(function (w) {
      if (STOP[w] || uniq[w] || !idx.postings[w]) return;
      uniq[w] = 1;
      var p = idx.postings[w], s = idx.idf[w];
      if (p.length > 3000) return; // too common to be useful
      for (var i = 0; i < p.length; i++) {
        if (scores[p[i]] === 0) touched.push(p[i]);
        scores[p[i]] += s;
      }
    });
    touched.sort(function (a, b) { return scores[b] - scores[a]; });
    var cands = touched.slice(0, 12);
    var heardPairs = pairs(words);
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var vt = idx.tokens[cands[i]];
      var vp = pairs(vt);
      var hit = 0;
      for (var k in heardPairs) if (vp[k]) hit++;
      var denom = Math.min(Object.keys(heardPairs).length, Object.keys(vp).length);
      var ratio = denom ? hit / denom : 0;
      if (hit >= (opts.minPairs || 4) && ratio >= (opts.minRatio || 0.45)) {
        var score = ratio * 0.7 + Math.min(1, hit / 10) * 0.3;
        if (!best || score > best.score) {
          var r = idx.refs[cands[i]];
          best = { book: r[0], chapter: r[1], verse: r[2], verseEnd: null, score: score, kind: "quote" };
        }
      }
    }
    return best;
  };

  function pairs(t) {
    var o = Object.create(null);
    for (var i = 0; i + 1 < t.length; i++) o[t[i] + " " + t[i + 1]] = 1;
    return o;
  }

  /* -------- Registry of loaded Bible versions -------- */
  var registry = {};
  function load() {
    var src = root.ONSTAGE_BIBLES || {};
    for (var k in src) if (!registry[k]) registry[k] = new Bible(src[k]);
  }
  function add(data) { registry[data.id] = new Bible(data); return registry[data.id]; }
  function get(id) { load(); return registry[id] || registry[Object.keys(registry)[0]]; }
  function versions() { load(); return Object.keys(registry).map(function (k) { return { id: k, name: registry[k].name }; }); }

  /* Convert common JSON Bible layouts into our [book][chapter][verse] form. */
  function fromJSON(json, id, name) {
    var books;
    if (Array.isArray(json) && json.length && json[0].chapters) {
      books = json.map(function (b) { return b.chapters; }); // [{name, chapters:[[v,..]]}]
    } else if (Array.isArray(json) && Array.isArray(json[0])) {
      books = json; // already nested arrays
    } else if (json && json.books) {
      return fromJSON(json.books, id || json.id, name || json.name);
    } else if (json && typeof json === "object") {
      // {"Genesis": {"1": {"1": "text"}}}
      books = Object.keys(json).map(function (bk) {
        var chs = json[bk];
        return Object.keys(chs).sort(function (a, b) { return a - b; }).map(function (c) {
          var vs = chs[c];
          return Object.keys(vs).sort(function (a, b) { return a - b; }).map(function (v) { return vs[v]; });
        });
      });
    }
    if (!books || books.length !== 66) throw new Error("Expected 66 books, found " + (books ? books.length : 0));
    return { id: id, name: name || id, books: books };
  }

  root.OnStageBible = { get: get, add: add, versions: versions, fromJSON: fromJSON, Bible: Bible, tokens: tokens };
})(this);
