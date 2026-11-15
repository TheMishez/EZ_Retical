'use strict';

// Wrapper around the native helper (native/src/ez_native.cc).
// `available` is false when the binary is missing (not built, or not Windows); callers fall back
// to uiohook-napi for input and to the PowerShell watcher for the foreground window.

let binding = null;
let loadError = null;
if (process.platform === 'win32') {
  try {
    binding = require('./build/Release/ez_native.node');
  } catch (e) {
    loadError = e;
  }
}

// Set-1 scan codes (from Raw Input) to KeyboardEvent.code names, so keys come out with the same
// names the editor records (Crosshair.canonKey turns these into "A", "Space", "Shift", ...).
const SCAN = {
  0x01: 'Escape', 0x0C: 'Minus', 0x0D: 'Equal', 0x0E: 'Backspace', 0x0F: 'Tab',
  0x1A: 'BracketLeft', 0x1B: 'BracketRight', 0x1C: 'Enter', 0x1D: 'ControlLeft',
  0x27: 'Semicolon', 0x28: 'Quote', 0x29: 'Backquote', 0x2A: 'ShiftLeft', 0x2B: 'Backslash',
  0x33: 'Comma', 0x34: 'Period', 0x35: 'Slash', 0x36: 'ShiftRight', 0x37: 'NumpadMultiply',
  0x38: 'AltLeft', 0x39: 'Space', 0x3A: 'CapsLock', 0x45: 'NumLock', 0x46: 'ScrollLock',
  0x47: 'Numpad7', 0x48: 'Numpad8', 0x49: 'Numpad9', 0x4A: 'NumpadSubtract',
  0x4B: 'Numpad4', 0x4C: 'Numpad5', 0x4D: 'Numpad6', 0x4E: 'NumpadAdd',
  0x4F: 'Numpad1', 0x50: 'Numpad2', 0x51: 'Numpad3', 0x52: 'Numpad0', 0x53: 'NumpadDecimal',
  0x56: 'IntlBackslash', 0x57: 'F11', 0x58: 'F12', 0x76: 'F24'
};
'1234567890'.split('').forEach((d, i) => { SCAN[0x02 + i] = 'Digit' + d; });
'QWERTYUIOP'.split('').forEach((c, i) => { SCAN[0x10 + i] = 'Key' + c; });
'ASDFGHJKL'.split('').forEach((c, i) => { SCAN[0x1E + i] = 'Key' + c; });
'ZXCVBNM'.split('').forEach((c, i) => { SCAN[0x2C + i] = 'Key' + c; });
for (let i = 0; i < 10; i++) SCAN[0x3B + i] = 'F' + (i + 1);
for (let i = 0; i < 11; i++) SCAN[0x64 + i] = 'F' + (13 + i);

// Extended (E0-prefixed) keys. E0 2A / E0 36 are "fake shifts" some keyboards send around
// navigation keys; they are left out on purpose.
const SCAN_E0 = {
  0x1C: 'NumpadEnter', 0x1D: 'ControlRight', 0x35: 'NumpadDivide', 0x37: 'PrintScreen',
  0x38: 'AltRight', 0x45: 'NumLock', 0x47: 'Home', 0x48: 'ArrowUp', 0x49: 'PageUp',
  0x4B: 'ArrowLeft', 0x4D: 'ArrowRight', 0x4F: 'End', 0x50: 'ArrowDown', 0x51: 'PageDown',
  0x52: 'Insert', 0x53: 'Delete', 0x5B: 'MetaLeft', 0x5C: 'MetaRight', 0x5D: 'ContextMenu'
};

function keyCode(scan, e0) {
  return (e0 ? SCAN_E0 : SCAN)[scan] || null;
}

// cb(name, down): name is "Mouse1".."Mouse5" or a KeyboardEvent.code such as "KeyR".
function startInput(cb) {
  if (!binding) return false;
  return binding.inputStart((kind, code, e0, down) => {
    try {
      if (kind === 0) cb('Mouse' + code, down);
      else {
        const name = keyCode(code, e0);
        if (name) cb(name, down);
      }
    } catch (e) {
      console.error('EZ native input handler:', e);
    }
  });
}

function stopInput() {
  if (binding) binding.inputStop();
}

// cb(line): "processName|x|y|width|height" whenever the active window or its position changes.
function startForeground(cb) {
  if (!binding) return false;
  return binding.foregroundStart((line) => {
    try { cb(line); } catch (e) { console.error('EZ native foreground handler:', e); }
  });
}

function stopForeground() {
  if (binding) binding.foregroundStop();
}

// Windows "Efficiency mode" (EcoQoS) on/off for one process. Returns false when unsupported.
function setEfficiency(pid, on) {
  if (!binding || !binding.setEfficiency) return false;
  try { return !!binding.setEfficiency(pid, !!on); } catch (e) { return false; }
}

module.exports = {
  available: !!binding,
  loadError,
  keyCode,
  startInput,
  stopInput,
  startForeground,
  stopForeground,
  setEfficiency
};
