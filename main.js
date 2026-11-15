'use strict';

const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, clipboard, dialog, shell
} = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const Crosshair = require('./crosshair.js');
// Native helper: Raw Input for animation triggers + foreground-window events (Windows).
// Falls back to uiohook-napi / PowerShell when the binary isn't built.
const Native = require('./native/index.js');

// The overlay is a tiny transparent click-through window sized to the crosshair (not full screen),
// so the compositor only ever handles a few thousand pixels.
const MIN_OVERLAY = 48;
const MAX_OVERLAY = 1000;
const BLOCKED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

// Memory mode is read from the settings file before Electron starts (these switches must be set early).
function earlyMemoryMode() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    return ['balanced', 'low', 'lowest'].indexOf(raw.memoryMode) >= 0 ? raw.memoryMode : 'low';
  } catch (e) {
    return 'low';
  }
}
const MEMORY_MODE = earlyMemoryMode();
const DISABLED_FEATURES = ['CalculateNativeWinOcclusion'];
if (MEMORY_MODE !== 'balanced') {
  // Smaller caches and heaps. The overlay is a tiny canvas, so none of this changes how it looks or feels.
  DISABLED_FEATURES.push('MediaRouter', 'OptimizationHints', 'Translate', 'AutofillServerCommunication', 'InterestFeedContentSuggestions');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --max-lazy');
  app.commandLine.appendSwitch('enable-low-end-device-mode');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
}
// "Lowest" also renders in software: removes the GPU process (the biggest single saving) at a small CPU cost.
if (MEMORY_MODE === 'lowest') app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', DISABLED_FEATURES.join(','));

let config;
let activeProfile = null;
let overlaySize = 0;
let overlayWin = null;
let editorWin = null;
let tray = null;
let quitting = false;
let saveTimer = null;
let icon32 = null;
let icon64 = null;
let guideOn = false; // alignment guide shown on the overlay (not saved)
let guideTimer = null;
let followCenter = null; // physical-pixel centre of the game window we follow, or null
let watcher = null; // PowerShell foreground-window watcher
let gameFront = false; // a game from the Games list is the active window
let updateInfo = null; // { version, url } when GitHub has a newer release
const RELEASES_API = 'https://api.github.com/repos/TheMishez/EZ_Retical/releases/latest';
const RELEASES_PAGE = 'https://github.com/TheMishez/EZ_Retical/releases/latest';
let autoActive = false; // a per-game crosshair is currently applied
let revertDesign = null; // what to go back to when leaving the game
let revertProfile = null;
let lastGame = '';

// Global input listener (only started when a click/key animation is selected)
let hookMod = null;
let hookWired = false;
let hookState = 'off'; // 'off' | 'running' | 'unavailable'
let hookKind = null; // 'native' (Raw Input, not in the input chain) | 'uiohook' (low-level hook fallback)
const heldInputs = new Set(); // canonical names of inputs currently held

// ---------------------------------------------------------------- icons
// The EZ Reticle logo (logo.png next to this file); falls back to an empty image if it is missing.
function makeIcon(size) {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'logo.png'));
    if (!img.isEmpty()) return img.resize({ width: size, height: size, quality: 'best' });
  } catch (e) { /* fall through */ }
  return nativeImage.createEmpty();
}

// ---------------------------------------------------------------- settings
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

// {"cs2": "My Profile"}: lowercase process name (no .exe) -> saved crosshair name.
function exeKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9 _.\-]/g, '').slice(0, 60);
}

function cleanGames(g) {
  const out = {};
  if (g && typeof g === 'object') {
    for (const [k, v] of Object.entries(g)) {
      const key = exeKey(k);
      if (!key || BLOCKED_NAMES.has(key) || typeof v !== 'string' || !v || Object.keys(out).length >= 60) continue; // '*' = keep the current crosshair
      out[key] = String(v).slice(0, 40);
    }
  }
  return out;
}

// Hotkeys that equip a saved crosshair: { profileName: 'Accelerator' }.
function cleanProfileHotkeys(raw, profiles) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const used = new Set();
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(profiles, k)) continue;
    if (typeof v !== 'string' || !v || v.length > 40 || used.has(v)) continue;
    used.add(v);
    out[k] = v;
  }
  return out;
}

