'use strict';

const canvas = document.getElementById('c');
const ctrl = Crosshair.createController(canvas, { size: window.innerWidth || 200, zoom: 1 });

// The window is sized to the crosshair by the main process; follow it.
window.addEventListener('resize', () => ctrl.setSize(window.innerWidth));

// Alignment guide: 1-physical-pixel lines through the exact middle, drawn in device pixels.
let guideWanted = false;
window.addEventListener('resize', () => { if (guideWanted) drawGuide(true); });

function drawGuide(on) {
  guideWanted = on;
  const g = document.getElementById('g');
  g.hidden = !on;
  if (!on) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  g.width = W;
  g.height = H;
  g.style.width = W / dpr + 'px';
  g.style.height = H / dpr + 'px';
  const x = g.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.fillStyle = '#ff00ff';
  const cx = Math.floor((W - 1) / 2);
  const cy = Math.floor((H - 1) / 2);
  const w = W % 2 === 0 ? 2 : 1; // even window: the centre sits between two pixels
  const h = H % 2 === 0 ? 2 : 1;
  x.fillRect(cx, 0, w, H);
  x.fillRect(0, cy, W, h);
  x.fillStyle = '#00ffff';
  for (let i = 10; i < Math.min(W, H) / 2; i += 10) {
    const len = i % 50 === 0 ? 7 : 3;
    x.fillRect(cx - i, cy - len, 1, len * 2 + h);
    x.fillRect(cx + w - 1 + i, cy - len, 1, len * 2 + h);
    x.fillRect(cx - len, cy - i, len * 2 + w, 1);
    x.fillRect(cx - len, cy + h - 1 + i, len * 2 + w, 1);
  }
}

function applyState(s) {
  if (!s) return;
  drawGuide(!!s.guide);
  ctrl.setZoom(s.overlayScale || 1);
  ctrl.setFpsCap(s.fpsCap === undefined ? 60 : s.fpsCap);
  canvas.style.opacity = String(s.overlayOpacity === undefined ? 1 : s.overlayOpacity);
}

window.api.getConfig().then((c) => { ctrl.setConfig(c.crosshair); applyState(c); });
window.api.onCrosshair((c) => ctrl.setConfig(c));
window.api.onState(applyState);
window.api.onInput((e) => ctrl.input(e));
