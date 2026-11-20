'use strict';
/*
 * OnStage Worship — desktop app (Electron main process).
 *
 * - Console window: the shared web app (web/index.html).
 * - Output and stage-display windows: full screen on the chosen projector/TV.
 * - Offline AI speech engine: Whisper + voice-activity detection running in a
 *   separate utility process (speech-worker.js), so the console never stutters.
 */
const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog, session, powerSaveBlocker, utilityProcess, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

const SELFTEST = process.argv.includes('--selftest');
const WEB_DIR = resolveWebDir();
const PRELOAD = path.join(__dirname, 'preload.js');

let mainWin = null;
const outputs = { output: null, stage: null };
let lastState = null;
let sleepBlockId = null;

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */
let logFile = null;
function log() {
  const line = '[' + new Date().toISOString() + '] ' + Array.prototype.map.call(arguments, (a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try {
    if (!logFile) { const dir = app.getPath('logs'); fs.mkdirSync(dir, { recursive: true }); logFile = path.join(dir, 'main.log'); }
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) { /* logging must never break the app */ }
  if (!app.isPackaged || SELFTEST) console.log(line);
}

function resolveWebDir() {
  const packaged = path.join(__dirname, 'web');
  const dev = path.join(__dirname, '..', 'worship');
  if (!app.isPackaged && process.env.ONSTAGE_USE_SOURCE === '1' && fs.existsSync(path.join(dev, 'index.html'))) return dev;
  return packaged;
}

function iconPath() {
  const p = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

/* ------------------------------------------------------------------ */
/* Single instance                                                     */
/* ------------------------------------------------------------------ */
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWin) return;
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  });
  if (process.platform === 'win32') app.setAppUserModelId('com.onstage.worship');
  app.whenReady().then(onReady).catch((e) => { log('startup failed', String(e && e.stack || e)); dialog.showErrorBox('OnStage Worship', 'Could not start: ' + e.message); app.exit(1); });
}

function onReady() {
  log('starting', app.getVersion(), process.platform, process.arch, 'electron', process.versions.electron);
  setupPermissions();
  setupDownloads();
  buildMenu();
  setupIpc();
  createMainWindow();
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
  if (SELFTEST) runSelfTest();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { stopSpeech(); });

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */
function webPrefs() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' };
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0c0e', show: false, title: 'OnStage Worship', icon: iconPath(),
    webPreferences: webPrefs()
  });
  guardNavigation(mainWin);
  mainWin.loadFile(path.join(WEB_DIR, 'index.html'));
  mainWin.once('ready-to-show', () => { if (!SELFTEST) mainWin.maximize(); mainWin.show(); });
  mainWin.on('closed', () => { mainWin = null; closeAllOutputs(); });
  mainWin.webContents.on('render-process-gone', (e, d) => log('console renderer gone', d));
}

/* Keep every window on the app: external links open in the browser, dropped files never navigate away. */
function guardNavigation(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url === wc.getURL()) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

/* ------------------------------------------------------------------ */
/* Screens: output + stage display                                     */
/* ------------------------------------------------------------------ */
function consoleDisplay() {
  return mainWin && !mainWin.isDestroyed() ? screen.getDisplayMatching(mainWin.getBounds()) : screen.getPrimaryDisplay();
}

function listDisplays() {
  const primary = screen.getPrimaryDisplay();
  const cons = consoleDisplay();
  return screen.getAllDisplays().map((d, i) => {
    const w = Math.round(d.size.width * d.scaleFactor), h = Math.round(d.size.height * d.scaleFactor);
    const name = d.label && d.label.trim() ? d.label.trim() : 'Screen ' + (i + 1);
    return {
      id: String(d.id), name: name, width: w, height: h, primary: d.id === primary.id, console: d.id === cons.id,
      label: name + ' — ' + w + '×' + h + (d.id === cons.id ? ' (this screen)' : '')
    };
  });
}

function pickDisplay(role, displayId) {
  const all = screen.getAllDisplays();
  const chosen = all.find((d) => String(d.id) === String(displayId));
  if (chosen) return chosen;
  const cons = consoleDisplay();
  const others = all.filter((d) => d.id !== cons.id);
  if (role === 'stage') return others[1] || others[0] || cons;
  return others[0] || cons;
}

