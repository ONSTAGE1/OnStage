'use strict';
/*
 * The only bridge between the web app and the desktop. The page gets a small,
 * fixed API (window.onstageDesktop) and never sees Node.js or Electron.
 */
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, fn) {
  const handler = (event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('onstageDesktop', {
  isDesktop: true,
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  notices: () => ipcRenderer.invoke('app:notices'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  onMenu: (fn) => on('menu', fn),

  // projector / stage screens
  displays: () => ipcRenderer.invoke('displays:list'),
  onDisplaysChanged: (fn) => on('displays:changed', fn),
  openOutput: (opts) => ipcRenderer.invoke('output:open', opts || {}),
  closeOutput: (role) => ipcRenderer.invoke('output:close', role),
  outputStatus: () => ipcRenderer.invoke('output:status'),
  pushState: (state) => ipcRenderer.send('output:state', state),
  onOutputKey: (fn) => on('output:key', fn),
  onOutputClosed: (fn) => on('output:closed', fn),

  // used by the output window itself
  getState: () => ipcRenderer.invoke('output:hello'),
  onState: (fn) => on('output:state', fn),
  sendKey: (key) => ipcRenderer.send('output:key', key),

  // offline speech recognition
  speech: {
    start: () => ipcRenderer.invoke('speech:start'),
    audio: (samples) => ipcRenderer.send('speech:audio', samples),
    stop: () => ipcRenderer.send('speech:stop'),
    options: (options) => ipcRenderer.send('speech:options', options),
    onEvent: (fn) => on('speech:event', fn)
  }
});
