#!/usr/bin/env node
/*
 * Downloads the offline speech models that are bundled into the installer:
 *   - Whisper base.en (int8 ONNX export from the sherpa-onnx project, MIT licence)
 *   - Silero VAD (voice activity detection, MIT licence)
 * Files are checked against SHA-256 hashes and skipped when already present.
 * Run with NODE_USE_ENV_PROXY=1 behind an HTTPS proxy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const OUT = path.join(__dirname, '..', 'resources', 'models');
const HF = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base.en/resolve/main/';
const FILES = [
  { dir: 'whisper-base.en', name: 'base.en-encoder.int8.onnx', url: HF + 'base.en-encoder.int8.onnx', sha256: 'ef6b936f4c9b1d90a3b68634b60c4ed8576b26172b33c2535ec0e933c9edb823' },
  { dir: 'whisper-base.en', name: 'base.en-decoder.int8.onnx', url: HF + 'base.en-decoder.int8.onnx', sha256: 'f7162ad6db2dbef16cfaeaa7f945b9d7dd9c1b8d472f6aca82f2273d185e4d41' },
  { dir: 'whisper-base.en', name: 'base.en-tokens.txt', url: HF + 'base.en-tokens.txt', sha256: '306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930' },
  { dir: 'vad', name: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' }
];

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function download(f) {
  const dest = path.join(OUT, f.dir, f.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && (await sha256(dest)) === f.sha256) { console.log('ok (cached)', f.dir + '/' + f.name); return; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(f.url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const tmp = dest + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      const got = await sha256(tmp);
      if (got !== f.sha256) throw new Error('checksum mismatch ' + got);
      fs.renameSync(tmp, dest);
      console.log('downloaded', f.dir + '/' + f.name, (fs.statSync(dest).size / 1e6).toFixed(1) + ' MB');
      return;
    } catch (e) {
      console.warn(`attempt ${attempt} failed for ${f.name}: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

(async () => {
  for (const f of FILES) await download(f);
  fs.writeFileSync(path.join(OUT, 'MODELS.txt'),
    'Whisper base.en (OpenAI, MIT licence), ONNX int8 export by the sherpa-onnx project (Apache-2.0).\n' +
    'Silero VAD (silero-team, MIT licence).\n');
  console.log('models ready in', OUT);
})().catch((e) => { console.error('fetch-models failed:', e.message); process.exit(1); });