function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    // First run, or the file is damaged: keep a copy of a damaged one so nothing is silently lost.
    try { if (fs.existsSync(settingsPath())) fs.copyFileSync(settingsPath(), settingsPath() + '.corrupt'); } catch (e2) { /* ignore */ }
  }
  const profiles = {};
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles)) {
      const name = String(k).trim().slice(0, 40);
      if (!name || BLOCKED_NAMES.has(name) || Object.keys(profiles).length >= 200) continue;
      profiles[name] = Crosshair.sanitizeDesign(v);
    }
  }
  return {
    crosshair: Crosshair.sanitizeDesign(raw.crosshair || Crosshair.DEFAULT_DESIGN),
    displayMode: raw.displayMode === 'fullscreen' ? 'fullscreen' : 'borderless',
    triggers: Crosshair.sanitizeTriggers(raw.triggers),
    hotkeyNext: typeof raw.hotkeyNext === 'string' && raw.hotkeyNext ? raw.hotkeyNext : 'F9',
    hotkeyPrev: typeof raw.hotkeyPrev === 'string' && raw.hotkeyPrev ? raw.hotkeyPrev : 'Shift+F9',
    overlayScale: clampNum(raw.overlayScale, 0.5, 3, 1),
    overlayOpacity: clampNum(raw.overlayOpacity, 0.2, 1, 1),
    fpsCap: [0, 30, 60, 120].indexOf(raw.fpsCap) >= 0 ? raw.fpsCap : 60,
    lowPriority: raw.lowPriority !== false,
    startHidden: !!raw.startHidden,
    accentColor: /^#[0-9a-f]{6}$/i.test(raw.accentColor || '') ? raw.accentColor.toLowerCase() : '#fcc800',
    memoryMode: ['balanced', 'low', 'lowest'].indexOf(raw.memoryMode) >= 0 ? raw.memoryMode : 'low',
    overlayVisible: raw.overlayVisible !== false,
    hotkey: typeof raw.hotkey === 'string' && raw.hotkey ? raw.hotkey : 'F8',
    displayId: Number.isInteger(raw.displayId) ? raw.displayId : null,
    autoStart: !!raw.autoStart,
    overlayOffsetX: Math.round(clampNum(raw.overlayOffsetX, -100, 100, 0)),
    overlayOffsetY: Math.round(clampNum(raw.overlayOffsetY, -100, 100, 0)),
    autoSwitch: !!raw.autoSwitch,
    gameOnly: !!raw.gameOnly,
    hideFromCapture: !!raw.hideFromCapture,
    onboarded: !!raw.onboarded,
    checkUpdates: raw.checkUpdates !== false,
    autoRevert: raw.autoRevert !== false,
    followWindow: !!raw.followWindow,
    gameProfiles: cleanGames(raw.gameProfiles),
    profileHotkeys: cleanProfileHotkeys(raw.profileHotkeys, profiles),
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
    displayMode: config.displayMode,
    triggers: config.triggers,
    hotkeyNext: config.hotkeyNext,
    hotkeyPrev: config.hotkeyPrev,
    overlayScale: config.overlayScale,
    overlayOpacity: config.overlayOpacity,
    fpsCap: config.fpsCap,
    lowPriority: config.lowPriority,
    startHidden: config.startHidden,
    accentColor: config.accentColor,
    memoryMode: config.memoryMode,
    memoryActive: MEMORY_MODE,
    autoStart: config.autoStart,
    overlayOffsetX: config.overlayOffsetX,
    overlayOffsetY: config.overlayOffsetY,
    autoSwitch: config.autoSwitch,
    gameOnly: config.gameOnly,
    hideFromCapture: config.hideFromCapture,
    onboarded: config.onboarded,
    gameFront,
    checkUpdates: config.checkUpdates,
    update: publicUpdate(),
    version: app.getVersion(),
    autoRevert: config.autoRevert,
    followWindow: config.followWindow,
    gameProfiles: config.gameProfiles,
    guide: guideOn,
    watcherOn: !!watcher,
    profiles: config.profiles,
    profileHotkeys: config.profileHotkeys,
    activeProfile,
    hookState,
    inputMode: hookKind,
    watcherMode: watcher ? (watcher.kind === 'native' ? 'native' : 'powershell') : null,
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

// Window side in DIPs: big enough for the design at the chosen scale, rounded to 16 so that
// slider drags don't resize the window constantly. Always even so the centre stays pixel-exact.
function desiredOverlaySize() {
  const r = Crosshair.designRadius(config.crosshair) * config.overlayScale * 1.1 + 6;
  const side = Math.ceil((r * 2) / 16) * 16;
  return Math.min(MAX_OVERLAY, Math.max(MIN_OVERLAY, side));
}

// Physical-pixel helpers (Windows reports window bounds in DIPs, but the game centre is a physical pixel).
function toPhysRect(r) {
  try { if (screen.dipToScreenRect) return screen.dipToScreenRect(null, r); } catch (e) { /* not supported */ }
  return r;
}

function toDipRect(r) {
  try { if (screen.screenToDipRect) return screen.screenToDipRect(null, r); } catch (e) { /* not supported */ }
  return r;
}

// Where the overlay window should sit so its centre lands exactly on the target pixel.
function overlayRect(size) {
  let display = targetDisplay();
  let cx;
  let cy;
  if (followCenter) {
    cx = followCenter.x;
    cy = followCenter.y;
  } else {
    const pb = toPhysRect(display.bounds);
    cx = pb.x + pb.width / 2;
    cy = pb.y + pb.height / 2;
  }
  cx += config.overlayOffsetX;
  cy += config.overlayOffsetY;
  // Ideal rectangle in DIPs, then try the neighbouring whole-DIP origins and keep whichever
  // lands the physical centre closest (fractional scaling like 125% / 150% rounds otherwise).
  let sf = display.scaleFactor || 1;
  try {
    if (followCenter && screen.getDisplayNearestPoint && screen.screenToDipPoint) {
      sf = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: Math.round(cx), y: Math.round(cy) })).scaleFactor || sf;
    }
  } catch (e) { /* keep the target display's scale */ }
  const phys = Math.round(size * sf);
  const ideal = toDipRect({ x: Math.round(cx - phys / 2), y: Math.round(cy - phys / 2), width: phys, height: phys });
  const side = size; // window is `size` DIPs wide
  const bx = Math.round(ideal.x);
  const by = Math.round(ideal.y);
  let best = { x: bx, y: by, width: side, height: side };
  let bestErr = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cand = { x: bx + dx, y: by + dy, width: side, height: side };
      const pr = toPhysRect(cand);
      const err = Math.abs(pr.x + pr.width / 2 - cx) + Math.abs(pr.y + pr.height / 2 - cy);
      if (err < bestErr - 1e-9) { bestErr = err; best = cand; }
    }
  }
  return best;
}

function positionOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlaySize = desiredOverlaySize();
  overlayWin.setBounds(overlayRect(overlaySize));
}

// How far (physical pixels) the overlay centre is from where it should be.
function alignmentDiag() {
  const display = targetDisplay();
  const pb = toPhysRect(display.bounds);
  const tx = (followCenter ? followCenter.x : pb.x + pb.width / 2) + config.overlayOffsetX;
  const ty = (followCenter ? followCenter.y : pb.y + pb.height / 2) + config.overlayOffsetY;
  let ox = null;
  let oy = null;
  if (overlayWin && !overlayWin.isDestroyed()) {
    const wp = toPhysRect(overlayWin.getBounds());
    ox = wp.x + wp.width / 2 - tx;
    oy = wp.y + wp.height / 2 - ty;
  }
  return {
    displayId: display.id,
    scale: display.scaleFactor,
    physical: pb.width + '\u00d7' + pb.height,
    errorX: ox,
    errorY: oy,
    following: !!followCenter
  };
}

// Resizes only when the needed size actually changed.
function fitOverlay() {
  if (desiredOverlaySize() !== overlaySize) positionOverlay();
}

function applyOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // "Only while a game is in front": hide until the watcher sees a listed game.
  const gameOk = !config.gameOnly || !watcher || gameFront;
  if (config.overlayVisible && gameOk) {
    positionOverlay();
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  } else {
    overlayWin.hide();
  }
}

