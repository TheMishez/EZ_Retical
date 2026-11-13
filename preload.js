'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setCrosshair: (c) => ipcRenderer.invoke('crosshair:set', c),
  saveProfile: (name, c) => ipcRenderer.invoke('profile:save', name, c),
  loadProfile: (name) => ipcRenderer.invoke('profile:load', name),
  deleteProfile: (name) => ipcRenderer.invoke('profile:delete', name),
  setOverlay: (v) => ipcRenderer.invoke('overlay:set', v),
  setHotkey: (accel) => ipcRenderer.invoke('hotkey:set', accel),
  pauseHotkey: (p) => ipcRenderer.invoke('hotkey:pause', p),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  setDisplay: (id) => ipcRenderer.invoke('display:set', id),
  setAutoStart: (v) => ipcRenderer.invoke('autostart:set', v),
  clipboardWrite: (t) => ipcRenderer.invoke('clipboard:write', t),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  onState: (cb) => listen('state:changed', cb),
  onCrosshair: (cb) => listen('crosshair:changed', cb),
  onInput: (cb) => listen('input', cb)
});
