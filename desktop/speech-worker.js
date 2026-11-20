'use strict';
/*
 * OnStage Worship — offline speech engine (runs in an Electron utility process).
 *
 * Microphone audio (16 kHz mono Float32) arrives in small chunks. Silero VAD
 * finds where speech starts and stops; each finished phrase is transcribed by
 * Whisper base (English) and sent back as a "final" result. While someone is
 * still talking, the phrase so far is transcribed every ~1.2 s as an
 * "interim" result, so a verse can appear before the speaker pauses.
 * Nothing leaves this computer.
 */
const os = require('os');

const port = process.parentPort;
const SR = 16000;
const VAD_WINDOW = 512;            // Silero VAD works on 32 ms windows
const PREROLL = Math.round(SR * 0.4);
const MAX_INTERIM = SR * 8;

let sherpa = null, rec = null, vad = null;
let queue = new Float32Array(0);   // samples waiting for the VAD
let live = [], liveLen = 0;        // the phrase currently being spoken
let preroll = [], prerollLen = 0;  // audio just before speech started
let inSpeech = false, lastInterimAt = 0, decoding = false;
let finals = [];                   // finished phrases waiting to be transcribed
let seq = 0;
let selftestPending = false;
const opts = { interim: true, interimEveryMs: 1200, maxTokensPerSecond: 12 };

function post(msg) { port.postMessage(msg); }
function fail(err) { post({ type: 'error', message: String((err && err.message) || err) }); }

port.on('message', (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'init') init(m);
    else if (m.type === 'audio') onAudio(m.samples);
    else if (m.type === 'flush') flush();
    else if (m.type === 'reset') reset();
    else if (m.type === 'options') Object.assign(opts, m.options || {});
    else if (m.type === 'selftest') selftest(m.file);
  } catch (err) { fail(err); }
});

function init(m) {
  const t0 = Date.now();
  sherpa = require('sherpa-onnx-node');
  const cpus = (os.cpus() || []).length || 2;
  const threads = Math.max(1, Math.min(4, cpus - 1));
  rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: {
      whisper: { encoder: m.models.encoder, decoder: m.models.decoder, language: 'en', task: 'transcribe', tailPaddings: -1 },
      tokens: m.models.tokens, numThreads: threads, provider: 'cpu', debug: 0
    }
  });
  vad = new sherpa.Vad({
    sileroVad: { model: m.models.vad, threshold: 0.5, minSilenceDuration: 0.35, minSpeechDuration: 0.25, maxSpeechDuration: 8, windowSize: VAD_WINDOW },
    sampleRate: SR, debug: false, numThreads: 1
  }, 30);
  post({ type: 'ready', loadMs: Date.now() - t0, threads: threads, version: sherpa.version });
}

function reset() {
  if (vad) vad.reset();
  queue = new Float32Array(0); live = []; liveLen = 0; preroll = []; prerollLen = 0; inSpeech = false; finals = [];
}

function onAudio(samples) {
  if (!vad || !samples) return;
  const s = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const q = new Float32Array(queue.length + s.length);
  q.set(queue, 0); q.set(s, queue.length); queue = q;
  let off = 0;
  while (queue.length - off >= VAD_WINDOW) {
    const w = queue.slice(off, off + VAD_WINDOW);
    off += VAD_WINDOW;
    vad.acceptWaveform(w);
    while (!vad.isEmpty()) {
      const seg = vad.front(false); // copy: Electron forbids external buffers
      vad.pop();
      finals.push(Float32Array.from(seg.samples));
      live = []; liveLen = 0;
    }
    if (vad.isDetected()) {
      if (!inSpeech) { inSpeech = true; live = preroll; liveLen = prerollLen; preroll = []; prerollLen = 0; lastInterimAt = Date.now(); post({ type: 'speech', active: true }); }
      live.push(w); liveLen += w.length;
    } else {
      if (inSpeech) { inSpeech = false; live = []; liveLen = 0; post({ type: 'speech', active: false }); }
      preroll.push(w); prerollLen += w.length;
      while (prerollLen > PREROLL && preroll.length > 1) prerollLen -= preroll.shift().length;
    }
  }
  queue = queue.slice(off);
  pump();
}

function flush() {
  if (!vad) return;
  vad.flush();
  while (!vad.isEmpty()) { const seg = vad.front(false); vad.pop(); finals.push(Float32Array.from(seg.samples)); }
  live = []; liveLen = 0; inSpeech = false;
  pump();
}

function concat(chunks, maxLen) {
  let n = 0; for (const c of chunks) n += c.length;
  const out = new Float32Array(Math.min(n, maxLen || n));
  let pos = out.length;
  for (let i = chunks.length - 1; i >= 0 && pos > 0; i--) {
    const c = chunks[i];
    const take = Math.min(c.length, pos);
    out.set(c.subarray(c.length - take), pos - take);
    pos -= take;
  }
  return out;
}

const HALLUCINATIONS = /^(?:thank you\.?|thanks for watching[.!]?|thank you for watching[.!]?|you\.?|bye\.?|\.+|-+)$/i;
function cleanText(text, seconds) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\[[^\]]*\]$|^\([^)]*\)$/g, '');           // [MUSIC], (applause)
  if (HALLUCINATIONS.test(t) && seconds < 3) return '';
  return t;
}

async function recognize(samples) {
  const stream = rec.createStream();
  try { stream.setOption('max_tokens_per_second', String(opts.maxTokensPerSecond)); } catch (e) { /* older engines */ }
  stream.acceptWaveform({ samples: samples, sampleRate: SR });
  const r = await rec.decodeAsync(stream);
  return cleanText(r && r.text, samples.length / SR);
}

async function pump() {
  if (decoding || !rec) return;
  if (finals.length) {
    decoding = true;
    const samples = finals.shift();
    const id = seq++;
    try {
      const t0 = Date.now();
      const text = await recognize(samples);
      post({ type: 'result', final: true, text: text, id: id, seconds: +(samples.length / SR).toFixed(2), ms: Date.now() - t0 });
    } catch (err) { fail(err); }
    decoding = false; lastInterimAt = Date.now();
    setImmediate(pump);
    return;
  }
  if (opts.interim && inSpeech && liveLen >= SR && Date.now() - lastInterimAt >= opts.interimEveryMs) {
    decoding = true;
    const samples = concat(live, MAX_INTERIM);
    try {
      const text = await recognize(samples);
      if (text && inSpeech) post({ type: 'result', final: false, text: text, id: seq });
    } catch (err) { fail(err); }
    decoding = false; lastInterimAt = Date.now();
    setImmediate(pump);
    return;
  }
  if (selftestPending && !finals.length && !decoding) { selftestPending = false; post({ type: 'selftest-done' }); }
}

/* Feed a recorded sentence through the same path as the microphone. */
function selftest(file) {
  const w = sherpa.readWave(file, false);
  reset();
  const lead = new Float32Array(SR / 2);
  onAudio(lead);
  for (let i = 0; i < w.samples.length; i += 1600) onAudio(w.samples.slice(i, i + 1600));
  onAudio(new Float32Array(SR));
  selftestPending = true;
  flush();
}