function placeOutput(win, d) {
  const same = d.id === consoleDisplay().id;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (process.platform === 'darwin' && win.isSimpleFullScreen()) win.setSimpleFullScreen(false);
  if (same) {
    // Only one screen: open a normal window the operator can drag to a projector later.
    const w = Math.round(d.workArea.width * 0.55), h = Math.round(w * 9 / 16);
    win.setBounds({ x: d.workArea.x + d.workArea.width - w - 40, y: d.workArea.y + 60, width: w, height: h });
  } else {
    win.setBounds(d.bounds);
    if (process.platform === 'darwin') win.setSimpleFullScreen(true);
    else win.setFullScreen(true);
  }
  return same;
}

function openOutput(role, displayId) {
  role = role === 'stage' ? 'stage' : 'output';
  const d = pickDisplay(role, displayId);
  let win = outputs[role];
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: 960, height: 540, show: false,
      backgroundColor: '#000000', title: role === 'stage' ? 'OnStage Stage Display' : 'OnStage Output',
      autoHideMenuBar: true, icon: iconPath(), webPreferences: webPrefs()
    });
    win.setMenuBarVisibility(false);
    guardNavigation(win);
    win.loadFile(path.join(WEB_DIR, 'output.html'), role === 'stage' ? { query: { stage: '1' } } : {});
    win.on('closed', () => {
      outputs[role] = null;
      updateSleepBlock();
      send('output:closed', role);
    });
    outputs[role] = win;
    win.once('ready-to-show', () => {
      placeOutput(win, d);
      win.showInactive();
      if (mainWin) mainWin.focus();
    });
  } else {
    placeOutput(win, d);
    win.showInactive();
  }
  updateSleepBlock();
  log('output', role, 'on display', d.id);
  return { ok: true, role: role, displayId: String(d.id), sameScreen: d.id === consoleDisplay().id };
}

function closeOutput(role) {
  const w = outputs[role];
  if (w && !w.isDestroyed()) w.close();
}
function closeAllOutputs() { closeOutput('output'); closeOutput('stage'); }

/* Stop the projector or laptop from going to sleep while an output is open. */
function updateSleepBlock() {
  const any = Object.values(outputs).some((w) => w && !w.isDestroyed());
  if (any && sleepBlockId === null) sleepBlockId = powerSaveBlocker.start('prevent-display-sleep');
  if (!any && sleepBlockId !== null) { powerSaveBlocker.stop(sleepBlockId); sleepBlockId = null; }
}

function onDisplaysChanged() {
  const ids = screen.getAllDisplays().map((d) => d.id);
  for (const role of Object.keys(outputs)) {
    const w = outputs[role];
    if (!w || w.isDestroyed()) continue;
    const on = screen.getDisplayMatching(w.getBounds());
    if (!ids.includes(on.id) || (on.id === consoleDisplay().id && w.isFullScreen())) placeOutput(w, consoleDisplay());
  }
  send('displays:changed', listDisplays());
}

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

/* ------------------------------------------------------------------ */
/* Offline speech engine                                               */
/* ------------------------------------------------------------------ */
const speech = { proc: null, ready: null, listeners: new Set() };

function modelPaths() {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'resources', 'models');
  return {
    encoder: path.join(base, 'whisper-base.en', 'base.en-encoder.int8.onnx'),
    decoder: path.join(base, 'whisper-base.en', 'base.en-decoder.int8.onnx'),
    tokens: path.join(base, 'whisper-base.en', 'base.en-tokens.txt'),
    vad: path.join(base, 'vad', 'silero_vad.onnx')
  };
}

function nativeDir() {
  const plat = process.platform === 'win32' ? 'win' : process.platform;
  const dir = path.join(path.dirname(require.resolve('sherpa-onnx-node/package.json')), '..', 'sherpa-onnx-' + plat + '-' + process.arch);
  return dir.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

function ensureSpeech() {
  if (speech.ready) return speech.ready;
  const models = modelPaths();
  const missing = Object.values(models).filter((f) => !fs.existsSync(f));
  if (missing.length) return Promise.reject(new Error('The offline speech model is missing (' + path.basename(missing[0]) + '). Please reinstall OnStage Worship.'));
  const env = Object.assign({}, process.env);
  const nd = nativeDir();
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = nd + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '');
  if (process.platform === 'linux') env.LD_LIBRARY_PATH = nd + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
  const proc = utilityProcess.fork(path.join(__dirname, 'speech-worker.js'), [], { serviceName: 'OnStage Speech Engine', env: env, stdio: 'pipe' });
  speech.proc = proc;
  if (proc.stdout) proc.stdout.on('data', (d) => log('[speech]', String(d).trim()));
  if (proc.stderr) proc.stderr.on('data', (d) => log('[speech:err]', String(d).trim()));
  let settled = false;
  speech.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('The speech engine took too long to start.')); } }, 90000);
    proc.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready' && !settled) { settled = true; clearTimeout(timer); log('speech ready', m); resolve(m); }
      else if (m.type === 'error' && !settled) { settled = true; clearTimeout(timer); reject(new Error(m.message)); }
      speech.listeners.forEach((fn) => fn(m));
      send('speech:event', m);
    });
    proc.on('exit', (code) => {
      log('speech engine exited', code);
      speech.proc = null; speech.ready = null;
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('The speech engine stopped (code ' + code + ').')); }
      else send('speech:event', { type: 'exit', code: code });
    });
    proc.postMessage({ type: 'init', models: models });
  });
  speech.ready.catch((e) => { log('speech start failed', e.message); speech.ready = null; if (speech.proc) { try { speech.proc.kill(); } catch (x) { /* ignore */ } } });
  return speech.ready;
}

