'use strict';

const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const Crosshair = require('./crosshair.js');

const OVERLAY_SIZE = 800; // transparent, click-through square centred on the chosen display
const BLOCKED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

let config;
let overlayWin = null;
let editorWin = null;
let tray = null;
let quitting = false;
let saveTimer = null;
let icon32 = null;
let icon64 = null;

// Global input hook (only started when a click/key animation is selected)
let hookMod = null;
let hookWired = false;
let hookState = 'off'; // 'off' | 'running' | 'unavailable'

// ---------------------------------------------------------------- icons
// Generated in code so the project needs no binary assets.
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const ring = Math.abs(d - size * 0.36) < size * 0.06;
      const cross = (Math.abs(dx) < size * 0.05 || Math.abs(dy) < size * 0.05) && d < size * 0.48 && d > size * 0.14;
      if (ring || cross) {
        const i = (y * size + x) * 4;
        buf[i] = 102; // B
        buf[i + 1] = 255; // G
        buf[i + 2] = 0; // R
        buf[i + 3] = 255; // A
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ---------------------------------------------------------------- settings
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) { /* first run or unreadable file: use defaults */ }
  const profiles = {};
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles)) {
      const name = String(k).trim().slice(0, 40);
      if (!name || BLOCKED_NAMES.has(name) || Object.keys(profiles).length >= 200) continue;
      profiles[name] = Crosshair.sanitize(v);
    }
  }
  return {
    crosshair: Crosshair.sanitize(raw.crosshair),
    overlayVisible: raw.overlayVisible !== false,
    hotkey: typeof raw.hotkey === 'string' && raw.hotkey ? raw.hotkey : 'F8',
    displayId: Number.isInteger(raw.displayId) ? raw.displayId : null,
    autoStart: !!raw.autoStart,
    profiles
  };
}

function saveNow() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Could not save settings:', e.message);
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function publicState() {
  return {
    overlayVisible: config.overlayVisible,
    hotkey: config.hotkey,
    displayId: config.displayId,
    autoStart: config.autoStart,
    profiles: config.profiles,
    hookState,
    isPackaged: app.isPackaged
  };
}

function publicConfig() {
  return Object.assign({ crosshair: config.crosshair }, publicState());
}

function sendTo(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcastState() {
  const s = publicState();
  sendTo(overlayWin, 'state:changed', s);
  sendTo(editorWin, 'state:changed', s);
}

// ---------------------------------------------------------------- overlay
function targetDisplay() {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === config.displayId) || screen.getPrimaryDisplay();
}

function positionOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const b = targetDisplay().bounds;
  overlayWin.setBounds({
    x: Math.round(b.x + b.width / 2 - OVERLAY_SIZE / 2),
    y: Math.round(b.y + b.height / 2 - OVERLAY_SIZE / 2),
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE
  });
}

function applyOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (config.overlayVisible) {
    positionOverlay();
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  } else {
    overlayWin.hide();
  }
}

function createOverlay() {
  const b = targetDisplay().bounds;
  overlayWin = new BrowserWindow({
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
    x: Math.round(b.x + b.width / 2 - OVERLAY_SIZE / 2),
    y: Math.round(b.y + b.height / 2 - OVERLAY_SIZE / 2),
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    icon: icon64,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.once('ready-to-show', applyOverlayVisibility);
}

function setOverlayVisible(v) {
  config.overlayVisible = !!v;
  applyOverlayVisibility();
  updateTrayMenu();
  saveSoon();
  broadcastState();
}

function toggleOverlay() {
  setOverlayVisible(!config.overlayVisible);
}

// ---------------------------------------------------------------- editor window
function createEditor() {
  editorWin = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 920,
    minHeight: 660,
    show: false,
    backgroundColor: '#12141a',
    title: 'Mishez Xhair',
    icon: icon64,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  editorWin.removeMenu();
  editorWin.loadFile(path.join(__dirname, 'editor.html'));
  editorWin.once('ready-to-show', () => editorWin.show());
  editorWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      editorWin.hide(); // keep the overlay running in the tray
    }
  });
  editorWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  editorWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showEditor() {
  if (!editorWin || editorWin.isDestroyed()) {
    createEditor();
  } else {
    if (editorWin.isMinimized()) editorWin.restore();
    editorWin.show();
    editorWin.focus();
  }
}

// ---------------------------------------------------------------- tray
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open editor', click: showEditor },
    { label: config.overlayVisible ? 'Hide crosshair' : 'Show crosshair', click: toggleOverlay },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

// ---------------------------------------------------------------- hotkey
function registerHotkey(accel) {
  try {
    return globalShortcut.register(accel, toggleOverlay);
  } catch (e) {
    return false;
  }
}

function setHotkey(accel) {
  if (typeof accel !== 'string' || !accel || accel.length > 40) return false;
  globalShortcut.unregisterAll();
  const ok = registerHotkey(accel);
  if (ok) {
    config.hotkey = accel;
    saveSoon();
  } else {
    registerHotkey(config.hotkey);
  }
  broadcastState();
  return ok;
}