function createOverlay() {
  overlaySize = desiredOverlaySize();
  const r0 = overlayRect(overlaySize);
  overlayWin = new BrowserWindow({
    width: r0.width,
    height: r0.height,
    x: r0.x,
    y: r0.y,
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
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  applyCaptureProtection();
  overlayWin.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWin.once('ready-to-show', applyOverlayVisibility);
}

// Keeps the crosshair out of OBS, Discord screen share and screenshots when asked (Windows 10 2004+).
function applyCaptureProtection() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  try { overlayWin.setContentProtection(!!config.hideFromCapture); } catch (e) { logError(e); }
}

function setOverlayVisible(v) {
  config.overlayVisible = !!v;
  applyOverlayVisibility();
  syncHook();
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
    backgroundColor: '#0b0b0b',
    title: 'EZ Reticle',
    icon: icon64,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  editorWin.removeMenu();
  editorWin.loadFile(path.join(__dirname, 'editor.html'));
  editorWin.once('ready-to-show', () => editorWin.show());
  // Closing the editor fully unloads it (frees its memory); the overlay keeps running from the tray.
  // Editor open/closed changes whether "Efficiency mode" applies, so re-apply priority too.
  const onEditorState = () => { syncHook(); applyPriority(); };
  editorWin.on('closed', () => { editorWin = null; onEditorState(); });
  editorWin.on('show', onEditorState);
  editorWin.on('hide', onEditorState);
  editorWin.on('minimize', onEditorState);
  editorWin.on('restore', onEditorState);
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
    ...(updateInfo ? [{ type: 'separator' }, updatePhase === 'ready'
      ? { label: 'Restart to update to v' + updateInfo.version, click: installUpdate }
      : { label: 'Update available: v' + updateInfo.version, click: () => { if (updateInfo.canInstall) { showEditor(); downloadUpdate(); } else shell.openExternal(updateInfo.url); } }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

// ---------------------------------------------------------------- hotkeys
const HOTKEY_FIELDS = { toggle: 'hotkey', next: 'hotkeyNext', prev: 'hotkeyPrev' };

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const actions = { hotkey: toggleOverlay, hotkeyNext: () => cycleProfile(1), hotkeyPrev: () => cycleProfile(-1) };
  Object.keys(actions).forEach((field) => {
    const accel = config[field];
    if (!accel) return;
    try { globalShortcut.register(accel, actions[field]); } catch (e) { /* invalid accelerator */ }
  });
  const taken = new Set(Object.keys(actions).map((f) => config[f]));
  Object.keys(config.profileHotkeys || {}).forEach((name) => {
    const accel = config.profileHotkeys[name];
    if (!accel || taken.has(accel) || !Object.prototype.hasOwnProperty.call(config.profiles, name)) return;
    try {
      globalShortcut.register(accel, () => {
        if (!Object.prototype.hasOwnProperty.call(config.profiles, name)) return;
        applyDesign(config.profiles[name], name);
        broadcastState();
      });
    } catch (e) { /* invalid accelerator */ }
  });
}

function setProfileHotkey(name, accel) {
  const n = String(name || '');
  const done = (ok, error) => {
    broadcastState();
    return { ok, error, profileHotkeys: config.profileHotkeys };
  };
  if (!Object.prototype.hasOwnProperty.call(config.profiles, n)) return done(false, 'Save this crosshair first');
  const map = Object.assign({}, config.profileHotkeys);
  if (!accel) {
    delete map[n];
    config.profileHotkeys = map;
    registerHotkeys();
    saveSoon();
    return done(true);
  }
  if (typeof accel !== 'string' || accel.length > 40) return done(false, 'Could not use that shortcut');
  if (['hotkey', 'hotkeyNext', 'hotkeyPrev'].some((f) => config[f] === accel)) return done(false, accel + ' is already used by an app hotkey');
  const other = Object.keys(map).find((k) => k !== n && map[k] === accel);
  if (other) return done(false, accel + ' already equips \u201c' + other + '\u201d');
  const prev = config.profileHotkeys;
  map[n] = accel;
  config.profileHotkeys = map;
  registerHotkeys();
  if (!globalShortcut.isRegistered(accel)) {
    config.profileHotkeys = prev;
    registerHotkeys();
    return done(false, 'Windows would not give us ' + accel + ' (another app may own it)');
  }
  saveSoon();
  return done(true);
}

function setHotkey(accel, which) {
  const field = HOTKEY_FIELDS[which || 'toggle'];
  if (!field || typeof accel !== 'string' || !accel || accel.length > 40) return false;
  if (Object.keys(HOTKEY_FIELDS).some((w) => HOTKEY_FIELDS[w] !== field && config[HOTKEY_FIELDS[w]] === accel)) return false;
  const prev = config[field];
  config[field] = accel;
  registerHotkeys();
  const ok = globalShortcut.isRegistered(accel);
  if (!ok) {
    config[field] = prev;
    registerHotkeys();
  } else {
    saveSoon();
  }
  broadcastState();
  return ok;
}

// Switches to the next/previous saved crosshair (alphabetical), from a hotkey.
function cycleProfile(dir) {
  const names = Object.keys(config.profiles).sort((a, b) => a.localeCompare(b));
  if (!names.length) return;
  const i = names.indexOf(activeProfile);
  const n = names[i < 0 ? (dir > 0 ? 0 : names.length - 1) : (i + dir + names.length) % names.length];
  applyDesign(config.profiles[n], n);
}

function applyDesign(design, profileName) {
  activeProfile = profileName || null;
  config.crosshair = Crosshair.sanitizeDesign(design);
  sendTo(overlayWin, 'crosshair:changed', config.crosshair);
  sendTo(editorWin, 'crosshair:changed', config.crosshair);
  fitOverlay();
  syncHook();
  saveSoon();
}

// ---------------------------------------------------------------- per-game profiles + window follow
const WATCH_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct RECTX { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential)] public struct PTX { public int X, Y; }
public static class XH {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECTX r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PTX p);
}
'@
[void][XH]::SetProcessDPIAware()
$last = ''
while ($true) {
  $h = [XH]::GetForegroundWindow()
  $procId = [uint32]0
  [void][XH]::GetWindowThreadProcessId($h, [ref]$procId)
  $n = ''
  try { $n = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName } catch {}
  $r = New-Object RECTX
  [void][XH]::GetClientRect($h, [ref]$r)
  $pt = New-Object PTX
  [void][XH]::ClientToScreen($h, [ref]$pt)
  $line = $n + '|' + $pt.X + '|' + $pt.Y + '|' + $r.R + '|' + $r.B
  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 1000
}
`;

const OWN_PROCS = new Set(['electron', 'ez reticle', 'ez-reticle', 'ezreticle', 'mishez xhair', 'mishez-xhair']);

function wantWatcher() {
  return process.platform === 'win32' &&
    ((config.autoSwitch || config.followWindow || config.gameOnly) && Object.keys(config.gameProfiles).length > 0);
}

function stopWatcher() {
  if (watcher) { try { watcher.kill(); } catch (e) { /* ignore */ } }
  watcher = null;
  followCenter = null;
  lastGame = '';
  gameFront = false;
  applyOverlayVisibility();
  if (autoActive && config.autoRevert && revertDesign) applyDesign(revertDesign, revertProfile);
  autoActive = false;
}

function syncWatcher() {
  const want = wantWatcher();
  if (want && !watcher) startWatcher();
  else if (!want && watcher) { stopWatcher(); positionOverlay(); }
  applyOverlayVisibility();
  broadcastState();
}

function startWatcher() {
  const own = path.basename(process.execPath, '.exe').toLowerCase();
  // Preferred: Windows tells the native helper when the active window changes (no extra process).
  if (Native.available) {
    const w = { kind: 'native', kill: () => Native.stopForeground() };
    let ok = false;
    try { ok = Native.startForeground((line) => { if (watcher === w) onForeground(line, own); }); } catch (e) { logError(e); }
    if (ok) { watcher = w; return; }
  }
  // Fallback: a hidden PowerShell process that polls once a second.
  const enc = Buffer.from(WATCH_SCRIPT, 'utf16le').toString('base64');
  let child;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', enc], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { logError(e); return; }
  watcher = child;
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onForeground(line, own);
    }
  });
  child.on('exit', () => { if (watcher === child) { watcher = null; followCenter = null; gameFront = false; applyOverlayVisibility(); broadcastState(); } });
  child.on('error', (e) => { logError(e); if (watcher === child) watcher = null; });
}

function onForeground(line, own) {
  const parts = line.split('|');
  const name = exeKey(parts[0]);
  if (!name || name === own || OWN_PROCS.has(name)) return; // ignore our own windows
  const listed = config.gameProfiles[name];
  const prof = listed === '*' ? '' : listed;
  lastGame = name;
  if (gameFront !== !!listed) {
    gameFront = !!listed;
    if (config.gameOnly) { applyOverlayVisibility(); broadcastState(); }
  }
  if (config.autoSwitch) {
    if (prof && config.profiles[prof]) {
      if (!autoActive) { revertDesign = config.crosshair; revertProfile = activeProfile; }
      if (!autoActive || activeProfile !== prof) applyDesign(config.profiles[prof], prof);
      autoActive = true;
    } else if (autoActive) {
      autoActive = false;
      if (config.autoRevert && revertDesign) applyDesign(revertDesign, revertProfile);
    }
  }
  if (config.followWindow && listed) {
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const w = Number(parts[3]);
    const h = Number(parts[4]);
    if ([x, y, w, h].every(Number.isFinite) && w >= 200 && h >= 200) {
      const next = { x: x + w / 2, y: y + h / 2 };
      if (!followCenter || followCenter.x !== next.x || followCenter.y !== next.y) {
        followCenter = next;
        positionOverlay();
      }
    }
  } else if (followCenter) {
    followCenter = null;
    positionOverlay();
  }
}

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    const cmd = "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) { resolve([]); return; }
      const own = path.basename(process.execPath, '.exe').toLowerCase();
      const seen = new Set();
      String(out).split(/\r?\n/).forEach((l) => {
        const k = exeKey(l);
        if (k && k !== own && !OWN_PROCS.has(k) && seen.size < 200) seen.add(k);
      });
      resolve(Array.from(seen));
    });
  });
}

// ---------------------------------------------------------------- global input hook
function forwardInput(evt) {
  if (!Crosshair.hasAnimation(config.crosshair)) return;
  if (config.overlayVisible) sendTo(overlayWin, 'input', evt);
  if (editorWin && !editorWin.isDestroyed() && editorWin.isVisible()) sendTo(editorWin, 'input', evt);
}

// A trigger input (canonical name such as "Mouse1", "R", "Space") went down or up.
function pressInput(name, down) {
  if (!name) return;
  const actions = Crosshair.actionsFor(config.triggers, name);
  const active = (action) => config.triggers[action].some((n) => heldInputs.has(n));
  if (down) {
    if (heldInputs.has(name)) return; // key auto-repeat
    const was = actions.map(active);
    heldInputs.add(name);
    actions.forEach((action, i) => { if (!was[i]) forwardInput({ type: 'trigger', action, down: true }); });
  } else {
    if (!heldInputs.delete(name)) return;
    actions.forEach((action) => { if (!active(action)) forwardInput({ type: 'trigger', action, down: false }); });
  }
}

// Preferred: Raw Input through the native helper. It receives a copy of each click/key after
// Windows has delivered it, so it never sits in the game's input path.
function startNativeInput() {
  if (!Native.available) return false;
  try {
    return !!Native.startInput((code, down) => pressInput(Crosshair.canonKey(code), down));
  } catch (e) {
    logError(e);
    return false;
  }
}

// Fallback: uiohook-napi's low-level hook (only used when the native helper isn't built).
function startUiohook() {
  if (!hookMod) hookMod = require('uiohook-napi');
  const { uIOhook, UiohookKey } = hookMod;
  if (!hookWired) {
    const keyNames = new Map();
    Object.keys(UiohookKey).forEach((k) => {
      if (typeof UiohookKey[k] === 'number') keyNames.set(UiohookKey[k], Crosshair.canonKey(k));
    });
    uIOhook.on('mousedown', (e) => pressInput('Mouse' + e.button, true));
    uIOhook.on('mouseup', (e) => pressInput('Mouse' + e.button, false));
    uIOhook.on('keydown', (e) => pressInput(keyNames.get(e.keycode), true));
    uIOhook.on('keyup', (e) => pressInput(keyNames.get(e.keycode), false));
    hookWired = true;
  }
  uIOhook.start();
}

function stopInputListener() {
  if (hookKind === 'native') {
    try { Native.stopInput(); } catch (e) { /* ignore */ }
  } else if (hookKind === 'uiohook') {
    try { hookMod.uIOhook.stop(); } catch (e) { /* ignore */ }
  }
  hookKind = null;
}

// Starts listening only while a click/key animation is selected, and stops otherwise.
function syncHook() {
  const editorOpen = !!(editorWin && !editorWin.isDestroyed() && editorWin.isVisible() && !editorWin.isMinimized());
  const want = Crosshair.hasAnimation(config.crosshair) && (config.overlayVisible || editorOpen);
  const before = hookState;
  if (want && hookState === 'off') {
    if (startNativeInput()) {
      hookKind = 'native';
      hookState = 'running';
    } else {
      try {
        startUiohook();
        hookKind = 'uiohook';
        hookState = 'running';
      } catch (e) {
        console.warn('Global input hook unavailable:', e.message);
        hookState = 'unavailable';
      }
    }
  } else if (!want && hookState === 'running') {
    stopInputListener();
    hookState = 'off';
    heldInputs.clear();
  }
  if (hookState !== before) { applyPriority(); broadcastState(); }
}

// ---------------------------------------------------------------- IPC
function setupIpc() {
  ipcMain.handle('config:get', () => publicConfig());

  ipcMain.handle('crosshair:set', (_e, ch) => {
    config.crosshair = Crosshair.sanitizeDesign(ch);
    fitOverlay();
    sendTo(overlayWin, 'crosshair:changed', config.crosshair);
    syncHook();
    saveSoon();
    return config.crosshair;
  });

  ipcMain.handle('profile:save', (_e, name, ch) => {
    const n = String(name || '').trim().slice(0, 40);
    if (!n || BLOCKED_NAMES.has(n)) return { ok: false };
    config.profiles[n] = Crosshair.sanitizeDesign(ch);
    activeProfile = n;
    saveSoon();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('profile:load', (_e, name) => {
    const n = String(name || '');
    if (!Object.prototype.hasOwnProperty.call(config.profiles, n)) return null;
    config.crosshair = Crosshair.sanitizeDesign(config.profiles[n]);
    activeProfile = n;
    fitOverlay();
    sendTo(overlayWin, 'crosshair:changed', config.crosshair);
    syncHook();
    saveSoon();
    return config.crosshair;
  });

  ipcMain.handle('profile:delete', (_e, name) => {
    const n = String(name || '');
    if (Object.prototype.hasOwnProperty.call(config.profiles, n)) delete config.profiles[n];
    if (config.profileHotkeys && config.profileHotkeys[n]) { delete config.profileHotkeys[n]; registerHotkeys(); }
    saveSoon();
    broadcastState();
    return true;
  });

  ipcMain.handle('triggers:set', (_e, t) => {
    config.triggers = Crosshair.sanitizeTriggers(t);
    heldInputs.clear();
    saveSoon();
    broadcastState();
    return config.triggers;
  });

  ipcMain.handle('mode:set', (_e, mode) => {
    config.displayMode = mode === 'fullscreen' ? 'fullscreen' : 'borderless';
    startTopTimer();
    saveSoon();
    broadcastState();
    return config.displayMode;
  });

  ipcMain.handle('overlay:set', (_e, v) => {
    setOverlayVisible(!!v);
    return config.overlayVisible;
  });

  ipcMain.handle('hotkey:set', (_e, accel, which) => ({ ok: setHotkey(accel, which), hotkeys: { toggle: config.hotkey, next: config.hotkeyNext, prev: config.hotkeyPrev } }));

  ipcMain.handle('profile:hotkey', (_e, name, accel) => setProfileHotkey(name, accel));

  ipcMain.handle('hotkey:pause', (_e, pause) => {
    if (pause) globalShortcut.unregisterAll();
    else registerHotkeys();
    return true;
  });

  ipcMain.handle('settings:set', (_e, p) => {
    p = p && typeof p === 'object' ? p : {};
    if ('overlayScale' in p) config.overlayScale = clampNum(p.overlayScale, 0.5, 3, config.overlayScale);
    if ('overlayOpacity' in p) config.overlayOpacity = clampNum(p.overlayOpacity, 0.2, 1, config.overlayOpacity);
    if ('fpsCap' in p && [0, 30, 60, 120].indexOf(p.fpsCap) >= 0) config.fpsCap = p.fpsCap;
    if ('lowPriority' in p) config.lowPriority = !!p.lowPriority;
    if ('startHidden' in p) config.startHidden = !!p.startHidden;
    if ('onboarded' in p) config.onboarded = !!p.onboarded;
    if ('hideFromCapture' in p) { config.hideFromCapture = !!p.hideFromCapture; applyCaptureProtection(); }
    if ('accentColor' in p && /^#[0-9a-f]{6}$/i.test(String(p.accentColor))) config.accentColor = String(p.accentColor).toLowerCase();
    if ('memoryMode' in p && ['balanced', 'low', 'lowest'].indexOf(p.memoryMode) >= 0) config.memoryMode = p.memoryMode;
    let moved = false;
    if ('overlayOffsetX' in p) { config.overlayOffsetX = Math.round(clampNum(p.overlayOffsetX, -100, 100, config.overlayOffsetX)); moved = true; }
    if ('overlayOffsetY' in p) { config.overlayOffsetY = Math.round(clampNum(p.overlayOffsetY, -100, 100, config.overlayOffsetY)); moved = true; }
    if (moved) positionOverlay();
    fitOverlay();
    applyPriority();
    saveSoon();
    broadcastState();
    return true;
  });

  ipcMain.handle('perf:get', () => perfSnapshot());

  ipcMain.handle('games:set', (_e, p) => {
    p = p && typeof p === 'object' ? p : {};
    if ('gameProfiles' in p) config.gameProfiles = cleanGames(p.gameProfiles);
    if ('autoSwitch' in p) config.autoSwitch = !!p.autoSwitch;
    if ('autoRevert' in p) config.autoRevert = !!p.autoRevert;
    if ('followWindow' in p) config.followWindow = !!p.followWindow;
    if ('gameOnly' in p) config.gameOnly = !!p.gameOnly;
    if (watcher && !config.followWindow && followCenter) { followCenter = null; positionOverlay(); }
    // Re-evaluate the current foreground app against the new rules.
    if (watcher) { stopWatcher(); positionOverlay(); }
    syncWatcher();
    applyOverlayVisibility();
    saveSoon();
    broadcastState();
    return true;
  });

  ipcMain.handle('procs:list', () => listProcesses());

  ipcMain.handle('update:set', (_e, on) => {
    config.checkUpdates = !!on;
    if (config.checkUpdates) checkForUpdate(); else { updateInfo = null; updateTrayMenu(); }
    saveSoon();
    broadcastState();
    return config.checkUpdates;
  });
  ipcMain.handle('update:check', () => checkForUpdate(true));
  ipcMain.handle('update:open', () => { shell.openExternal(updateInfo ? updateInfo.url : RELEASES_PAGE); return true; });
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installUpdate());

  ipcMain.handle('app:relaunch', () => {
    saveNow();
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('overlay:diag', () => alignmentDiag());

  ipcMain.handle('guide:set', (_e, on) => {
    guideOn = !!on;
    clearTimeout(guideTimer);
    if (guideOn) guideTimer = setTimeout(() => { guideOn = false; broadcastState(); }, 15000);
    broadcastState();
    return true;
  });

  ipcMain.handle('backup:export', async () => {
    const win = editorWin && !editorWin.isDestroyed() ? editorWin : undefined;
    const r = await dialog.showSaveDialog(win, {
      title: 'Export EZ Reticle backup',
      defaultPath: 'ez-reticle-backup.json',
      filters: [{ name: 'Backup', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try {
      fs.writeFileSync(r.filePath, JSON.stringify({ app: 'ez-reticle', version: 1, data: config }, null, 2));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not write that file' };
    }
  });

  ipcMain.handle('backup:import', async () => {
    const win = editorWin && !editorWin.isDestroyed() ? editorWin : undefined;
    const r = await dialog.showOpenDialog(win, {
      title: 'Restore EZ Reticle backup',
      properties: ['openFile'],
      filters: [{ name: 'Backup', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    try {
      const raw = fs.readFileSync(r.filePaths[0], 'utf8');
      if (raw.length > 30 * 1024 * 1024) return { ok: false, error: 'That file is too large' };
      const parsed = JSON.parse(raw);
      if (!parsed || (parsed.app !== 'ez-reticle' && parsed.app !== 'mishez-xhair') || typeof parsed.data !== 'object') return { ok: false, error: 'That is not a EZ Reticle backup' };
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      try { fs.writeFileSync(settingsPath() + '.pre-restore', JSON.stringify(config, null, 2)); } catch (e2) { /* ignore */ }
      fs.writeFileSync(settingsPath(), JSON.stringify(parsed.data));
      const next = loadConfig();
      activeProfile = null;
      config = next;
      heldInputs.clear();
      if (watcher) stopWatcher();
      registerHotkeys();
      startTopTimer();
      applyOverlayVisibility();
      fitOverlay();
      applyPriority();
      syncHook();
      positionOverlay();
      syncWatcher();
      sendTo(overlayWin, 'crosshair:changed', config.crosshair);
      sendTo(editorWin, 'crosshair:changed', config.crosshair);
      broadcastState();
      saveSoon();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not read that backup' };
    }
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

// Some games grab the topmost slot; keep taking it back. "Fullscreen games" mode does this
// more often than the simple overlay mode. Nothing runs while the overlay is hidden.
let topTimer = null;
function startTopTimer() {
  clearInterval(topTimer);
  const ms = config.displayMode === 'fullscreen' ? 500 : 5000;
  topTimer = setInterval(() => {
    // Only while actually shown: on Windows, setAlwaysOnTop on a hidden window shows it again,
    // which brought the crosshair back a few seconds after "only while a game is in front" hid it.
    if (config.overlayVisible && overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
      overlayWin.setAlwaysOnTop(true, 'screen-saver');
      overlayWin.moveTop();
    }
  }, ms);
}

// Runs every EZ Reticle process below normal priority so the game always wins the CPU.
// While the crosshair is static and the editor is closed, also uses Windows "Efficiency mode"
// (idle priority + EcoQoS), like Task Manager's toggle: a static overlay needs no CPU to stay on
// screen, since Windows keeps compositing the last frame. Animations keep normal scheduling so
// they stay smooth while a game loads the CPU.
function applyPriority() {
  const P = os.constants.priority;
  const level = config.lowPriority ? P.PRIORITY_BELOW_NORMAL : P.PRIORITY_NORMAL;
  const editorOpen = !!(editorWin && !editorWin.isDestroyed() && editorWin.isVisible() && !editorWin.isMinimized());
  const eco = config.lowPriority && hookState !== 'running' && !editorOpen && Native.available;
  try {
    const pids = new Set([process.pid]);
    app.getAppMetrics().forEach((m) => pids.add(m.pid));
    pids.forEach((pid) => {
      let lvl = eco ? P.PRIORITY_LOW : level; // PRIORITY_LOW = Windows idle priority class
      // The uiohook fallback runs its low-level hook in this process; Windows waits on that hook
      // for every mouse/key event, so it must not be starved by the game.
      if (pid === process.pid && hookKind === 'uiohook') lvl = P.PRIORITY_NORMAL;
      try { os.setPriority(pid, lvl); } catch (e) { /* not permitted */ }
      Native.setEfficiency(pid, eco);
    });
  } catch (e) { /* ignore */ }
}

// What the app costs while you play: everything except the editor window's own renderer.
function perfSnapshot() {
  const editorPid = editorWin && !editorWin.isDestroyed() ? editorWin.webContents.getOSProcessId() : -1;
  let cpu = 0;
  let mem = 0;
  let count = 0;
  app.getAppMetrics().forEach((m) => {
    if (m.pid === editorPid) return;
    cpu += m.cpu.percentCPUUsage;
    mem += m.memory.workingSetSize; // KB
    count++;
  });
  return {
    cpu,
    memMB: mem / 1024,
    processes: count,
    editorOpen: editorPid > 0,
    overlaySize,
    overlayVisible: config.overlayVisible,
    hook: hookState
  };
}

// ---------------------------------------------------------------- update check
// "1.1.0", "v1.2", "EZ_RecticalV1.2.1" -> [1, 2, 1]
function versionParts(v) {
  const m = String(v || '').match(/(\d+(?:\.\d+)*)\s*$/) || String(v || '').match(/(\d+(?:\.\d+)+)/);
  return m ? m[1].split('.').map(Number) : null;
}

function isNewer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Installed builds update in place with electron-updater (download on request, install on restart).
// Running from source, or if a release has no latest.yml, it falls back to a link to the release page.
let autoUpdater = null;
let updatePhase = ''; // '', 'downloading', 'ready', 'error'
let updatePercent = 0;
function initAutoUpdater() {
  if (!app.isPackaged || autoUpdater) return autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { logError(e); return null; }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('download-progress', (pr) => { updatePhase = 'downloading'; updatePercent = Math.round(pr.percent || 0); broadcastState(); });
  autoUpdater.on('update-downloaded', () => { updatePhase = 'ready'; updatePercent = 100; updateTrayMenu(); broadcastState(); });
  autoUpdater.on('error', (e) => { logError(e); if (updatePhase === 'downloading') { updatePhase = 'error'; broadcastState(); } });
  return autoUpdater;
}

function publicUpdate() {
  if (!updateInfo) return null;
  return Object.assign({}, updateInfo, { phase: updatePhase, percent: updatePercent });
}

function downloadUpdate() {
  if (!updateInfo || !updateInfo.canInstall || !autoUpdater) { shell.openExternal(updateInfo ? updateInfo.url : RELEASES_PAGE); return false; }
  if (updatePhase === 'ready') { installUpdate(); return true; }
  if (updatePhase === 'downloading') return true;
  updatePhase = 'downloading';
  updatePercent = 0;
  broadcastState();
  autoUpdater.downloadUpdate().catch((e) => { logError(e); updatePhase = 'error'; broadcastState(); });
  return true;
}

function installUpdate() {
  if (!autoUpdater || updatePhase !== 'ready') return false;
  quitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

async function checkWithUpdater() {
  const u = initAutoUpdater();
  if (!u) return null;
  try {
    const r = await u.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    const latest = versionParts(v), mine = versionParts(app.getVersion());
    if (latest && mine && isNewer(latest, mine)) {
      updateInfo = { version: latest.join('.'), url: RELEASES_PAGE, canInstall: true };
    } else if (updatePhase !== 'ready') {
      updateInfo = null;
    }
    return { ok: true };
  } catch (e) {
    return null; // e.g. the release has no latest.yml: use the plain check instead
  }
}

// Asks GitHub for the latest release once at start and every 6 hours.
async function checkForUpdate(manual) {
  if (!config.checkUpdates && !manual) return null;
  if (updatePhase === 'downloading' || updatePhase === 'ready') return { ok: true, update: publicUpdate() };
  const viaUpdater = await checkWithUpdater();
  if (viaUpdater) { updateTrayMenu(); broadcastState(); return { ok: true, update: publicUpdate() }; }
  return checkLatestRelease();
}

function checkLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(RELEASES_API, { headers: { 'User-Agent': 'EZ-Reticle/' + app.getVersion(), Accept: 'application/vnd.github+json' }, timeout: 10000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 400000) body += d; });
      res.on('end', () => {
        let r = null;
        try {
          const j = JSON.parse(body);
          const latest = versionParts(j.tag_name) || versionParts(j.name);
          const mine = versionParts(app.getVersion());
          if (res.statusCode === 200 && latest && mine && isNewer(latest, mine) && !j.draft && !j.prerelease) {
            r = { version: latest.join('.'), url: typeof j.html_url === 'string' && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : RELEASES_PAGE };
          }
          updateInfo = r;
          updateTrayMenu();
          broadcastState();
          resolve({ ok: res.statusCode === 200, update: publicUpdate() });
        } catch (e) { resolve({ ok: false, update: publicUpdate() }); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false, update: publicUpdate() }));
  });
}

// ---------------------------------------------------------------- lifecycle
// Never show a crash dialog while someone is gaming; log it instead.
function logError(err) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), new Date().toISOString() + ' ' + (err && err.stack || err) + '\n');
  } catch (e) { /* ignore */ }
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showEditor);
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    if (watcher) { try { watcher.kill(); } catch (e) { /* ignore */ } }
    globalShortcut.unregisterAll();
    saveNow();
    if (hookState === 'running') stopInputListener();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.ezggco.reticle');
    config = loadConfig();
    icon32 = makeIcon(32);
    icon64 = makeIcon(64);

    setupIpc();
    createOverlay();

    tray = new Tray(icon32);
    tray.setToolTip('EZ Reticle');
    tray.on('click', showEditor);
    updateTrayMenu();

    registerHotkeys();
    syncHook();

    if (!process.argv.includes('--hidden') && !config.startHidden) showEditor();

    const refresh = () => { overlaySize = 0; positionOverlay(); };
    screen.on('display-added', refresh);
    screen.on('display-removed', refresh);
    screen.on('display-metrics-changed', refresh);
    try {
      const { powerMonitor } = require('electron');
      powerMonitor.on('resume', () => setTimeout(refresh, 1500));
      powerMonitor.on('unlock-screen', () => setTimeout(refresh, 500));
    } catch (e) { /* not available */ }
    syncWatcher();
    setTimeout(() => checkForUpdate(), 8000);
    setInterval(() => checkForUpdate(), 6 * 3600 * 1000);

    startTopTimer();
    applyPriority();
    setInterval(applyPriority, 60000);
  });
}
