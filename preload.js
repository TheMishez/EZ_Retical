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
  setProfileHotkey: (name, accel) => ipcRenderer.invoke('profile:hotkey', name, accel),
  setOverlay: (v) => ipcRenderer.invoke('overlay:set', v),
  setDisplayMode: (m) => ipcRenderer.invoke('mode:set', m),
  setTriggers: (t) => ipcRenderer.invoke('triggers:set', t),
  setHotkey: (accel, which) => ipcRenderer.invoke('hotkey:set', accel, which),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  setGames: (p) => ipcRenderer.invoke('games:set', p),
  listProcs: () => ipcRenderer.invoke('procs:list'),
  getDiag: () => ipcRenderer.invoke('overlay:diag'),
  setGuide: (on) => ipcRenderer.invoke('guide:set', on),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  getPerf: () => ipcRenderer.invoke('perf:get'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
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
