(function () {
  'use strict';

  const api = window.api;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const mk = (tag, props) => Object.assign(document.createElement(tag), props || {});

  let state = null;
  let cfg = Crosshair.sanitize(null);
  let preview = null;
  let pushTimer = 0;
  const rows = {};

  const SCHEMA = [
    { title: 'Shape', items: [
      { key: 'style', type: 'select', label: 'Style', options: [['cross', 'Cross'], ['x', 'X'], ['circle', 'Circle'], ['square', 'Square'], ['dot', 'Dot']] },
      { key: 'size', type: 'range', label: 'Size', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'gap', type: 'range', label: 'Gap', min: 0, max: 40, step: 1, unit: 'px' },
      { key: 'thickness', type: 'range', label: 'Thickness', min: 1, max: 12, step: 1, unit: 'px' },
      { key: 'rotation', type: 'range', label: 'Rotation', min: 0, max: 359, step: 1, unit: '\u00b0' },
      { key: 'tStyle', type: 'check', label: 'T-style (no top line)' }
    ] },
    { title: 'Color', items: [
      { key: 'color', type: 'color', label: 'Color', swatches: ['#00ff66', '#00e5ff', '#ffee00', '#ff2bd6', '#ff3b3b', '#ffffff'] },
      { key: 'opacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.05, pct: true }
    ] },
    { title: 'Outline', items: [
      { key: 'outline', type: 'check', label: 'Outline' },
      { key: 'outlineColor', type: 'color', label: 'Outline color' },
      { key: 'outlineThickness', type: 'range', label: 'Outline width', min: 0, max: 6, step: 1, unit: 'px' }
    ] },
    { title: 'Center dot', items: [
      { key: 'dot', type: 'check', label: 'Center dot' },
      { key: 'dotSize', type: 'range', label: 'Dot size', min: 1, max: 12, step: 1, unit: 'px' }
    ] },
    { title: 'Position', items: [
      { key: 'offsetX', type: 'range', label: 'Offset X', min: -250, max: 250, step: 1, unit: 'px' },
      { key: 'offsetY', type: 'range', label: 'Offset Y', min: -250, max: 250, step: 1, unit: 'px' }
    ] },
    { title: 'Animation', items: [
      { key: 'animation', type: 'select', label: 'Effect', options: [
        ['none', 'None'], ['expand-click', 'Expand on click'], ['shrink-click', 'Shrink on click'],
        ['expand-move', 'Expand while moving (WASD)'], ['pulse', 'Pulse on click'], ['flash', 'Flash on click']
      ] },
      { key: 'animIntensity', type: 'range', label: 'Intensity', min: 0, max: 30, step: 1 },
      { key: 'animDuration', type: 'range', label: 'Duration', min: 40, max: 600, step: 10, unit: 'ms' }
    ] }
  ];

  // ---------------------------------------------------------------- helpers
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function pushSoon() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = 0;
      api.setCrosshair(cfg);
    }, 30);
  }

  function updateZoom() {
    const extent = Math.max(24, cfg.size + cfg.gap + cfg.animIntensity + cfg.outlineThickness + cfg.thickness);
    const zoom = Math.max(1, Math.min(4, 150 / extent));
    preview.setZoom(zoom);
    $('#zoomLabel').textContent = 'Preview zoom \u00d7' + zoom.toFixed(1);
  }

  function update(key, val) {
    cfg[key] = val;
    preview.setConfig(cfg);
    updateZoom();
    pushSoon();
  }

  function applyToControls() {
    Object.keys(rows).forEach((k) => rows[k].set(cfg[k]));
  }

  function applyNewConfig(c) {
    cfg = Crosshair.sanitize(c);
    applyToControls();
    preview.setConfig(cfg);
    updateZoom();
    api.setCrosshair(cfg);
  }

  // ---------------------------------------------------------------- controls
  function buildControls() {
    const host = $('#controls');
    SCHEMA.forEach((g) => {
      const box = mk('section', { className: 'group' });
      box.appendChild(mk('h3', { textContent: g.title }));
      g.items.forEach((it) => {
        const row = mk('div', { className: 'row' });
        row.appendChild(mk('span', { className: 'name', textContent: it.label }));
        const ctl = mk('span', { className: 'ctl' });
        row.appendChild(ctl);

        if (it.type === 'range') {
          const input = mk('input', { type: 'range', min: it.min, max: it.max, step: it.step });
          const out = mk('output');
          const show = (v) => {
            out.textContent = it.pct ? Math.round(v * 100) + '%' : v + (it.unit || '');
          };
          input.addEventListener('input', () => {
            const v = Number(input.value);
            show(v);
            update(it.key, v);
          });
          ctl.appendChild(input);
          ctl.appendChild(out);
          rows[it.key] = { set: (v) => { input.value = v; show(v); } };
        } else if (it.type === 'select') {
          const sel = mk('select');
          it.options.forEach((o) => sel.appendChild(mk('option', { value: o[0], textContent: o[1] })));
          sel.addEventListener('change', () => update(it.key, sel.value));
          ctl.appendChild(sel);
          rows[it.key] = { set: (v) => { sel.value = v; } };
        } else if (it.type === 'check') {
          const chk = mk('input', { type: 'checkbox' });
          chk.addEventListener('change', () => update(it.key, chk.checked));
          ctl.appendChild(chk);
          rows[it.key] = { set: (v) => { chk.checked = !!v; } };
        } else if (it.type === 'color') {
          const col = mk('input', { type: 'color' });
          const hex = mk('input', { type: 'text', className: 'hex', maxLength: 7, spellcheck: false });
          const setBoth = (v) => { col.value = v; hex.value = v; };
          col.addEventListener('input', () => { hex.value = col.value; update(it.key, col.value); });
          hex.addEventListener('change', () => {
            let v = hex.value.trim();
            if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
            if (/^#[0-9a-f]{6}$/i.test(v)) { v = v.toLowerCase(); setBoth(v); update(it.key, v); }
            else hex.value = col.value;
          });
          ctl.appendChild(col);
          ctl.appendChild(hex);
          (it.swatches || []).forEach((c) => {
            const b = mk('button', { type: 'button', className: 'sw', title: c });
            b.style.background = c;
            b.addEventListener('click', () => { setBoth(c); update(it.key, c); });
            ctl.appendChild(b);
          });
          rows[it.key] = { set: setBoth };
        }
        box.appendChild(row);
      });
      host.appendChild(box);
    });
  }

  // ---------------------------------------------------------------- share codes
  const PREFIX = 'XH1:';
  function encodeCfg(c) { return PREFIX + btoa(JSON.stringify(c)); }
  function decodeCfg(text) {
    const t = String(text || '').trim().replace(/\s+/g, '');
    if (!t.startsWith(PREFIX)) throw new Error('That is not a crosshair code');
    let obj;
    try { obj = JSON.parse(atob(t.slice(PREFIX.length))); } catch (e) { throw new Error('That code is corrupted'); }
    return Crosshair.sanitize(obj);
  }

  function importFrom(text) {
    if (/^\s*CS/.test(String(text || '')) && !/^\s*XH1:/.test(String(text || ''))) return importCsCode(text);
    try {
      applyNewConfig(decodeCfg(text));
      toast('Crosshair imported');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- profiles
  function renderProfiles() {
    const list = $('#profileList');
    list.textContent = '';
    const names = Object.keys(state.profiles).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      list.appendChild(mk('div', { className: 'muted small', textContent: 'No saved crosshairs yet.' }));
      return;
    }
    names.forEach((n) => {
      const p = Crosshair.sanitize(state.profiles[n]);
      const row = mk('div', { className: 'prow' });
      const c = mk('canvas', { width: 48, height: 48 });
      const ext = Math.max(12, p.size + p.gap + p.outlineThickness + p.thickness);
      Crosshair.draw(c.getContext('2d'), p, Crosshair.newAnim(), 24, 24, Math.min(2, 20 / ext));
      row.appendChild(c);
      row.appendChild(mk('span', { className: 'pn', textContent: n, title: n }));
      const load = mk('button', { textContent: 'Load' });
      load.addEventListener('click', async () => {
        const loaded = await api.loadProfile(n);
        if (loaded) { applyNewConfig(loaded); toast('Loaded \u201c' + n + '\u201d'); }
      });
      const del = mk('button', { textContent: 'Delete', className: 'danger' });
      del.addEventListener('click', () => api.deleteProfile(n));
      row.appendChild(load);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    $('#overlayToggle').checked = state.overlayVisible;
    $('#hotkeyBtn').textContent = state.hotkey;
    $('#autoStart').checked = state.autoStart;
    $('#autoStart').disabled = !state.isPackaged;
    $('#autoStartNote').textContent = state.isPackaged ? '' : 'Available in the installed build (npm run dist).';
    $('#hookWarn').hidden = state.hookState !== 'unavailable';
    const pill = $('#pill');
    pill.textContent = 'Overlay ' + (state.overlayVisible ? 'ON' : 'OFF') + ' \u00b7 ' + state.hotkey;
    pill.classList.toggle('on', state.overlayVisible);
    const sel = $('#displaySel');
    sel.value = state.displayId === null ? '' : String(state.displayId);
  }

  async function refreshDisplays() {
    const list = await api.listDisplays();
    const sel = $('#displaySel');
    sel.textContent = '';
    sel.appendChild(mk('option', { value: '', textContent: 'Primary display' }));
    list.forEach((d) => sel.appendChild(mk('option', { value: String(d.id), textContent: d.label })));
    if (state) sel.value = state.displayId === null ? '' : String(state.displayId);
  }

  function toAccelerator(e) {
    const k0 = e.key;
    if (k0 === 'Control' || k0 === 'Shift' || k0 === 'Alt' || k0 === 'Meta') return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const map = {
      ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Escape: 'Esc', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
    };
    let k = map[k0] || (k0.length === 1 ? k0.toUpperCase() : k0);
    return mods.concat(k).join('+');
  }

  function wireHotkeyCapture() {
    const btn = $('#hotkeyBtn');
    let capturing = false;
    const stop = () => {
      capturing = false;
      document.removeEventListener('keydown', onKey, true);
    };
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stop();
        api.pauseHotkey(false);
        renderSettings();
        return;
      }
      const acc = toAccelerator(e);
      if (!acc) return;
      stop();
      api.setHotkey(acc).then((r) => {
        state.hotkey = r.hotkey;
        renderSettings();
        toast(r.ok ? 'Hotkey set to ' + r.hotkey : 'Could not use that shortcut (already taken?)');
      });
    }
    btn.addEventListener('click', () => {
      if (capturing) return;
      capturing = true;
      btn.textContent = 'Press a key\u2026 (Esc to cancel)';
      api.pauseHotkey(true);
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ---------------------------------------------------------------- pro crosshairs
  const PRO_OPTS_KEY = 'mishez.proOpts';
  const PRO_EDITS_KEY = 'mishez.proEdits';
  const COLOR_NAMES = ['red', 'green', 'yellow', 'blue', 'cyan', 'custom'];
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  let proOpts = { height: 1080, scale: 1 };
  let proEdits = {}; // name -> full crosshair config the user saved over that pro
  let editingPro = null;
  const proThumbs = [];

  function loadProOpts() {
    try {
      const o = JSON.parse(localStorage.getItem(PRO_OPTS_KEY) || '{}');
      const h = Number(o.height);
      const s = Number(o.scale);
      if (Number.isFinite(h) && h >= 480 && h <= 4320) proOpts.height = Math.round(h);
      if (Number.isFinite(s) && s >= 0.5 && s <= 2) proOpts.scale = s;
    } catch (e) { /* storage unavailable: keep defaults */ }
  }

  function saveProOpts() {
    try { localStorage.setItem(PRO_OPTS_KEY, JSON.stringify(proOpts)); } catch (e) { /* ignore */ }
  }

  function loadProEdits() {
    proEdits = {};
    try {
      const raw = JSON.parse(localStorage.getItem(PRO_EDITS_KEY) || '{}');
      (window.PROS || []).forEach((p) => {
        if (raw && hasOwn(raw, p.name)) proEdits[p.name] = Crosshair.sanitize(raw[p.name]);
      });
    } catch (e) { /* storage unavailable or corrupt: no edits */ }
  }

  function saveProEdits() {
    try { localStorage.setItem(PRO_EDITS_KEY, JSON.stringify(proEdits)); } catch (e) { /* ignore */ }
  }

  function codeToConfig(code) {
    const d = ShareCode.decode(code);
    const c = ShareCode.toConfig(d, {
      screenHeight: proOpts.height,
      scale: proOpts.scale,
      dpr: window.devicePixelRatio || 1
    });
    return { d: d, cfg: Crosshair.sanitize(c) };
  }

  // The crosshair a pro card stands for: the user's saved edit, or the decoded original.
  function proConfig(p) {
    if (hasOwn(proEdits, p.name)) return Crosshair.sanitize(proEdits[p.name]);
    return codeToConfig(p.code).cfg;
  }

  // Keeps the user's own animation and offset settings when a shared crosshair is applied.
  function applyShared(c, label) {
    const merged = Object.assign({}, c, {
      offsetX: cfg.offsetX,
      offsetY: cfg.offsetY,
      animation: cfg.animation,
      animIntensity: cfg.animIntensity,
      animDuration: cfg.animDuration
    });
    applyNewConfig(merged);
    toast(label);
  }

  function drawThumb(canvas, c) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const ext = Math.max(4, c.size + c.gap + c.outlineThickness + c.thickness);
    Crosshair.draw(g, c, Crosshair.newAnim(), canvas.width / 2, canvas.height / 2, Math.min(6, 28 / ext));
  }

  function proSummary(d) {
    const col = d.colorMode >= 0 && d.colorMode <= 5 ? COLOR_NAMES[d.colorMode] : 'custom';
    return 'Size ' + d.length + ' · Gap ' + d.gap + ' · Thick ' + d.thickness + ' · ' + col + (d.dot ? ' · dot' : '');
  }

  function renderProThumbs() {
    proThumbs.forEach((t) => {
      try { drawThumb(t.canvas, proConfig(t.pro)); } catch (e) { /* skip */ }
    });
  }

  // ---- edit mode
  function showTab(name) {
    const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (btn) btn.click();
  }

  function updateEditBar() {
    const bar = $('#editBar');
    bar.hidden = !editingPro;
    if (!editingPro) return;
    $('#editBarText').textContent = 'Editing ' + editingPro + '’s crosshair. Changes show on your overlay live; save them to this pro when you’re done.';
    $('#editSaveBtn').textContent = 'Save to ' + editingPro;
  }

  function startEdit(p) {
    let base;
    try { base = proConfig(p); } catch (e) { toast('Could not load that crosshair'); return; }
    editingPro = p.name;
    applyNewConfig(base);
    updateEditBar();
    showTab('crosshair');
  }

  function finishEdit() {
    if (!editingPro) return;
    const name = editingPro;
    proEdits[name] = Crosshair.sanitize(cfg);
    saveProEdits();
    editingPro = null;
    updateEditBar();
    renderPros();
    showTab('pros');
    toast('Saved your version of ' + name);
  }

  function cancelEdit() {
    editingPro = null;
    updateEditBar();
  }

  function resetPro(p) {
    delete proEdits[p.name];
    saveProEdits();
    renderPros();
    toast('Restored ' + p.name + '’s original crosshair');
  }

  function renderPros() {
    const grid = $('#proGrid');
    const q = $('#proSearch').value.trim().toLowerCase();
    grid.textContent = '';
    proThumbs.length = 0;
    const list = (window.PROS || []).filter((p) => !q || p.name.toLowerCase().indexOf(q) >= 0);
    $('#proCount').textContent = list.length + ' crosshair' + (list.length === 1 ? '' : 's');
    if (!list.length) {
      grid.appendChild(mk('div', { className: 'muted', textContent: 'No players match that search.' }));
      return;
    }
    list.forEach((p) => {
      let decoded;
      try { decoded = codeToConfig(p.code); } catch (e) { return; }
      const edited = hasOwn(proEdits, p.name);
      const card = mk('div', { className: 'pro-card' });
      const canvas = mk('canvas', { width: 72, height: 72 });
      drawThumb(canvas, edited ? proEdits[p.name] : decoded.cfg);
      proThumbs.push({ canvas: canvas, pro: p });
      const info = mk('div', { className: 'pi' });
      const nameEl = mk('div', { className: 'pname', title: p.name });
      nameEl.appendChild(document.createTextNode(p.name));
      if (edited) nameEl.appendChild(mk('span', { className: 'badge', textContent: 'edited', title: 'You saved your own version of this crosshair' }));
      info.appendChild(nameEl);
      info.appendChild(mk('div', {
        className: 'pmeta',
        textContent: edited ? 'Your version · original: ' + proSummary(decoded.d) : proSummary(decoded.d)
      }));
      const btns = mk('div', { className: 'pbtns' });
      const use = mk('button', { textContent: 'Use', className: 'primary' });
      use.addEventListener('click', () => {
        try { applyShared(proConfig(p), 'Applied ' + p.name + '’s crosshair'); } catch (e) { toast('Could not load that crosshair'); }
      });
      const edit = mk('button', { textContent: 'Edit', title: 'Open in the editor and save your own version' });
      edit.addEventListener('click', () => startEdit(p));
      const save = mk('button', { textContent: 'Save', title: 'Add to your saved crosshairs list' });
      save.addEventListener('click', async () => {
        try {
          const r = await api.saveProfile(p.name, proConfig(p));
          toast(r.ok ? 'Saved “' + p.name + '” to your list' : 'Could not save');
        } catch (e) { toast('Could not save'); }
      });
      btns.appendChild(use);
      btns.appendChild(edit);
      btns.appendChild(save);
      if (edited) {
        const reset = mk('button', { textContent: 'Reset', className: 'danger', title: 'Go back to the original crosshair' });
        reset.addEventListener('click', () => resetPro(p));
        btns.appendChild(reset);
      }
      info.appendChild(btns);
      card.appendChild(canvas);
      card.appendChild(info);
      grid.appendChild(card);
    });
  }

  function importCsCode(text) {
    try {
      const r = codeToConfig(text);
      applyShared(r.cfg, 'Crosshair imported');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  function initPros() {
    loadProOpts();
    loadProEdits();
    $('#proHeight').value = proOpts.height;
    $('#proScale').value = proOpts.scale;
    $('#proScaleOut').textContent = proOpts.scale.toFixed(2) + '×';
    $('#proSearch').addEventListener('input', renderPros);
    $('#proHeight').addEventListener('change', (e) => {
      const h = Math.round(Number(e.target.value));
      if (Number.isFinite(h) && h >= 480 && h <= 4320) { proOpts.height = h; saveProOpts(); renderProThumbs(); }
      else e.target.value = proOpts.height;
    });
    $('#proScale').addEventListener('input', (e) => {
      proOpts.scale = Number(e.target.value);
      $('#proScaleOut').textContent = proOpts.scale.toFixed(2) + '×';
      saveProOpts();
      renderProThumbs();
    });
    $('#csImportBtn').addEventListener('click', () => {
      if (importCsCode($('#csCode').value)) $('#csCode').value = '';
    });
    $('#csCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#csImportBtn').click();
    });
    $('#editSaveBtn').addEventListener('click', finishEdit);
    $('#editCancelBtn').addEventListener('click', cancelEdit);
    renderPros();
  }

  // ---------------------------------------------------------------- init
  async function init() {
    state = await api.getConfig();
    cfg = Crosshair.sanitize(state.crosshair);

    preview = Crosshair.createController($('#previewCanvas'), { size: 340, zoom: 2, useOffset: false });
    buildControls();
    applyToControls();
    preview.setConfig(cfg);
    updateZoom();

    $('#previewCanvas').addEventListener('mousedown', () => preview.input({ type: 'mousedown' }));

    document.querySelectorAll('.bgs button').forEach((b) => {
      b.addEventListener('click', () => { $('#previewWrap').className = 'preview bg-' + b.dataset.bg; });
    });

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        Trainer.abort();
        document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
        if (b.dataset.tab === 'settings') refreshDisplays();
      });
    });

    $('#exportBtn').addEventListener('click', async () => {
      await api.clipboardWrite(encodeCfg(cfg));
      toast('Crosshair code copied to clipboard');
    });
    $('#importBtn').addEventListener('click', () => {
      if (importFrom($('#importIn').value)) $('#importIn').value = '';
    });
    $('#pasteBtn').addEventListener('click', async () => {
      const text = await api.clipboardRead();
      $('#importIn').value = text;
      importFrom(text);
    });

    $('#saveProfileBtn').addEventListener('click', async () => {
      const name = $('#profileName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      const r = await api.saveProfile(name, cfg);
      if (r.ok) { toast('Saved \u201c' + name + '\u201d'); $('#profileName').value = ''; }
      else toast('That name is not allowed');
    });

    $('#overlayToggle').addEventListener('change', (e) => api.setOverlay(e.target.checked));
    $('#pill').addEventListener('click', () => api.setOverlay(!state.overlayVisible));
    $('#displaySel').addEventListener('change', (e) => api.setDisplay(e.target.value === '' ? null : Number(e.target.value)));
    $('#autoStart').addEventListener('change', (e) => api.setAutoStart(e.target.checked));
    $('#resetBtn').addEventListener('click', () => { applyNewConfig(null); toast('Crosshair reset'); });
    wireHotkeyCapture();

    renderProfiles();
    renderSettings();
    refreshDisplays();

    api.onState((s) => { state = s; renderProfiles(); renderSettings(); });
    api.onInput((e) => preview.input(e));

    initPros();
    Trainer.init(() => cfg);
  }

  init();
})();