// ---------------------------------------------------------------- global input hook
function forwardInput(evt) {
  if (config.crosshair.animation === 'none') return;
  if (config.overlayVisible) sendTo(overlayWin, 'input', evt);
  if (editorWin && !editorWin.isDestroyed() && editorWin.isVisible()) sendTo(editorWin, 'input', evt);
}

// Starts the hook only while a click/key animation is selected, and stops it otherwise.
function syncHook() {
  const want = config.crosshair.animation !== 'none';
  const before = hookState;
  if (want && hookState === 'off') {
    try {
      if (!hookMod) hookMod = require('uiohook-napi');
      const { uIOhook, UiohookKey } = hookMod;
      if (!hookWired) {
        const keyMap = new Map([
          [UiohookKey.W, 'w'], [UiohookKey.A, 'a'], [UiohookKey.S, 's'], [UiohookKey.D, 'd']
        ]);
        uIOhook.on('mousedown', (e) => forwardInput({ type: 'mousedown', button: e.button }));
        uIOhook.on('keydown', (e) => {
          const k = keyMap.get(e.keycode);
          if (k) forwardInput({ type: 'keydown', key: k });
        });
        uIOhook.on('keyup', (e) => {
          const k = keyMap.get(e.keycode);
          if (k) forwardInput({ type: 'keyup', key: k });
        });
        hookWired = true;
      }
      uIOhook.start();
      hookState = 'running';
    } catch (e) {
      console.warn('Global input hook unavailable:', e.message);
      hookState = 'unavailable';
    }
  } else if (!want && hookState === 'running') {
    try { hookMod.uIOhook.stop(); } catch (e) { /* ignore */ }
    hookState = 'off';
  }
  if (hookState !== before) broadcastState();
}

// ---------------------------------------------------------------- IPC
function setupIpc() {
  ipcMain.handle('config:get', () => publicConfig());

  ipcMain.handle('crosshair:set', (_e, ch) => {
    config.crosshair = Crosshair.sanitize(ch);
    sendTo(overlayWin, 'crosshair:changed', config.crosshair);
    syncHook();
    saveSoon();
    return config.crosshair;
  });

  ipcMain.handle('profile:save', (_e, name, ch) => {
    const n = String(name || '').trim().slice(0, 40);
    if (!n || BLOCKED_NAMES.has(n)) return { ok: false };
    config.profiles[n] = Crosshair.sanitize(ch);
    saveSoon();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('profile:load', (_e, name) => {
    const n = String(name || '');
    if (!Object.prototype.hasOwnProperty.call(config.profiles, n)) return null;
    config.crosshair = Crosshair.sanitize(config.profiles[n]);
    sendTo(overlayWin, 'crosshair:changed', config.crosshair);
    syncHook();
    saveSoon();
    return config.crosshair;
  });

  ipcMain.handle('profile:delete', (_e, name) => {
    const n = String(name || '');
    if (Object.prototype.hasOwnProperty.call(config.profiles, n)) delete config.profiles[n];
    saveSoon();
    broadcastState();
    return true;
  });

  ipcMain.handle('overlay:set', (_e, v) => {
    setOverlayVisible(!!v);
    return config.overlayVisible;
  });

  ipcMain.handle('hotkey:set', (_e, accel) => ({ ok: setHotkey(accel), hotkey: config.hotkey }));

  ipcMain.handle('hotkey:pause', (_e, pause) => {
    if (pause) globalShortcut.unregisterAll();
    else registerHotkey(config.hotkey);
    return true;
  });

  ipcMain.handle('displays:list', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: 'Display ' + (i + 1) + ' (' + d.size.width + '\u00d7' + d.size.height + ')' + (d.id === primary ? ' \u2013 primary' : '')
    }));
  });

  ipcMain.handle('display:set', (_e, id) => {
    config.displayId = Number.isInteger(id) ? id : null;
    positionOverlay();
    saveSoon();
    broadcastState();
    return true;
  });

  ipcMain.handle('autostart:set', (_e, v) => {
    config.autoStart = !!v;
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: config.autoStart, args: ['--hidden'] });
    }
    saveSoon();
    broadcastState();
    return config.autoStart;
  });

  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text).slice(0, 10000));
    return true;
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText().slice(0, 10000));
}

// ---------------------------------------------------------------- lifecycle
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showEditor);
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    saveNow();
    if (hookMod && hookState === 'running') {
      try { hookMod.uIOhook.stop(); } catch (e) { /* ignore */ }
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.mishez.xhair');
    config = loadConfig();
    icon32 = makeIcon(32);
    icon64 = makeIcon(64);

    setupIpc();
    createOverlay();

    tray = new Tray(icon32);
    tray.setToolTip('Mishez Xhair');
    tray.on('click', showEditor);
    updateTrayMenu();

    registerHotkey(config.hotkey);
    syncHook();

    if (!process.argv.includes('--hidden')) showEditor();

    const refresh = () => positionOverlay();
    screen.on('display-added', refresh);
    screen.on('display-removed', refresh);
    screen.on('display-metrics-changed', refresh);

    // Some games grab the topmost slot; keep taking it back.
    setInterval(() => {
      if (config.overlayVisible && overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setAlwaysOnTop(true, 'screen-saver');
        overlayWin.moveTop();
      }
    }, 3000);
  });
}
