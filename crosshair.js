/*
 * Shared crosshair logic: config validation, drawing and animation.
 * Loaded by the main process (require) and by the renderers (<script>).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Crosshair = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STYLES = ['cross', 'x', 'circle', 'square', 'dot'];
  const ANIMS = ['none', 'expand-click', 'shrink-click', 'expand-move', 'pulse', 'flash'];

  const DEFAULTS = {
    style: 'cross',
    color: '#00ff66',
    opacity: 1,
    size: 10,
    gap: 4,
    thickness: 2,
    rotation: 0,
    tStyle: false,
    dot: false,
    dotSize: 2,
    outline: true,
    outlineColor: '#000000',
    outlineThickness: 1,
    offsetX: 0,
    offsetY: 0,
    animation: 'none',
    animIntensity: 6,
    animDuration: 150
  };

  const RANGES = {
    opacity: [0.1, 1],
    size: [0, 60],
    gap: [0, 40],
    thickness: [1, 12],
    rotation: [0, 359],
    dotSize: [1, 12],
    outlineThickness: [0, 6],
    offsetX: [-250, 250],
    offsetY: [-250, 250],
    animIntensity: [0, 30],
    animDuration: [40, 600]
  };

  function isHex(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  // Returns a complete, clamped config. Anything missing or invalid falls back to the default.
  function sanitize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
      const def = DEFAULTS[key];
      const v = src[key];
      if (key === 'style') out[key] = STYLES.indexOf(v) >= 0 ? v : def;
      else if (key === 'animation') out[key] = ANIMS.indexOf(v) >= 0 ? v : def;
      else if (key === 'color' || key === 'outlineColor') out[key] = isHex(v) ? v.toLowerCase() : def;
      else if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
      else {
        const n = typeof v === 'number' ? v : Number(v);
        const r = RANGES[key];
        out[key] = v !== undefined && v !== null && Number.isFinite(n) ? Math.min(r[1], Math.max(r[0], n)) : def;
      }
    }
    return out;
  }

  // ---------- color helpers
  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function invertHex(h) {
    const c = hexToRgb(h);
    return '#' + c.map(function (v) { return (255 - v).toString(16).padStart(2, '0'); }).join('');
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const m = A.map(function (v, i) { return Math.round(v + (B[i] - v) * t); });
    return 'rgb(' + m.join(',') + ')';
  }

  // ---------- animation state
  function newAnim() {
    return { kick: 0, move: 0, keys: new Set() };
  }

  // Advances animation by dt seconds. Returns true while something is still animating.
  function stepAnim(a, cfg, dt) {
    const dur = Math.max(0.04, cfg.animDuration / 1000);
    a.kick = Math.max(0, a.kick - dt / dur);
    const target = a.keys.size > 0 ? 1 : 0;
    const d = dt / dur;
    if (a.move < target) a.move = Math.min(target, a.move + d);
    else if (a.move > target) a.move = Math.max(target, a.move - d);
    return a.kick > 0 || a.move !== target;
  }

  // ---------- drawing
  function shape(ctx, cfg, gap, g) {
    const t = cfg.thickness;
    const s = cfg.size;
    switch (cfg.style) {
      case 'cross':
      case 'x': {
        if (s > 0) {
          if (cfg.style === 'cross' && cfg.rotation === 0) {
            // Pixel-aligned plus: a centre box of t x t, with four arms attached around it.
            const tt = Math.max(1, Math.round(t));
            const a = Math.floor(tt / 2);
            const x0 = -a;
            const x1 = -a + tt;
            const gg = Math.round(gap);
            const ss = Math.max(1, Math.round(s));
            const box = function (x, y, w, h) { ctx.fillRect(x - g, y - g, w + g * 2, h + g * 2); };
            box(x1 + gg, x0, ss, tt); // right
            box(x0 - gg - ss, x0, ss, tt); // left
            box(x0, x1 + gg, tt, ss); // bottom
            if (!cfg.tStyle) box(x0, x0 - gg - ss, tt, ss); // top
          } else {
            // Rotated / X style: arms are centred on their own axis, then rotated about the centre.
            const y0 = -t / 2 - g;
            const h = t + g * 2;
            for (let i = 0; i < 4; i++) {
              if (cfg.tStyle && cfg.style === 'cross' && i === 3) continue; // i=3 is the top arm
              ctx.save();
              ctx.rotate((i * Math.PI) / 2);
              ctx.fillRect(gap - g, y0, s + g * 2, h);
              ctx.restore();
            }
          }
        }
        break;
      }
      case 'circle':
        ctx.lineWidth = t + g * 2;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, s + gap), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'square': {
        const h2 = Math.max(1, s + gap);
        ctx.lineWidth = t + g * 2;
        ctx.lineJoin = 'miter';
        ctx.strokeRect(-h2, -h2, h2 * 2, h2 * 2);
        break;
      }
      case 'dot':
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, s / 4) + g, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    if (cfg.dot && cfg.style !== 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, cfg.dotSize / 2 + g, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draws the crosshair centred on (cx, cy) in the current canvas coordinate space.
  function draw(ctx, cfg, anim, cx, cy, zoom) {
    let gap = cfg.gap;
    let scale = 1;
    let color = cfg.color;
    const I = cfg.animIntensity;
    switch (cfg.animation) {
      case 'expand-click': gap += anim.kick * I; break;
      case 'shrink-click': gap = Math.max(0, gap - anim.kick * I); break;
      case 'expand-move': gap += anim.move * I; break;
      case 'pulse': scale = 1 + anim.kick * (I / 30); break;
      case 'flash': color = mixHex(cfg.color, invertHex(cfg.color), anim.kick); break;
    }
    const o = cfg.outline ? cfg.outlineThickness : 0;
    const rot = (cfg.rotation * Math.PI) / 180 + (cfg.style === 'x' ? Math.PI / 4 : 0);
    const z = (zoom || 1) * scale;

    ctx.save();
    ctx.globalAlpha = cfg.opacity;
    ctx.translate(cx, cy);
    ctx.scale(z, z);
    ctx.rotate(rot);
    for (let pass = o > 0 ? 0 : 1; pass < 2; pass++) {
      const g = pass === 0 ? o : 0;
      const paint = pass === 0 ? cfg.outlineColor : color;
      ctx.fillStyle = paint;
      ctx.strokeStyle = paint;
      shape(ctx, cfg, gap, g);
    }
    ctx.restore();
  }

  // Binds a crosshair to a canvas (used by the overlay and the editor preview).
  function createController(canvas, opts) {
    opts = opts || {};
    const logical = opts.size || 600;
    let zoom = opts.zoom || 1;
    const useOffset = opts.useOffset !== false;
    const ctx = canvas.getContext('2d');
    let cfg = sanitize(null);
    const anim = newAnim();
    let raf = 0;
    let last = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(logical * dpr);
      canvas.height = Math.round(logical * dpr);
      canvas.style.width = logical + 'px';
      canvas.style.height = logical + 'px';
    }

    function render() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = Math.round(logical / 2 + (useOffset ? cfg.offsetX : 0));
      const cy = Math.round(logical / 2 + (useOffset ? cfg.offsetY : 0));
      draw(ctx, cfg, anim, cx, cy, zoom);
    }

    function tick(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const more = stepAnim(anim, cfg, dt);
      render();
      if (more) schedule();
    }

    function schedule() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }

    resize();
    render();
    window.addEventListener('resize', function () { resize(); render(); });

    return {
      setConfig: function (c) { cfg = sanitize(c); render(); },
      setZoom: function (z) { zoom = z; render(); },
      render: render,
      input: function (e) {
        if (!e || cfg.animation === 'none') return;
        if (e.type === 'mousedown') anim.kick = 1;
        else if (e.type === 'keydown') anim.keys.add(e.key);
        else if (e.type === 'keyup') anim.keys.delete(e.key);
        else return;
        schedule();
      }
    };
  }

  return {
    STYLES: STYLES,
    ANIMS: ANIMS,
    DEFAULTS: DEFAULTS,
    RANGES: RANGES,
    sanitize: sanitize,
    newAnim: newAnim,
    stepAnim: stepAnim,
    draw: draw,
    createController: createController
  };
});
