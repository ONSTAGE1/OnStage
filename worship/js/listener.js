/*
 * OnStage Worship — AI Verse Listener.
 * Streams microphone audio through the browser's speech recognition and
 * feeds the transcript into the reference detector and the quote matcher.
 *
 * Emits:
 *   onTranscript({final, interim})
 *   onDetect({ref, kind: reference|context|quote|nav, confidence, heard})
 *   onStatus(text, level)   level: ok | warn | error | idle
 *
 * Robustness: the microphone is opened first (clear permission errors and a
 * live level meter), every speech-service error is translated into plain
 * English with a fix, recognition is restarted automatically when the
 * browser stops it, and a watchdog stops endless silent restart loops.
 */
(function (root) {
  var Ref = root.OnStageSpeechRef;
  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  // In the desktop app speech is recognised offline by the built-in engine.
  var DESKTOP = root.onstageDesktop && root.onstageDesktop.speech ? root.onstageDesktop : null;

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
    this.recent = {};
    this.fired = {};
    this.wordBuffer = "";
    this.finalLog = "";
    this.level = 0;
    this.lastResultAt = 0;
    this.onTranscript = this.onDetect = this.onStatus = function () {};
  }

  Listener.engine = DESKTOP ? "offline" : "web";
  Listener.supported = DESKTOP ? true : !!SR;

  /* Look for known reasons speech recognition will not work here. */
  Listener.checkEnvironment = function () {
    if (DESKTOP) {
      var p = [];
      if (!navigator.mediaDevices || !root.AudioWorkletNode) p.push({ msg: "This computer's audio system could not be opened.", fix: "Restart OnStage Worship. If it keeps happening, update Windows/macOS." });
      return { browser: "OnStage Worship app (offline speech engine)", good: true, problems: p, offline: true };
    }
    var ua = navigator.userAgent || "";
    var problems = [];
    var browser = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Vivaldi/.test(ua) ? "Vivaldi" :
      /Firefox\//.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Electron/.test(ua) ? "Electron" :
      navigator.brave ? "Brave" : /Chrome\//.test(ua) ? "Google Chrome" : /Safari\//.test(ua) ? "Safari" : "this browser";
    var good = browser === "Google Chrome" || browser === "Microsoft Edge";
    if (!SR) problems.push({ msg: browser + " has no speech recognition.", fix: "Open OnStage Worship in Google Chrome or Microsoft Edge." });
    else if (!good && browser !== "Safari") problems.push({ msg: browser + " shows the speech feature but does not include the speech service, so nothing is recognised.", fix: "Use Google Chrome or Microsoft Edge." });
    else if (browser === "Safari") problems.push({ msg: "Safari only recognises speech when Siri is turned on, and it often stops after a short time.", fix: "Google Chrome works best. In Safari, turn on Siri in System Settings." });
    if (root.isSecureContext === false) problems.push({ msg: "The app is not on a secure address (https or localhost), so the browser blocks the microphone.", fix: "Use the start file, or open it from an https:// address." });
    if (navigator.onLine === false) problems.push({ msg: "This computer is offline.", fix: "Speech recognition needs internet. Connect to Wi-Fi or Ethernet." });
    return { browser: browser, good: good && !!SR, problems: problems };
  };

  /* Open the microphone (asks permission) and start a level meter. */
  Listener.prototype.openMic = function (opts) {
    var self = this;
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(friendlyMicError({ name: "NotSupported" }));
    }
    if (this.stream) return Promise.resolve(this.stream);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        self.stream = stream;
        try {
          var AC = root.AudioContext || root.webkitAudioContext;
          var ctx;
          if (opts.sampleRate) { try { ctx = new AC({ sampleRate: opts.sampleRate }); } catch (e) { ctx = null; } }
          ctx = self.audioCtx = ctx || new AC();
          var src = self.micSource = ctx.createMediaStreamSource(stream);
          var an = ctx.createAnalyser(); an.fftSize = 1024;
          src.connect(an);
          var buf = new Uint8Array(an.fftSize);
          var tick = function () {
            if (!self.stream) return;
            an.getByteTimeDomainData(buf);
            var sum = 0;
            for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; sum += v * v; }
            var rms = Math.sqrt(sum / buf.length);
            self.level = Math.min(1, rms * 4);
            if (self.level > 0.08) self.lastSoundAt = Date.now();
            self.raf = requestAnimationFrame(tick);
          };
          tick();
        } catch (e) { /* meter is optional */ }
        var track = stream.getAudioTracks()[0];
        self.micName = track ? track.label : "";
        return stream;
      })
      .catch(function (e) { throw friendlyMicError(e); });
  };

  Listener.prototype.closeMic = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.captureNode) { try { this.captureNode.port.onmessage = null; this.captureNode.disconnect(); } catch (e) {} this.captureNode = null; }
    this.micSource = null;
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    if (this.audioCtx) try { this.audioCtx.close(); } catch (e) {}
    this.stream = null; this.audioCtx = null; this.level = 0;
  };

  function friendlyMicError(e) {
    var n = e && e.name;
    if ((n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") && DESKTOP)
      return "Microphone access is turned off for OnStage Worship. Windows: Settings → Privacy & security → Microphone → turn on “Let desktop apps access your microphone”. Mac: System Settings → Privacy & Security → Microphone → turn on OnStage Worship. Then press Start listening again.";
    if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError")
      return "Microphone access is blocked. Click the padlock / settings icon at the left of the address bar (or in the app window's ⋯ menu → Site permissions), set Microphone to “Allow”, then press Start listening again. On Windows also check Settings → Privacy & security → Microphone → “Let desktop apps access your microphone”.";
    if (n === "NotFoundError" || n === "DevicesNotFoundError")
      return "No microphone was found. Plug in a microphone or an audio feed from the sound desk, then try again. On Windows, check Settings → System → Sound → Input.";
    if (n === "NotReadableError" || n === "TrackStartError")
      return "The microphone is being used by another program (e.g. Zoom, Teams or OBS) or Windows could not start it. Close the other program or choose another input in Windows Sound settings, then try again.";
    if (n === "NotSupported")
      return "This browser can't use the microphone here. Open OnStage Worship with the start file in Google Chrome or Microsoft Edge.";
    return "Couldn't open the microphone (" + (n || e) + ").";
  }

  Listener.prototype.start = function () {
    var self = this;
    if (DESKTOP) return this.startOffline();
    if (!SR) {
      this.onStatus("Speech recognition isn't available in this browser. Open OnStage Worship in Google Chrome or Microsoft Edge.", "error");
      return Promise.resolve(false);
    }
    if (this.running) return Promise.resolve(true);
    this.running = true;
    this.onStatus("Opening the microphone… (click “Allow” if the browser asks)", "warn");
    return this.openMic().then(function () {
      if (!self.running) { self.closeMic(); return false; }
      self.netErrors = 0; self.restarts = []; self.lastResultAt = Date.now(); self.everHeard = false;
      self.startRecognition();
      self.watch = setInterval(function () { self.watchdog(); }, 4000);
      return true;
    }).catch(function (msg) {
      self.running = false;
      self.onStatus(String(msg), "error");
      return false;
    });
  };

  Listener.prototype.startRecognition = function () {
    var self = this;
    var rec = this.rec = new SR();
    rec.lang = this.opts.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.fired = {};
    this.session = (this.session || 0) + 1;
    var thisSession = this.session;

    var responded = false;
    rec.onstart = function () {
      responded = true;
      self.serviceOk = true;
      self.onStatus("Listening" + (self.micName ? " on “" + self.micName + "”" : "") + "…", "ok");
    };
    // Some Chromium-based browsers expose the API but never answer at all.
    setTimeout(function () {
      if (responded || !self.running || thisSession !== self.session) return;
      if (self.serviceOk) { try { rec.abort(); } catch (e) {} self.startRecognition(); return; }
      self.fail("The speech service didn't respond. This browser doesn't provide speech recognition (Brave, Opera, Vivaldi, Chromium and some company-managed browsers don't). Open OnStage Worship in Google Chrome or Microsoft Edge, and check the internet connection.");
    }, 8000);
    rec.onaudiostart = function () { self.audioStarted = true; };
    rec.onerror = function (e) {
      responded = true;
      var err = e.error;
      if (err === "no-speech" || err === "aborted") return;
      if (err === "network") {
        self.netErrors++;
        if (self.netErrors >= 3) return self.fail("Can't reach the speech service. Check the internet connection. Brave, Opera, Vivaldi and some other browsers don't include speech recognition — use Google Chrome or Microsoft Edge.");
        self.onStatus("Speech service connection problem — retrying (" + self.netErrors + "/3)…", "warn");
        return;
      }
      if (err === "not-allowed" || err === "service-not-allowed")
        return self.fail("The browser blocked speech recognition. Allow the microphone for this page (padlock icon in the address bar). If it is already allowed, this browser doesn't provide the speech service — use Google Chrome or Microsoft Edge.");
      if (err === "audio-capture")
        return self.fail("No working microphone. Check the microphone is plugged in and selected as the default input in your computer's sound settings.");
      if (err === "language-not-supported" || err === "bad-grammar")
        return self.fail("This language isn't supported by the speech service. Choose “English (US)” under Listening options.");
      self.onStatus("Speech error: " + err + " — retrying", "warn");
    };
    rec.onend = function () {
      if (!self.running || thisSession !== self.session) return;
      // Browsers stop continuous recognition every so often — restart it.
      var now = Date.now();
      self.restarts = (self.restarts || []).filter(function (t) { return now - t < 30000; });
      self.restarts.push(now);
      if (self.restarts.length > 10 && now - self.lastResultAt > 30000) {
        return self.fail("The speech service keeps stopping without recognising anything. Check the internet connection and that you are using Google Chrome or Microsoft Edge, then press Start listening again.");
      }
      setTimeout(function () {
        if (self.running && thisSession === self.session) {
          try { self.startRecognition(); } catch (err) { /* will retry on next end */ }
        }
      }, self.restarts.length > 3 ? 1000 : 200);
    };
    rec.onresult = function (e) {
      responded = true;
      self.lastResultAt = Date.now();
      self.everHeard = true;
      self.netErrors = 0;
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i], txt = res[0].transcript;
        if (res.isFinal) {
          self.finalLog = (self.finalLog + " " + txt).slice(-4000);
          self.process(txt, true, thisSession + ":" + i);
        } else {
          interim += txt;
          if (self.opts.interim) self.process(txt, false, thisSession + ":" + i);
        }
      }
      self.onTranscript({ final: self.finalLog, interim: interim });
    };
    try { rec.start(); }
    catch (err) {
      if (err && err.name === "InvalidStateError") return; // already started
      self.fail("Couldn't start speech recognition: " + (err && err.message || err));
    }
  };

  /* Warn when sound is arriving but no words come back. */
  Listener.prototype.watchdog = function () {
    if (!this.running) return;
    var now = Date.now();
    var silentFor = now - this.lastResultAt;
    var hearingSound = this.lastSoundAt && now - this.lastSoundAt < 4000;
    if (silentFor > 15000 && hearingSound && DESKTOP) {
      this.onStatus("The microphone hears sound but no clear words yet. Speak clearly near the microphone, or plug in a feed from the sound desk for the best results.", "warn");
    } else if (silentFor > 15000 && hearingSound) {
      this.onStatus("The microphone hears sound but no words are coming back. Check the internet connection, that the language under Listening options matches the speaker, and that you're using Chrome or Edge.", "warn");
    } else if (silentFor > 20000 && !hearingSound) {
      this.onStatus("Listening, but the microphone is silent. Speak near it, raise its volume, or pick the right input in your computer's sound settings.", "warn");
    }
  };

  Listener.prototype.fail = function (msg) {
    this.stop();
    this.onStatus(msg, "error");
  };

  Listener.prototype.stop = function () {
    var wasRunning = this.running;
    this.running = false;
    this.session = (this.session || 0) + 1;
    clearInterval(this.watch);
    if (DESKTOP) {
      if (this.unsubEngine) { this.unsubEngine(); this.unsubEngine = null; }
      if (wasRunning) DESKTOP.speech.stop();
    }
    if (this.rec) try { this.rec.abort(); } catch (e) {}
    this.closeMic();
    this.onStatus("Stopped", "idle");
  };

  Listener.prototype.setLang = function (lang) {
    this.opts.lang = lang;
    if (DESKTOP) return; // the offline engine is English-only
    if (this.running && this.rec) { try { this.rec.abort(); } catch (e) {} } // onend restarts with new language
  };

  /* Quick self-test: microphone + speech service. Resolves to a list of checks. */
  Listener.prototype.diagnose = function () {
    var self = this;
    if (DESKTOP) return this.diagnoseOffline();
    var env = Listener.checkEnvironment();
    var checks = [{ name: "Browser", ok: env.good, detail: env.browser }];
    env.problems.forEach(function (p) { checks.push({ name: "Problem", ok: false, detail: p.msg, fix: p.fix }); });
    var wasRunning = this.running;
    var micPromise = wasRunning ? Promise.resolve(this.stream) : this.openMic();
    return micPromise.then(function () {
      checks.push({ name: "Microphone", ok: true, detail: "Allowed" + (self.micName ? " — using “" + self.micName + "”" : "") });
      return new Promise(function (resolve) {
        var peak = 0, t0 = Date.now();
        var iv = setInterval(function () {
          peak = Math.max(peak, self.level);
          if (Date.now() - t0 > 2500) { clearInterval(iv); resolve(peak); }
        }, 50);
      });
    }).then(function (peak) {
      checks.push(peak > 0.05
        ? { name: "Sound level", ok: true, detail: "Sound is reaching the microphone" }
        : { name: "Sound level", ok: false, detail: "No sound detected during the test", fix: "Speak while the test runs, raise the microphone volume, or choose the right input in your computer's sound settings." });
      if (!SR || wasRunning) return null;
      return new Promise(function (resolve) {
        var rec = new SR(), done = false;
        rec.lang = self.opts.lang; rec.interimResults = true; rec.continuous = false;
        var finish = function (r) { if (done) return; done = true; try { rec.abort(); } catch (e) {} resolve(r); };
        rec.onresult = function (e) { finish({ ok: true, detail: "Heard: “" + e.results[0][0].transcript + "”" }); };
        rec.onerror = function (e) {
          finish(e.error === "no-speech"
            ? { ok: true, warn: true, detail: "Service reachable, but no words were heard. Say something during the test." }
            : { ok: false, detail: "Error: " + e.error, fix: e.error === "network" ? "Check the internet. Brave/Opera/Vivaldi don't include the speech service — use Chrome or Edge." : "Allow the microphone for this page, and use Chrome or Edge." });
        };
        rec.onend = function () { finish({ ok: true, warn: true, detail: "Service started, but no words were heard. Say something during the test." }); };
        setTimeout(function () { finish({ ok: false, detail: "No response from the speech service", fix: "Check the internet connection and use Google Chrome or Microsoft Edge." }); }, 9000);
        try { rec.start(); } catch (e) { finish({ ok: false, detail: String(e) }); }
      });
    }).then(function (svc) {
      if (svc) checks.push(Object.assign({ name: "Speech service" }, svc));
      if (!wasRunning) self.closeMic();
      return checks;
    }).catch(function (msg) {
      checks.push({ name: "Microphone", ok: false, detail: String(msg) });
      if (!wasRunning) self.closeMic();
      return checks;
    });
  };

  /* ---------------- Offline engine (desktop app) ---------------- */
  // Audio is captured at 16 kHz in an AudioWorklet and streamed to the
  // built-in Whisper engine; results come back as interim/final text.
  var WORKLET = "class P extends AudioWorkletProcessor{constructor(o){super();this.r=o.processorOptions.ratio;this.sum=0;this.cnt=0;this.pos=0;this.buf=new Float32Array(1600);this.n=0;}" +
    "process(inputs){var c=inputs[0]&&inputs[0][0];if(!c)return true;for(var i=0;i<c.length;i++){this.sum+=c[i];this.cnt++;this.pos+=1;if(this.pos>=this.r){this.pos-=this.r;this.out(this.sum/this.cnt);this.sum=0;this.cnt=0;}}return true;}" +
    "out(v){this.buf[this.n++]=v;if(this.n===1600){this.port.postMessage(this.buf,[this.buf.buffer]);this.buf=new Float32Array(1600);this.n=0;}}}registerProcessor('onstage-pcm16k',P);";

  Listener.prototype.startCapture = function () {
    var self = this, ctx = this.audioCtx;
    if (!ctx || !this.micSource) return Promise.reject("The microphone could not be opened.");
    var url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    return ctx.audioWorklet.addModule(url).then(function () {
      var node = new AudioWorkletNode(ctx, "onstage-pcm16k", { numberOfInputs: 1, numberOfOutputs: 1, processorOptions: { ratio: ctx.sampleRate / 16000 } });
      var mute = ctx.createGain(); mute.gain.value = 0;
      node.port.onmessage = function (e) { if (self.running) DESKTOP.speech.audio(e.data); };
      self.micSource.connect(node); node.connect(mute); mute.connect(ctx.destination);
      self.captureNode = node;
      if (ctx.state === "suspended") ctx.resume();
    });
  };

  Listener.prototype.startOffline = function () {
    var self = this;
    if (this.running) return Promise.resolve(true);
    this.running = true;
    this.onStatus("Starting the offline speech engine…", "warn");
    return DESKTOP.speech.start().then(function (r) {
      if (!r || !r.ok) throw (r && r.error) || "The speech engine could not start.";
      if (!self.running) return false;
      self.engineInfo = r;
      return self.openMic({ sampleRate: 16000 }).then(function () { return self.startCapture(); }).then(function () {
        if (!self.running) { self.closeMic(); return false; }
        self.fired = {}; self.session = (self.session || 0) + 1;
        self.lastResultAt = Date.now(); self.everHeard = false; self.prevFinal = "";
        self.unsubEngine = DESKTOP.speech.onEvent(function (m) { self.onEngineEvent(m); });
        DESKTOP.speech.options({ interim: !!self.opts.interim });
        self.watch = setInterval(function () { self.watchdog(); }, 4000);
        self.onStatus("Listening (offline)" + (self.micName ? " on “" + self.micName + "”" : "") + "…", "ok");
        return true;
      });
    }).catch(function (err) {
      self.running = false;
      self.closeMic();
      self.onStatus(String((err && err.message) || err), "error");
      return false;
    });
  };

  Listener.prototype.onEngineEvent = function (m) {
    if (!this.running || !m) return;
    if (m.type === "result") {
      var text = String(m.text || "").trim();
      this.lastResultAt = Date.now();
      if (m.final) {
        if (text) {
          this.everHeard = true;
          this.finalLog = (this.finalLog + " " + text).slice(-4000);
          // A reference can be split across two phrases ("turn to Romans chapter" | "eight verse twenty eight"),
          // so the end of the previous phrase is included; repeats are filtered by the repeat guard.
          var tail = (this.prevFinal || "").split(" ").slice(-6).join(" ");
          this.process(text, true, "off:" + this.session + ":" + m.id, tail);
          this.prevFinal = text;
        }
        this.onTranscript({ final: this.finalLog, interim: "" });
      } else if (text) {
        if (this.opts.interim) this.process(text, false, "off:" + this.session + ":" + m.id);
        this.onTranscript({ final: this.finalLog, interim: text });
      }
    } else if (m.type === "exit") {
      this.fail("The speech engine stopped unexpectedly. Press Start listening to restart it.");
    } else if (m.type === "error") {
      this.onStatus("Speech engine: " + m.message, "warn");
    }
  };

  /* Mic check in the desktop app: microphone, sound level, and a short offline recognition test. */
  Listener.prototype.diagnoseOffline = function () {
    var self = this;
    var checks = [{ name: "Speech engine", ok: true, detail: "Offline (built in) — no internet needed" }];
    if (this.running) {
      checks.push({ name: "Microphone", ok: true, detail: "In use" + (self.micName ? " — “" + self.micName + "”" : "") });
      checks.push({ name: "Listening", ok: true, detail: "The AI is listening now. Say “John chapter 3 verse 16” to see it work." });
      return Promise.resolve(checks);
    }
    var heard = [], unsub = null;
    return DESKTOP.speech.start().then(function (r) {
      if (!r || !r.ok) throw (r && r.error) || "The speech engine could not start.";
      checks[0].detail = "Ready (" + (r.engine || "offline") + ", loaded in " + Math.round((r.loadMs || 0) / 100) / 10 + " s)";
      return self.openMic({ sampleRate: 16000 });
    }).then(function () {
      checks.push({ name: "Microphone", ok: true, detail: "Allowed" + (self.micName ? " — using “" + self.micName + "”" : "") });
      self.running = true; // let the capture stream audio for the test
      return self.startCapture();
    }).then(function () {
      unsub = DESKTOP.speech.onEvent(function (m) { if (m.type === "result" && m.final && m.text) heard.push(m.text); });
      return new Promise(function (resolve) {
        var peak = 0, t0 = Date.now();
        var iv = setInterval(function () {
          peak = Math.max(peak, self.level);
          if (Date.now() - t0 > 6000) { clearInterval(iv); DESKTOP.speech.stop(); setTimeout(function () { resolve(peak); }, 2500); }
        }, 50);
      });
    }).then(function (peak) {
      self.running = false;
      if (unsub) unsub();
      self.closeMic();
      checks.push(peak > 0.05
        ? { name: "Sound level", ok: true, detail: "Sound is reaching the microphone" }
        : { name: "Sound level", ok: false, detail: "No sound detected during the test", fix: "Speak while the test runs, raise the microphone volume, or choose the right input in your computer's sound settings." });
      checks.push(heard.length
        ? { name: "Recognition", ok: true, detail: "Heard: “" + heard.join(" ") + "”" }
        : { name: "Recognition", ok: true, warn: true, detail: "No words were recognised. Speak a sentence during the test (for example “John chapter 3 verse 16”)." });
      return checks;
    }).catch(function (msg) {
      self.running = false;
      if (unsub) unsub();
      self.closeMic();
      checks.push({ name: "Problem", ok: false, detail: String((msg && msg.message) || msg) });
      return checks;
    });
  };

  /* Feed text (from the mic or typed into the simulator). */
  Listener.prototype.process = function (text, isFinal, resultId, prefix) {
    var bible = this.opts.getBible();
    if (!bible) return;
    resultId = resultId || ("manual:" + Date.now());
    var fired = this.fired[resultId] || (this.fired[resultId] = {});
    var ctx = this.opts.getContext ? this.opts.getContext() : null;
    var hits = Ref.detect((prefix ? prefix + " " : "") + text, bible, { context: ctx });
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
