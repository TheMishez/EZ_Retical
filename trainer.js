/* Aim trainer: gridshot, flick and tracking, drawn with the user's own crosshair. */
(function (root) {
  'use strict';

  const W = 960;
  const H = 540;
  const MODES = {
    gridshot: { r: 26, label: 'Gridshot' },
    flick: { r: 15, label: 'Flick' },
    tracking: { r: 32, label: 'Tracking' }
  };

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const dayKey = () => new Date().toISOString().slice(0, 10);
  const lsGet = (k) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? null : Number(v);
    } catch (e) { return null; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ }
  };

  let abortFn = function () {};

  function init(getCfg) {
    const $ = (id) => document.getElementById(id);
    const canvas = $('trainerCanvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const modeSel = $('tMode');
    const timeSel = $('tTime');
    const sens = $('tSens');
    const sensOut = $('tSensOut');
    const lockChk = $('tLock');
    const dailyChk = $('tDaily');
    const startBtn = $('tStart');
    const statsEl = $('tStats');

    let running = false;
    let phase = 'idle'; // idle | countdown | run
    let raf = 0;
    let prevT = 0;
    let mode = 'gridshot';
    let M = MODES.gridshot;
    let duration = 30;
    let runStart = 0;
    let endTime = 0;
    let rng = Math.random;
    let targets = [];
    let effects = [];
    let hits = 0;
    let shots = 0;
    let rts = [];
    let track = { on: 0, total: 0 };
    let cursor = { x: W / 2, y: H / 2 };
    let lmb = false;
    let anim = Crosshair.newAnim();
    let lockWanted = false;
    let lockAcquired = false;
    let lastText = '';

    const randIn = (a, b) => a + rng() * (b - a);

    function spawn(avoid) {
      const r = M.r;
      const minDist = mode === 'flick' ? 240 : r * 3;
      let x, y;
      let tries = 0;
      do {
        x = randIn(r + 30, W - r - 30);
        y = randIn(r + 60, H - r - 30);
        tries++;
      } while (tries < 30 && avoid.some((a) => Math.hypot(a.x - x, a.y - y) < minDist));
      return { x: x, y: y, r: r, born: performance.now() };
    }

    function fmtValue(m, v) {
      return m === 'tracking' ? v.toFixed(1) + '%' : String(v) + ' hits';
    }

    function showStats() {
      const m = modeSel.value;
      const t = timeSel.value;
      const best = lsGet('best:' + m + ':' + t);
      const dbest = lsGet('daily:' + dayKey() + ':' + m + ':' + t);
      statsEl.textContent = '';
      const add = (label, text) => {
        const s = document.createElement('span');
        s.appendChild(document.createTextNode(label + ' '));
        const b = document.createElement('b');
        b.textContent = text;
        s.appendChild(b);
        statsEl.appendChild(s);
      };
      add('Best (' + MODES[m].label + ', ' + t + 's):', best === null ? '\u2013' : fmtValue(m, best));
      add('Today\u2019s daily best:', dbest === null ? '\u2013' : fmtValue(m, dbest));
    }

    // ------------------------------------------------------------ run control
    function releaseLock() {
      lockWanted = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }

    function start() {
      mode = modeSel.value;
      M = MODES[mode];
      duration = Number(timeSel.value) || 30;
      rng = dailyChk.checked ? mulberry32(hashStr(dayKey() + ':' + mode + ':' + duration)) : Math.random;
      targets = [];
      effects = [];
      hits = 0;
      shots = 0;
      rts = [];
      track = { on: 0, total: 0 };
      if (mode === 'gridshot') {
        for (let i = 0; i < 3; i++) targets.push(spawn(targets));
      } else if (mode === 'flick') {
        targets.push(spawn([]));
      } else {
        const t = spawn([]);
        const a = rng() * Math.PI * 2;
        t.vx = Math.cos(a) * 220;
        t.vy = Math.sin(a) * 220;
        t.turn = 0.6;
        targets.push(t);
      }
      cursor = { x: W / 2, y: H / 2 };
      anim = Crosshair.newAnim();
      lmb = false;
      lastText = '';

      const now = performance.now();
      runStart = now + 2000;
      endTime = runStart + duration * 1000;
      phase = 'countdown';
      running = true;
      startBtn.textContent = 'Stop';
      canvas.classList.add('playing');

      lockAcquired = false;
      lockWanted = lockChk.checked;
      if (lockWanted) {
        try {
          const p = canvas.requestPointerLock();
          if (p && typeof p.catch === 'function') p.catch(() => { lockWanted = false; });
        } catch (e) { lockWanted = false; }
      }

      prevT = now;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }

    function end(text) {
      running = false;
      phase = 'idle';
      cancelAnimationFrame(raf);
      releaseLock();
      startBtn.textContent = 'Start';
      canvas.classList.remove('playing');
      lastText = text;
      render(performance.now());
      showStats();
    }

    function abort(msg) {
      if (!running) return;
      end(msg || 'Stopped');
    }
    abortFn = abort;

    function finish() {
      let value;
      let text;
      if (mode === 'tracking') {
        const pct = track.total > 0 ? (track.on / track.total) * 100 : 0;
        value = Math.round(pct * 10) / 10;
        text = value.toFixed(1) + '% on target';
      } else {
        const acc = shots ? (hits / shots) * 100 : 0;
        const avg = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
        value = hits;
        text = hits + ' hits \u00b7 ' + acc.toFixed(0) + '% accuracy' + (rts.length ? ' \u00b7 ' + avg.toFixed(0) + ' ms avg' : '');
      }
      const bestKey = 'best:' + mode + ':' + duration;
      const prevBest = lsGet(bestKey);
      let newBest = false;
      if (prevBest === null || value > prevBest) { lsSet(bestKey, value); newBest = true; }
      if (dailyChk.checked) {
        const dKey = 'daily:' + dayKey() + ':' + mode + ':' + duration;
        const prevD = lsGet(dKey);
        if (prevD === null || value > prevD) lsSet(dKey, value);
      }
      end(text + (newBest ? '  \u2014 new best!' : ''));
    }

    // ------------------------------------------------------------ simulation
    function updateTracking(dt) {
      const t = targets[0];
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      if (t.x < t.r + 10) { t.x = t.r + 10; t.vx = Math.abs(t.vx); }
      if (t.x > W - t.r - 10) { t.x = W - t.r - 10; t.vx = -Math.abs(t.vx); }
      if (t.y < t.r + 60) { t.y = t.r + 60; t.vy = Math.abs(t.vy); }
      if (t.y > H - t.r - 10) { t.y = H - t.r - 10; t.vy = -Math.abs(t.vy); }
      t.turn -= dt;
      if (t.turn <= 0) {
        const a = rng() * Math.PI * 2;
        const sp = 180 + rng() * 140;
        t.vx = Math.cos(a) * sp;
        t.vy = Math.sin(a) * sp;
        t.turn = 0.4 + rng() * 0.8;
      }
      track.total += dt;
      if (lmb && Math.hypot(t.x - cursor.x, t.y - cursor.y) <= t.r) track.on += dt;
    }

    function loop(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - prevT) / 1000);
      prevT = now;
      Crosshair.stepAnim(anim, getCfg(), dt);
      if (phase === 'countdown' && now >= runStart) {
        phase = 'run';
        targets.forEach((t) => { t.born = now; });
      }
      if (phase === 'run') {
        if (mode === 'tracking') updateTracking(dt);
        if (now >= endTime) { finish(); return; }
      }
      effects = effects.filter((e) => now - e.t0 < 300);
      render(now);
      raf = requestAnimationFrame(loop);
    }

    // ------------------------------------------------------------ drawing
    function drawTarget(t, hot) {
      const main = hot ? '#3ddc84' : '#ff4d5e';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fillStyle = main; ctx.fill();
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.62, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.28, 0, Math.PI * 2); ctx.fillStyle = main; ctx.fill();
    }

    function render(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0e1116';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 60) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
      for (let y = 0; y <= H; y += 60) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
      ctx.stroke();

      ctx.textAlign = 'center';
      if (phase === 'idle') {
        ctx.fillStyle = '#e8ecf2';
        ctx.font = '600 28px "Segoe UI", sans-serif';
        ctx.fillText(lastText || 'Pick a mode and press Start', W / 2, H / 2);
        ctx.fillStyle = '#8b93a1';
        ctx.font = '16px "Segoe UI", sans-serif';
        ctx.fillText('Esc releases the mouse and stops the run', W / 2, H / 2 + 34);
        return;
      }

      targets.forEach((t) => {
        const hot = mode === 'tracking' && lmb && Math.hypot(t.x - cursor.x, t.y - cursor.y) <= t.r;
        drawTarget(t, hot);
      });

      effects.forEach((e) => {
        const k = (now - e.t0) / 300;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (1 + k * 0.8), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - k)).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.stroke();
      });

      ctx.font = '600 20px "Segoe UI", sans-serif';
      ctx.fillStyle = '#e8ecf2';
      ctx.textAlign = 'left';
      const left = phase === 'run' ? Math.max(0, (endTime - now) / 1000) : duration;
      ctx.fillText(left.toFixed(1) + 's', 20, 34);
      ctx.textAlign = 'right';
      if (mode === 'tracking') {
        const pct = track.total > 0 ? (track.on / track.total) * 100 : 0;
        ctx.fillText('On target ' + pct.toFixed(0) + '%', W - 20, 34);
      } else {
        const acc = shots ? (hits / shots) * 100 : 0;
        ctx.fillText('Hits ' + hits + '   Acc ' + acc.toFixed(0) + '%', W - 20, 34);
      }

      if (phase === 'countdown') {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '700 64px "Segoe UI", sans-serif';
        ctx.fillText(String(Math.max(1, Math.ceil((runStart - now) / 1000))), W / 2, H / 2 + 22);
      }

      Crosshair.draw(ctx, getCfg(), anim, cursor.x, cursor.y, 1);
    }

    // ------------------------------------------------------------ input
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const k = W / rect.width;
      if (document.pointerLockElement === canvas) {
        const s = Number(sens.value);
        cursor.x += e.movementX * k * s;
        cursor.y += e.movementY * k * s;
      } else {
        cursor.x = (e.clientX - rect.left) * k;
        cursor.y = (e.clientY - rect.top) * k;
      }
      cursor.x = Math.max(0, Math.min(W, cursor.x));
      cursor.y = Math.max(0, Math.min(H, cursor.y));
    });

    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!running) return;
      if (e.button === 0) lmb = true;
      anim.kick = 1;
      if (phase !== 'run' || e.button !== 0 || mode === 'tracking') return;
      const now = performance.now();
      shots++;
      let idx = -1;
      let best = Infinity;
      targets.forEach((t, i) => {
        const d = Math.hypot(t.x - cursor.x, t.y - cursor.y);
        if (d <= t.r && d < best) { best = d; idx = i; }
      });
      if (idx >= 0) {
        hits++;
        const t = targets[idx];
        rts.push(now - t.born);
        effects.push({ x: t.x, y: t.y, r: t.r, t0: now });
        const avoid = mode === 'flick' ? [t] : targets.filter((_, j) => j !== idx);
        targets[idx] = spawn(avoid);
      }
    });

    window.addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; });

    window.addEventListener('keydown', (e) => {
      if (!running) return;
      const k = e.key.toLowerCase();
      if ('wasd'.indexOf(k) >= 0 && k.length === 1) anim.keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      anim.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => abort('Stopped'));

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        lockAcquired = true;
      } else if (lockAcquired && running) {
        lockAcquired = false;
        abort('Stopped');
      } else {
        lockAcquired = false;
      }
    });
    document.addEventListener('pointerlockerror', () => { lockWanted = false; });

    // ------------------------------------------------------------ UI wiring
    startBtn.addEventListener('click', () => {
      if (running) abort('Stopped');
      else start();
    });
    sens.addEventListener('input', () => { sensOut.textContent = Number(sens.value).toFixed(1) + '\u00d7'; });
    modeSel.addEventListener('change', showStats);
    timeSel.addEventListener('change', showStats);

    showStats();
    render(performance.now());
  }

  root.Trainer = {
    init: init,
    abort: function () { abortFn('Stopped'); }
  };
})(window);
