'use strict';

// Builds native/build/Release/ez_native.node for the installed Electron (Windows only).
//   node tools/build-native.js            build; on failure warn and exit 0 (the app falls back)
//   node tools/build-native.js --strict   build; on failure exit 1 (used by the release workflow)
// Needs Visual Studio Build Tools with the "Desktop development with C++" workload.

const path = require('path');
const { spawnSync } = require('child_process');

const strict = process.argv.includes('--strict');
const root = path.join(__dirname, '..');

function done(ok, msg) {
  if (ok) { console.log('[build-native] ' + msg); process.exit(0); }
  console.warn('[build-native] ' + msg);
  if (strict) process.exit(1);
  console.warn('[build-native] EZ Reticle will fall back to uiohook-napi and the PowerShell watcher.');
  process.exit(0);
}

if (process.platform !== 'win32') done(!strict, 'skipped: the native helper is Windows-only.');

let electronVersion;
try {
  electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
} catch (e) {
  done(false, 'Electron is not installed yet; run npm install first.');
}

let gyp;
try {
  gyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [root] });
} catch (e) {
  done(false, 'node-gyp is not installed (it is a devDependency; run npm install).');
}

const r = spawnSync(process.execPath, [
  gyp, 'rebuild',
  '--directory', path.join(root, 'native'),
  '--target=' + electronVersion,
  '--arch=' + process.arch,
  '--dist-url=https://electronjs.org/headers'
], { stdio: 'inherit' });

done(r.status === 0, r.status === 0
  ? 'built native/build/Release/ez_native.node for Electron ' + electronVersion
  : 'build failed (exit ' + r.status + ').');