function stopSpeech() {
  if (speech.proc) { try { speech.proc.kill(); } catch (e) { /* ignore */ } }
  speech.proc = null; speech.ready = null;
}

async function askMicAccess() {
  if (process.platform !== 'darwin') return true;
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    return await systemPreferences.askForMediaAccess('microphone');
  } catch (e) { return true; }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
function fromMain(e) { return mainWin && e.sender === mainWin.webContents; }

function setupIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, userData: app.getPath('userData'),
    speechEngine: 'Whisper base (English), offline'
  }));
  ipcMain.handle('app:notices', () => {
    try { return fs.readFileSync(path.join(__dirname, 'THIRD-PARTY-NOTICES.txt'), 'utf8'); } catch (e) { return ''; }
  });
  ipcMain.handle('app:openExternal', (e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); });
  ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('displays:list', () => listDisplays());
  ipcMain.handle('output:open', (e, opts) => { if (!fromMain(e)) return { ok: false }; opts = opts || {}; return openOutput(opts.role, opts.displayId); });
  ipcMain.handle('output:close', (e, role) => { if (!fromMain(e)) return; if (role) closeOutput(role); else closeAllOutputs(); });
  ipcMain.handle('output:status', () => ({ output: !!(outputs.output && !outputs.output.isDestroyed()), stage: !!(outputs.stage && !outputs.stage.isDestroyed()) }));
  ipcMain.on('output:state', (e, state) => {
    if (!fromMain(e)) return;
    lastState = state;
    for (const w of Object.values(outputs)) if (w && !w.isDestroyed()) w.webContents.send('output:state', state);
  });
  ipcMain.handle('output:hello', () => lastState);
  ipcMain.on('output:key', (e, key) => { if (typeof key === 'string' && key.length < 20) send('output:key', key); });

  ipcMain.handle('speech:start', async (e) => {
    if (!fromMain(e)) return { ok: false, error: 'not allowed' };
    const mic = await askMicAccess();
    if (!mic) return { ok: false, error: 'Microphone access is turned off for OnStage Worship. Open System Settings → Privacy & Security → Microphone and switch it on.' };
    try {
      const info = await ensureSpeech();
      if (speech.proc) speech.proc.postMessage({ type: 'reset' });
      return { ok: true, engine: 'Whisper base (offline)', loadMs: info.loadMs, threads: info.threads };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.on('speech:audio', (e, samples) => {
    if (!speech.proc || !fromMain(e)) return;
    speech.proc.postMessage({ type: 'audio', samples: samples });
  });
  ipcMain.on('speech:stop', (e) => { if (speech.proc && fromMain(e)) speech.proc.postMessage({ type: 'flush' }); });
  ipcMain.on('speech:options', (e, options) => { if (speech.proc && fromMain(e)) speech.proc.postMessage({ type: 'options', options: options }); });
}

/* ------------------------------------------------------------------ */
/* Permissions & downloads                                             */
/* ------------------------------------------------------------------ */
function setupPermissions() {
  const allowed = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'window-management']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media') return callback((details.mediaTypes || ['audio']).every((t) => t === 'audio'));
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
}

function setupDownloads() {
  // Saving schedules, song libraries and backups: ask where to save, starting in Documents.
  session.defaultSession.on('will-download', (e, item) => {
    item.setSaveDialogOptions({ title: 'Save', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */
function menuAction(action) { return () => send('menu', action); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) template.push({ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] });
  template.push(
    { label: 'File', submenu: [
      { label: 'New Schedule', accelerator: 'CmdOrCtrl+N', click: menuAction('newSchedule') },
      { label: 'Open Schedule…', accelerator: 'CmdOrCtrl+O', click: menuAction('openSchedule') },
      { label: 'Save Schedule…', accelerator: 'CmdOrCtrl+S', click: menuAction('saveSchedule') },
      { type: 'separator' },
      { label: 'Back Up Everything…', click: menuAction('backupExport') },
      { label: 'Restore a Backup…', click: menuAction('backupImport') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }
    ] },
    { role: 'editMenu' },
    { label: 'Screens', submenu: [
      { label: 'Show Output on Projector', accelerator: 'CmdOrCtrl+Shift+O', click: menuAction('openOutput') },
      { label: 'Show Stage Display', accelerator: 'CmdOrCtrl+Shift+D', click: menuAction('openStage') },
      { label: 'Choose Screens…', click: menuAction('screens') },
      { type: 'separator' },
      { label: 'Close Output Windows', click: () => closeAllOutputs() }
    ] },
    { label: 'View', submenu: [
      { role: 'togglefullscreen' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])
    ] },
    { label: 'Help', submenu: [
      { label: 'OnStage Worship Help', accelerator: 'F1', click: menuAction('help') },
      { label: 'Microphone Check', click: menuAction('micCheck') },
      { type: 'separator' },
      { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Open Log Folder', click: () => shell.openPath(app.getPath('logs')) },
      { label: 'Third-Party Notices', click: menuAction('notices') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'About OnStage Worship', click: showAbout }])
    ] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({ applicationName: 'OnStage Worship', applicationVersion: app.getVersion(), credits: 'Offline AI verse detection with Whisper and sherpa-onnx.' });
}

function showAbout() {
  dialog.showMessageBox(mainWin, {
    type: 'info', title: 'About OnStage Worship', buttons: ['OK'],
    message: 'OnStage Worship ' + app.getVersion(),
    detail: 'Church presentation software with an offline AI Bible-verse assistant.\n\nSpeech recognition: Whisper base (OpenAI) running locally through sherpa-onnx — no internet needed.\nElectron ' + process.versions.electron + ' · ' + process.platform + ' ' + process.arch
  });
}

/* ------------------------------------------------------------------ */
/* Self-test (used by the build pipeline): UI loads, the offline speech */
/* engine transcribes a recorded sentence, the detector finds the verse */
/* and an output window opens.                                          */
/* ------------------------------------------------------------------ */
function runSelfTest() {
  const result = {};
  const done = (ok) => {
    console.log('SELFTEST ' + (ok ? 'PASS' : 'FAIL') + ' ' + JSON.stringify(result));
    setTimeout(() => app.exit(ok ? 0 : 1), 300);
  };
  const watchdog = setTimeout(() => { result.error = 'timeout'; done(false); }, 180000);
  mainWin.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      result.ui = await mainWin.webContents.executeJavaScript('Boolean(window.OnStageApp && window.onstageDesktop && document.querySelector("#micBtn"))');
      const t0 = Date.now();
      const info = await ensureSpeech();
      result.engine = { loadMs: info.loadMs, threads: info.threads, version: info.version };
      const wav = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources'), 'selftest.wav');
      const finals = [];
      await new Promise((resolve, reject) => {
        const fn = (m) => {
          if (m.type === 'result' && m.final) finals.push(m.text);
          if (m.type === 'selftest-done') { speech.listeners.delete(fn); resolve(); }
          if (m.type === 'error') { speech.listeners.delete(fn); reject(new Error(m.message)); }
        };
        speech.listeners.add(fn);
        speech.proc.postMessage({ type: 'selftest', file: wav });
      });
      result.transcript = finals.join(' ').trim();
      result.speechMs = Date.now() - t0;
      result.detected = await mainWin.webContents.executeJavaScript(
        'OnStageSpeechRef.detect(' + JSON.stringify(result.transcript) + ', OnStageBible.get("KJV"), {mode:"spoken"}).map(OnStageSpeechRef.format)');
      openOutput('output');
      await new Promise((r) => setTimeout(r, 2500));
      result.outputOpen = !!(outputs.output && !outputs.output.isDestroyed());
      result.outputLoaded = result.outputOpen ? await outputs.output.webContents.executeJavaScript('Boolean(document.querySelector(".os-stage"))') : false;
      clearTimeout(watchdog);
      done(Boolean(result.ui && result.detected.indexOf('John 3:16') >= 0 && result.outputLoaded));
    } catch (e) {
      clearTimeout(watchdog);
      result.error = String(e && e.message || e);
      done(false);
    }
  });
}
