#!/usr/bin/env node
/*
 * Copies the shared web app (../worship) into ./web so it is packaged inside
 * the desktop app. Browser-only helpers (the .bat/.command launchers, the
 * service worker and the web install manifest) are left out.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'worship');
const DEST = path.join(__dirname, '..', 'web');
const SKIP = new Set(['launcher', 'Start OnStage Worship.bat', 'Start OnStage Worship (Mac).command', 'READ ME FIRST.txt', 'README.md', 'sw.js', 'manifest.webmanifest']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (from === SRC && SKIP.has(entry.name)) continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error('Cannot find the web app at', SRC);
  process.exit(1);
}
fs.rmSync(DEST, { recursive: true, force: true });
copyDir(SRC, DEST);
console.log('web app copied to', DEST);
