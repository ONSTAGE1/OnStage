/*
 * OnStage Worship — AI Verse Listener.
 * Streams microphone audio through the browser's speech recognition and
 * feeds the transcript into the reference detector and the quote matcher.
 *
 * Emits:
 *   onTranscript({final, interim})
 *   onDetect({ref, kind: reference|context|quote|nav, confidence, heard})
 *   onStatus(text, level)
 */
(function (root) {
  var Ref = root.OnStageSpeechRef;
  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;

  function Listener(opts) {
    this.opts = Object.assign({
      lang: "en-US",
      interim: true,       // react while the preacher is still speaking
      quotes: true,        // recognise verses read aloud without a reference
      cooldownMs: 25000,   // don't re-trigger the same reference within this window
      getBible: null,      // () => Bible
      getContext: null     // () => {book, chapter, verse}
    }, opts || {});
    this.running = false;
    this.recent = {};      // refKey -> time last fired
    this.fired = {};       // resultIndex -> {refKey:1}
    this.wordBuffer = "";
    this.finalLog = "";
    this.onTranscript = this.onDetect = this.onStatus = function () {};
  }

  Listener.supported = !!SR;

  Listener.prototype.start = function () {
    if (!SR) { this.onStatus("Speech recognition is not available in this browser. Use Google Chrome or Microsoft Edge.", "error"); return false; }
    if (this.running) return true;
    var self = this;
    var rec = this.rec = new SR();
    rec.lang = this.opts.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.running = true;
    this.fired = {};
    this.session = (this.session || 0) + 1;

    rec.onstart = function () { self.onStatus("Listening…", "ok"); };
    rec.onerror = function (e) {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        self.running = false;
        self.onStatus("Microphone permission was denied. Allow microphone access for this page (and open it via http://localhost or https).", "error");
      } else self.onStatus("Speech error: " + e.error + " — retrying", "warn");
    };
    rec.onend = function () {
      // Browsers stop continuous recognition periodically; keep it alive.
      if (self.running) {
        self.session++;
        self.fired = {};
        setTimeout(function () { if (self.running) try { rec.start(); } catch (err) {} }, 250);
      } else self.onStatus("Stopped", "idle");
    };
    rec.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i], txt = res[0].transcript;
        if (res.isFinal) {
          self.finalLog = (self.finalLog + " " + txt).slice(-4000);
          self.process(txt, true, self.session + ":" + i);
        } else {
          interim += txt;
          if (self.opts.interim) self.process(txt, false, self.session + ":" + i);
        }
      }
      self.onTranscript({ final: self.finalLog, interim: interim });
    };
    try { rec.start(); } catch (err) { this.onStatus(String(err), "error"); this.running = false; return false; }
    return true;
  };

  Listener.prototype.stop = function () {
    this.running = false;
    if (this.rec) try { this.rec.stop(); } catch (e) {}
  };

  Listener.prototype.setLang = function (lang) {
    this.opts.lang = lang;
    if (this.running) { this.stop(); var s = this; setTimeout(function () { s.start(); }, 400); }
  };

  /* Feed text (from the mic or typed into the simulator). */
  Listener.prototype.process = function (text, isFinal, resultId) {
    var bible = this.opts.getBible();
    if (!bible) return;
    resultId = resultId || ("manual:" + Date.now());
    var fired = this.fired[resultId] || (this.fired[resultId] = {});
    var ctx = this.opts.getContext ? this.opts.getContext() : null;
    var hits = Ref.detect(text, bible, { context: ctx });
    var self = this, any = false;

    hits.forEach(function (h) {
      // Interim results: only act on absolute references whose numbers are
      // clearly complete (more words follow), never on relative commands.
      if (!isFinal && (h.kind !== "reference" || !h.complete)) return;
      var key = h.kind === "nav" ? "nav:" + h.index : Ref.format(h);
      if (fired[key]) return;
      fired[key] = 1;
      if (h.kind !== "nav") {
        var last = self.recent[key];
        if (last && Date.now() - last < self.opts.cooldownMs) return;
        self.recent[key] = Date.now();
      }
      any = true;
      var conf = h.kind === "nav" ? 0.9 : (h.explicit ? (h.verse != null ? 0.97 : 0.85) : 0.55);
      self.onDetect({ ref: h, kind: h.kind, confidence: conf, heard: h.text });
    });

    if (isFinal) {
      this.wordBuffer = (this.wordBuffer + " " + text).split(/\s+/).slice(-30).join(" ");
      if (!any && this.opts.quotes) {
        var q = bible.matchQuote(this.wordBuffer);
        if (q) {
          var key = Ref.format(q);
          var last = this.recent[key];
          if (!last || Date.now() - last > this.opts.cooldownMs) {
            var cur = ctx && ctx.book === q.book && ctx.chapter === q.chapter && ctx.verse === q.verse;
            this.recent[key] = Date.now();
            if (!cur) this.onDetect({ ref: q, kind: "quote", confidence: Math.min(0.95, q.score), heard: "…" + this.wordBuffer.split(" ").slice(-10).join(" ") });
          }
          this.wordBuffer = "";
        }
      } else if (any) this.wordBuffer = "";
    }
  };

  root.OnStageListener = Listener;
})(this);
