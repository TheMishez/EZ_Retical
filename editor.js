(function () {
  'use strict';

  const api = window.api;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const mk = (tag, props) => Object.assign(document.createElement(tag), props || {});

  let state = null;
  let design = Crosshair.sanitizeDesign(null);
  // While a state (aim, run...) is being edited, `design` is a view whose layers are that state's
  // layers and `stash` holds the rest. canon() always returns the full design to save or send.
  let editState = 'base';
  let stash = null;
  let styleClip = null;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function canon() {
    if (!stash) return design;
    const st = Object.assign({}, stash.states);
    st[editState] = { layers: design.layers };
    return Object.assign({}, design, { layers: stash.base, states: st });
  }
  function viewOf(root, id) {
    if (id === 'base' || Crosshair.STATE_IDS.indexOf(id) < 0) { stash = null; editState = 'base'; return root; }
    stash = { base: root.layers, states: root.states || {} };
    editState = id;
    const s = stash.states[id];
    const v = { layers: s ? clone(s.layers) : clone(root.layers) };
    if (root.dynamic) v.dynamic = root.dynamic;
    if (root.rules) v.rules = root.rules;
    return v;
  }
  let sel = 0;
  const cur = () => design.layers[sel];
  let triggers = Crosshair.sanitizeTriggers(null);
  let customizing = false;
  let drawMode = false;
  let symmetry = 'none';
  let previewZoom = 2;
  const groups = [];
  let preview = null;
  let pushTimer = 0;
  const rows = {};
  const extrasUI = { host: null };

  const TRIG_OPTS = Crosshair.TRIGGER_IDS.map((id) => [id, Crosshair.TRIGGER_LABELS[id]]);
  const ANIM_OPTS = Crosshair.ANIMS.map((id) => [id, Crosshair.ANIM_LABELS[id]]);
  const FONT_OPTS = Object.keys(Crosshair.FONTS).map((id) => [id, Crosshair.FONT_LABELS[id]]);
  const animOn = (l) => l.animation !== 'none';
  const HOLD_DEFAULT = { shoot: 'pulse', reload: 'pulse', jump: 'pulse', aim: 'hold', move: 'hold', run: 'hold' };

  // kinds: which layer types show the group/row; when: extra condition on the layer.
  const SCHEMA = [
    { title: 'Shape', kinds: ['shape'], items: [
      { key: 'style', type: 'shape', label: 'Shape' },
      { key: 'size', type: 'range', label: 'Size', min: 0, max: 60, step: 0.1, unit: 'px' },
      { key: 'gap', type: 'range', label: 'Gap', min: 0, max: 40, step: 0.1, unit: 'px' },
      { key: 'thickness', type: 'range', label: 'Thickness', min: 1, max: 12, step: 0.1, unit: 'px' },
      { key: 'tStyle', type: 'check', label: 'T-style (no top line)' },
      { key: 'rounded', type: 'range', label: 'Rounded edges', min: 0, max: 100, step: 5, unit: '%' }
    ] },
    { title: 'Image', kinds: ['image'], items: [
      { type: 'action', label: 'Image', text: 'Replace image…', fn: () => pickImage((img) => { cur().imgAspect = Math.min(20, Math.max(0.05, img.aspect)); update('src', img.src); }) },
      { key: 'imgSize', type: 'range', label: 'Size', min: 4, max: 400, step: 1, unit: 'px' },
      { key: 'tint', type: 'check', label: 'Tint with color' }
    ] },
    { title: 'Text', kinds: ['text'], items: [
      { key: 'text', type: 'text', label: 'Text' },
      { key: 'font', type: 'select', label: 'Font', options: FONT_OPTS },
      { key: 'fontSize', type: 'range', label: 'Font size', min: 6, max: 200, step: 1, unit: 'px' },
      { key: 'bold', type: 'check', label: 'Bold' }
    ] },
    { title: 'Drawing', kinds: ['draw'], items: [
      { type: 'drawtools', label: 'Tools' },
      { key: 'brush', type: 'range', label: 'Brush size', min: 1, max: 24, step: 1, unit: 'px' }
    ] },
    { title: 'Transform', items: [
      { key: 'rotation', type: 'range', label: 'Rotation', min: 0, max: 359, step: 1, unit: '°' },
      { key: 'flipX', type: 'check', label: 'Flip left/right' },
      { key: 'flipY', type: 'check', label: 'Flip up/down' },
      { key: 'offsetX', type: 'range', label: 'Offset X', min: -250, max: 250, step: 1, unit: 'px' },
      { key: 'offsetY', type: 'range', label: 'Offset Y', min: -250, max: 250, step: 1, unit: 'px' }
    ] },
    { title: 'Color', items: [
      { key: 'color', type: 'color', label: 'Color', swatches: ['#00ff66', '#00e5ff', '#ffee00', '#ff2bd6', '#ff3b3b', '#ffffff'], when: (l) => l.kind !== 'image' || l.tint },
      { key: 'opacity', type: 'range', label: 'Crosshair opacity', min: 0.1, max: 1, step: 0.05, pct: true }
    ] },
    { title: 'Outline', kinds: ['shape', 'text', 'draw'], items: [
      { key: 'outline', type: 'check', label: 'Outline' },
      { key: 'outlineColor', type: 'color', label: 'Outline color' },
      { key: 'outlineOpacity', type: 'range', label: 'Outline opacity', min: 0, max: 1, step: 0.05, pct: true },
      { key: 'outlineThickness', type: 'range', label: 'Outline width', min: 0, max: 6, step: 1, unit: 'px' }
    ] },
    { title: 'Center dot', kinds: ['shape'], items: [
      { key: 'dot', type: 'check', label: 'Center dot' },
      { key: 'dotSize', type: 'range', label: 'Dot size', min: 1, max: 12, step: 1, unit: 'px' }
    ] },
    { title: 'Effects', items: [
      { key: 'glow', type: 'range', label: 'Glow', min: 0, max: 30, step: 1, unit: 'px' },
      { key: 'blur', type: 'range', label: 'Blur', min: 0, max: 10, step: 1, unit: 'px' }
    ] },
    { title: 'Reactions', items: [
      { type: 'hint', text: 'Stack as many effects as you like: each has its own trigger.' },
      { key: 'animation', type: 'select', label: 'Effect', options: ANIM_OPTS },
      { type: 'pair', label: 'When', items: [
        { key: 'animTrigger', options: TRIG_OPTS },
        { key: 'animMode', options: [['pulse', 'Pulse on press'], ['hold', 'Hold while pressed']] }
      ], when: animOn },
      { key: 'animEase', type: 'select', label: 'Easing', options: Crosshair.EASES.map((id) => [id, Crosshair.EASE_LABELS[id]]), when: animOn },
      { key: 'animIntensity', type: 'range', label: 'Strength', min: 0, max: 30, step: 1, when: (l) => animOn(l) && ['fade', 'hide', 'show'].indexOf(l.animation) < 0 },
      { key: 'animDuration', type: 'range', label: 'Speed', min: 40, max: 600, step: 10, unit: 'ms', when: animOn },
      { type: 'extras', when: () => true },
      { key: 'reactMode', type: 'select', label: 'Spread', options: [
        ['follow', 'Follow crosshair settings'], ['custom', 'Custom for this layer'], ['off', 'Don\u2019t spread or recolor']
      ] },
      { type: 'grid', title: 'Gap change (px) while…', cells: [
        ['dynMove', 'Moving'], ['dynRun', 'Running'], ['dynShoot', 'Shooting'],
        ['dynJump', 'Jumping'], ['dynAim', 'Aiming'], ['dynReload', 'Reloading']
      ], when: (l) => l.dynOwn },
      { type: 'hint', text: 'Positive spreads the layer out, negative pulls it in.', when: (l) => l.dynOwn }
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
      api.setCrosshair(canon());
    }, 50);
  }

  const baseExtent = Crosshair.baseExtent;

  function layerExtent(l) {
    return baseExtent(l) + (l.kind === 'shape' ? Crosshair.animsOf(l).reduce((n, a) => n + a.animIntensity, 0) : 0);
  }

  function designExtent(d, noOffset) {
    let m = 24;
    d.layers.forEach((l) => {
      if (l.visible === false) return;
      m = Math.max(m, layerExtent(l) + (noOffset ? 0 : Math.hypot(l.offsetX, l.offsetY)));
    });
    return m;
  }

  function updateZoom() {
    const zoom = Math.max(0.5, Math.min(4, 150 / designExtent(design)));
    previewZoom = zoom;
    preview.setZoom(zoom);
    $('#zoomLabel').textContent = 'Zoom ×' + zoom.toFixed(1);
  }

  // ---- undo / redo
  let hist = [];
  let hi = -1;
  let commitTimer = 0;
  const snap = () => JSON.stringify({ d: canon(), sel: sel, es: editState });

  function updateUndoButtons() {
    $('#undoBtn').disabled = hi <= 0 && !commitTimer;
    $('#redoBtn').disabled = hi >= hist.length - 1;
  }

  function commitNow() {
    clearTimeout(commitTimer);
    commitTimer = 0;
    const s0 = snap();
    if (hist[hi] !== s0) {
      hist = hist.slice(0, hi + 1);
      hist.push(s0);
      if (hist.length > 100) hist.shift();
      hi = hist.length - 1;
    }
    updateUndoButtons();
  }

  function commitSoon() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitNow, 400);
    updateUndoButtons();
  }

  function restore(i) {
    const o = JSON.parse(hist[i]);
    hi = i;
    design = viewOf(Crosshair.sanitizeDesign(o.d), o.es || 'base');
    sel = Math.max(0, Math.min(design.layers.length - 1, o.sel | 0));
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    updateUndoButtons();
  }

  function undo() {
    if (commitTimer) commitNow();
    if (hi > 0) restore(hi - 1);
  }

  function redo() {
    if (commitTimer) commitNow();
    if (hi < hist.length - 1) restore(hi + 1);
  }

  function refreshAll() {
    preview.setConfig(design);
    if (homePrev) homePrev.setConfig(canon());
    updateZoom();
    api.setCrosshair(canon());
  }

  function update(key, val) {
    if (key === 'reactMode') {
      const l = cur();
      l.dynOwn = val === 'custom';
      l.dynamic = val !== 'off';
      refreshVisibility();
      preview.setConfig(design);
      updateZoom();
      pushSoon();
      commitSoon();
      return;
    }
    cur()[key] = val;
    if (key === 'animTrigger') {
      cur().animMode = HOLD_DEFAULT[val] || 'pulse';
      rows.animMode.set(cur().animMode);
    }
    if (key === 'tint' || key === 'animation') refreshVisibility();
    if (key === 'src') renderLayers();
    preview.setConfig(design);
    updateZoom();
    drawLayerThumb(sel);
    pushSoon();
    commitSoon();
  }


  // Extra animations: every layer can stack more effects on top of its first one.
  function extrasChanged() {
    preview.setConfig(design);
    updateZoom();
    drawLayerThumb(sel);
    pushSoon();
    commitSoon();
  }

  function renderExtras() {
    const host = extrasUI.host;
    if (!host) return;
    host.textContent = '';
    const l = cur();
    const list = l.anims || (l.anims = []);
    list.forEach((a, i) => {
      const card = mk('div', { className: 'xcard' });
      const head = mk('div', { className: 'xhead' });
      head.appendChild(mk('span', { textContent: 'Effect ' + (i + 2) }));
      const del = mk('button', { type: 'button', textContent: '\u2715', title: 'Remove this effect' });
      del.addEventListener('click', () => { list.splice(i, 1); if (!list.length) delete l.anims; renderExtras(); extrasChanged(); });
      head.appendChild(del);
      card.appendChild(head);
      const sel1 = mk('select');
      ANIM_OPTS.filter((o) => o[0] !== 'none').forEach((o) => sel1.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === a.animation })));
      sel1.addEventListener('change', () => { a.animation = sel1.value; renderExtras(); extrasChanged(); });
      const row1 = mk('div', { className: 'xrow' });
      row1.appendChild(sel1);
      card.appendChild(row1);
      const tsel = mk('select');
      TRIG_OPTS.forEach((o) => tsel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === a.animTrigger })));
      const msel = mk('select');
      [['pulse', 'Pulse on press'], ['hold', 'Hold while pressed']].forEach((o) => msel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === a.animMode })));
      tsel.addEventListener('change', () => { a.animTrigger = tsel.value; a.animMode = HOLD_DEFAULT[tsel.value] || 'pulse'; msel.value = a.animMode; extrasChanged(); });
      msel.addEventListener('change', () => { a.animMode = msel.value; extrasChanged(); });
      const row2 = mk('div', { className: 'xrow' });
      row2.appendChild(tsel);
      row2.appendChild(msel);
      card.appendChild(row2);
      const esel = mk('select');
      Crosshair.EASES.forEach((id) => esel.appendChild(mk('option', { value: id, textContent: Crosshair.EASE_LABELS[id], selected: id === a.animEase })));
      esel.addEventListener('change', () => { a.animEase = esel.value; extrasChanged(); });
      const mkNum = (key, min, max, step, label) => {
        const w = mk('label', { className: 'xnum' });
        w.appendChild(mk('span', { textContent: label }));
        const n = mk('input', { type: 'number', className: 'num', min: min, max: max, step: step, value: a[key] });
        const commit = () => {
          let v = Number(n.value);
          if (n.value === '' || !Number.isFinite(v)) v = a[key];
          v = Math.max(min, Math.min(max, v));
          n.value = v;
          a[key] = v;
          extrasChanged();
        };
        n.addEventListener('change', commit);
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
        w.appendChild(n);
        return w;
      };
      const row3 = mk('div', { className: 'xrow' });
      row3.appendChild(esel);
      card.appendChild(row3);
      const row4 = mk('div', { className: 'xrow' });
      if (['fade', 'hide', 'show'].indexOf(a.animation) < 0) row4.appendChild(mkNum('animIntensity', 0, 30, 1, 'Strength'));
      row4.appendChild(mkNum('animDuration', 40, 600, 10, 'Speed (ms)'));
      card.appendChild(row4);
      host.appendChild(card);
    });
    const add = mk('button', { type: 'button', className: 'xadd', textContent: '+ Add another effect' });
    add.addEventListener('click', () => {
      if (list.length >= Crosshair.MAX_EXTRA_ANIMS) { toast('Up to ' + (Crosshair.MAX_EXTRA_ANIMS + 1) + ' effects per layer'); return; }
      list.push({ animation: 'expand', animTrigger: 'move', animMode: 'hold', animEase: 'linear', animIntensity: 6, animDuration: 150 });
      renderExtras();
      extrasChanged();
    });
    host.appendChild(add);
  }

  function refreshVisibility() {
    const l = cur();
    groups.forEach((g) => {
      g.el.hidden = !!(g.def.kinds && g.def.kinds.indexOf(l.kind) < 0);
      g.rows.forEach((r) => {
        r.el.hidden = !!((r.def.kinds && r.def.kinds.indexOf(l.kind) < 0) || (r.def.when && !r.def.when(l)));
      });
    });
    if (drawMode && l.kind !== 'draw') setDrawMode(false);
  }

  function applyToControls() {
    Object.keys(rows).forEach((k) => { if (k !== 'reactMode') rows[k].set(cur()[k]); });
    const L = cur();
    rows.reactMode.set(L.dynOwn ? 'custom' : (L.dynamic === false ? 'off' : 'follow'));
    renderExtras();
    refreshVisibility();
    const t = $('#inspectorTitle');
    if (t) t.textContent = 'Layer: ' + cur().name;
    syncDynamics();
  }

  function applyNewConfig(c) {
    design = viewOf(Crosshair.sanitizeDesign(c), 'base');
    sel = 0;
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }


  // ---------------------------------------------------------------- dynamics + color rules (design level)
  const DYN_LABELS = {
    move: ['While moving', 'W A S D'], run: ['While running', 'Shift'], shoot: ['Per shot', 'kick'],
    jump: ['On jump', 'kick'], aim: ['While aiming', 'tighten < 0'], reload: ['On reload', 'kick']
  };
  const dynUI = { sliders: {} };

  function dynChanged() {
    preview.setConfig(design);
    if (homePrev) homePrev.setConfig(canon());
    updateZoom();
    pushSoon();
    commitSoon();
  }

  function dyn() {
    if (!design.dynamic) design.dynamic = Object.assign({}, Crosshair.DYN_DEFAULT);
    return design.dynamic;
  }

  function addDynRange(host, key, label, min, max, step, unit) {
    const row = mk('div', { className: 'row' });
    row.appendChild(mk('span', { className: 'name', textContent: label }));
    const ctl = mk('span', { className: 'ctl' });
    const input = mk('input', { type: 'range', min: min, max: max, step: step });
    const out = mk('output', { textContent: '' });
    const show = (v) => { out.textContent = v + unit; };
    input.addEventListener('input', () => { const v = Number(input.value); show(v); dyn()[key] = v; dynChanged(); });
    ctl.appendChild(input);
    ctl.appendChild(out);
    row.appendChild(ctl);
    host.appendChild(row);
    dynUI.sliders[key] = { set: (v) => { input.value = v; show(Number(v)); } };
  }

  function initDynamics() {
    const test = $('#dynTest');
    Crosshair.TRIGGER_IDS.forEach((id) => {
      const b = mk('button', { type: 'button', textContent: Crosshair.TRIGGER_LABELS[id], title: 'Hold to test' });
      const down = (e) => { e.preventDefault(); b.classList.add('on'); preview.input({ type: 'trigger', action: id, down: true }); };
      const up = () => { b.classList.remove('on'); preview.input({ type: 'trigger', action: id, down: false }); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      test.appendChild(b);
    });
    const body = $('#dynBody');
    const cells = mk('div', { className: 'cells' });
    Crosshair.DYN_KEYS.forEach((k) => {
      const cell = mk('label', { className: 'cell' });
      cell.appendChild(mk('span', { textContent: DYN_LABELS[k][0] }));
      const num = mk('input', { type: 'number', className: 'num', min: -30, max: 30, step: 0.5 });
      const commit = () => {
        let v = Number(num.value);
        if (num.value === '' || !Number.isFinite(v)) v = 0;
        v = Math.max(-30, Math.min(30, Math.round(v * 2) / 2));
        num.value = v;
        dyn()[k] = v;
        dynChanged();
      };
      num.addEventListener('change', commit);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
      cell.appendChild(num);
      cells.appendChild(cell);
      dynUI.sliders[k] = { set: (v) => { num.value = v; } };
    });
    body.appendChild(mk('div', { className: 'cellgrid-title', textContent: 'Gap change (px) while…' }));
    body.appendChild(cells);
    body.appendChild(mk('p', { className: 'hint', textContent: 'Positive spreads out, negative pulls in.' }));
    addDynRange(body, 'duration', 'Speed', 40, 600, 10, 'ms');
    const er = mk('div', { className: 'row' });
    er.appendChild(mk('span', { className: 'name', textContent: 'Curve' }));
    const ec = mk('span', { className: 'ctl' });
    const es = mk('select');
    Crosshair.EASES.forEach((id) => es.appendChild(mk('option', { value: id, textContent: Crosshair.EASE_LABELS[id] })));
    es.addEventListener('change', () => { dyn().ease = es.value; dynChanged(); });
    ec.appendChild(es);
    er.appendChild(ec);
    body.appendChild(er);
    dynUI.ease = es;
    $('#dynOn').addEventListener('change', () => { dyn().enabled = $('#dynOn').checked; body.hidden = !dyn().enabled; dynChanged(); });
    $('#addRuleBtn').addEventListener('click', () => {
      const rules = design.rules || (design.rules = []);
      if (rules.length >= Crosshair.MAX_RULES) { toast('Up to ' + Crosshair.MAX_RULES + ' rules'); return; }
      rules.push({ trigger: 'reload', color: '#ff3b3b', mode: 'hold', outline: false });
      renderRules();
      dynChanged();
    });
    syncDynamics();
  }

  function renderRules() {
    const host = $('#ruleList');
    host.textContent = '';
    (design.rules || []).forEach((r, i) => {
      const row = mk('div', { className: 'rule-row' });
      const tsel = mk('select', { title: 'When this is active' });
      TRIG_OPTS.forEach((o) => tsel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === r.trigger })));
      tsel.addEventListener('change', () => { r.trigger = tsel.value; dynChanged(); });
      const col = mk('input', { type: 'color', value: r.color, title: 'Blend toward this color' });
      col.addEventListener('input', () => { r.color = col.value; dynChanged(); });
      const msel = mk('select', { title: 'Hold: while pressed. Pulse: flash on press' });
      [['hold', 'While held'], ['pulse', 'Pulse']].forEach((o) => msel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === r.mode })));
      msel.addEventListener('change', () => { r.mode = msel.value; dynChanged(); });
      const ol = mk('input', { type: 'checkbox', checked: !!r.outline });
      ol.addEventListener('change', () => { r.outline = ol.checked; dynChanged(); });
      const olab = mk('label', {}); olab.appendChild(ol); olab.appendChild(document.createTextNode('Outline'));
      const del = mk('button', { type: 'button', textContent: '✕', title: 'Remove rule' });
      del.addEventListener('click', () => { design.rules.splice(i, 1); if (!design.rules.length) delete design.rules; renderRules(); dynChanged(); });
      [tsel, col, msel, olab, del].forEach((n) => row.appendChild(n));
      host.appendChild(row);
    });
  }

  function syncDynamics() {
    if (!dynUI.ease) return;
    const d = design.dynamic || Crosshair.DYN_DEFAULT;
    $('#dynOn').checked = !!d.enabled;
    $('#dynBody').hidden = !d.enabled;
    Object.keys(dynUI.sliders).forEach((k) => dynUI.sliders[k].set(d[k]));
    dynUI.ease.value = d.ease;
    renderRules();
  }


  // ---------------------------------------------------------------- states + layer tools
  const STATE_NAMES = { aim: 'While aiming', reload: 'While reloading', jump: 'While jumping', run: 'While running', move: 'While moving', shoot: 'While shooting' };
  const STYLE_KEYS = ['color', 'opacity', 'outline', 'outlineColor', 'outlineOpacity', 'outlineThickness', 'glow', 'blur', 'rounded',
    'animation', 'animTrigger', 'animMode', 'animEase', 'animIntensity', 'animDuration', 'dynamic', 'dynOwn', 'dynMove', 'dynRun', 'dynShoot', 'dynJump', 'dynAim', 'dynReload', 'anims'];

  function syncStates() {
    const sel_ = $('#stateSel');
    if (!sel_) return;
    const root = canon();
    sel_.textContent = '';
    sel_.appendChild(mk('option', { value: 'base', textContent: 'Normal crosshair' }));
    Crosshair.STATE_IDS.forEach((id) => {
      const has = !!(root.states && root.states[id]);
      sel_.appendChild(mk('option', { value: id, textContent: (has ? '• ' : '') + STATE_NAMES[id] }));
    });
    sel_.value = editState;
    $('#stateDel').hidden = editState === 'base';
    document.querySelector('.state-bar').classList.toggle('on', editState !== 'base');
    $('#stateHint').textContent = editState === 'base'
      ? 'Optional: pick a state to design a different crosshair that replaces this one while that action is held.'
      : 'Editing the crosshair shown ' + STATE_NAMES[editState].toLowerCase() + '. Switch back to “Normal crosshair” to edit the default.';
  }

  function switchState(id) {
    if (id === editState) return;
    if (commitTimer) commitNow();
    const root = canon();
    if (id !== 'base' && !(root.states && root.states[id])) {
      // First visit: start from a copy of the normal crosshair so there is something to tweak.
      root.states = Object.assign({}, root.states, { [id]: { layers: clone(root.layers) } });
    }
    design = viewOf(root, id);
    sel = 0;
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }

  function removeState() {
    if (editState === 'base') return;
    const root = canon();
    const st = Object.assign({}, root.states);
    delete st[editState];
    if (!Object.keys(st).length) delete root.states; else root.states = st;
    design = viewOf(root, 'base');
    sel = 0;
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
    toast('State removed');
  }

  function mirrorLayer(axis) {
    if (design.layers.length >= Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const c = clone(cur());
    c.name = (c.name + (axis === 'x' ? ' ↔' : ' ↕')).slice(0, 40);
    // Flips apply in the world frame (before rotation), so toggling the flag plus negating the offset mirrors any layer.
    if (axis === 'x') { c.offsetX = -c.offsetX; c.flipX = !c.flipX; } else { c.offsetY = -c.offsetY; c.flipY = !c.flipY; }
    design.layers.splice(sel + 1, 0, Crosshair.sanitize(c));
    sel += 1;
    layerChanged();
  }

  function initStates() {
    $('#stateSel').addEventListener('change', () => switchState($('#stateSel').value));
    $('#stateDel').addEventListener('click', removeState);
    $('#copyStyleBtn').addEventListener('click', () => {
      styleClip = {};
      STYLE_KEYS.forEach((k) => { styleClip[k] = cur()[k] === undefined ? undefined : clone(cur()[k]); });
      $('#pasteStyleBtn').disabled = false;
      toast('Style copied');
    });
    $('#pasteStyleBtn').addEventListener('click', () => {
      if (!styleClip) return;
      Object.assign(cur(), clone(styleClip));
      if (!cur().anims) delete cur().anims;
      applyToControls();
      layerChanged();
      toast('Style pasted');
    });
    $('#mirrorHBtn').addEventListener('click', () => mirrorLayer('x'));
    $('#mirrorVBtn').addEventListener('click', () => mirrorLayer('y'));
    syncStates();
  }

  // ---------------------------------------------------------------- layers
  function drawThumb(canvas, c) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const d = Crosshair.sanitizeDesign(c);
    let ext = 6;
    d.layers.forEach((l) => { if (l.visible !== false) ext = Math.max(ext, baseExtent(l)); });
    Crosshair.draw(g, d, Crosshair.newAnim(), canvas.width / 2, canvas.height / 2, Math.min(6, (canvas.width * 0.46) / ext), { noOffset: true });
  }

  function drawLayerThumb(i) {
    const row = $('#layerList').querySelector('[data-i="' + i + '"]');
    if (!row) return;
    drawThumb($('canvas', row), { layers: [Object.assign({}, design.layers[i], { visible: true })] });
  }

  function selectLayer(i) {
    sel = i;
    document.querySelectorAll('#layerList .layer-row').forEach((r) => r.classList.toggle('selected', Number(r.dataset.i) === i));
    applyToControls();
    commitSoon();
  }

  function renderLayers() {
    const list = $('#layerList');
    list.textContent = '';
    const n = design.layers.length;
    for (let i = n - 1; i >= 0; i--) {
      const l = design.layers[i];
      const row = mk('div', { className: 'layer-row' + (i === sel ? ' selected' : '') + (l.visible === false ? ' hidden-layer' : '') });
      row.dataset.i = String(i);
      const eye = mk('button', { type: 'button', className: 'eye', title: 'Show / hide', textContent: l.visible === false ? '○' : '●' });
      eye.addEventListener('click', (e) => { e.stopPropagation(); toggleLayer(i); });
      const thumb = mk('canvas', { className: 'layer-thumb', width: 64, height: 64 });
      const name = mk('input', { type: 'text', className: 'layer-name', value: l.name, readOnly: true, maxLength: 40, spellcheck: false });
      const finish = () => {
        if (name.readOnly) return;
        name.readOnly = true;
        design.layers[i].name = name.value.trim().slice(0, 40) || 'Layer';
        name.value = design.layers[i].name;
        if (i === sel) applyToControls();
        commitNow();
      };
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); name.readOnly = false; name.focus(); name.select(); });
      name.addEventListener('blur', finish);
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') name.blur();
        else if (e.key === 'Escape') { name.value = design.layers[i].name; name.blur(); }
        e.stopPropagation();
      });
      const btn = (txt, title, fn, dis) => {
        const b = mk('button', { type: 'button', textContent: txt, title: title, disabled: !!dis });
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        return b;
      };
      row.appendChild(eye);
      row.appendChild(thumb);
      row.appendChild(name);
      row.appendChild(btn('▲', 'Move up', () => moveLayer(i, 1), i === n - 1));
      row.appendChild(btn('▼', 'Move down', () => moveLayer(i, -1), i === 0));
      row.appendChild(btn('⧉', 'Duplicate', () => dupLayer(i)));
      row.appendChild(btn('✕', 'Delete', () => delLayer(i), n <= 1));
      row.addEventListener('click', () => { if (i !== sel) selectLayer(i); });
      list.appendChild(row);
      drawThumb(thumb, { layers: [Object.assign({}, l, { visible: true })] });
    }
    $('#addLayerBtn').disabled = n >= Crosshair.MAX_LAYERS;
  }

  function layerChanged() {
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }

  function addLayer(kind, extra) {
    if (design.layers.length >= Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const labels = { shape: 'Layer', image: 'Image', text: 'Text', draw: 'Drawing' };
    const n = design.layers.length + 1;
    const l = Crosshair.sanitize(Object.assign({ name: labels[kind] + ' ' + n, kind: kind, animation: 'none' }, extra || {}));
    if (kind === 'text') l.text = 'X';
    design.layers.push(l);
    sel = design.layers.length - 1;
    layerChanged();
    setDrawMode(kind === 'draw');
  }

  function addOfKind(kind) {
    $('#addMenu').hidden = true;
    if (kind === 'image') {
      pickImage((img) => addLayer('image', { src: img.src, name: img.name, imgSize: 20, imgAspect: img.aspect }));
    } else {
      addLayer(kind);
    }
  }

  function dupLayer(i) {
    if (design.layers.length >= Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const c = JSON.parse(JSON.stringify(design.layers[i]));
    c.name = (c.name + ' copy').slice(0, 40);
    design.layers.splice(i + 1, 0, c);
    sel = i + 1;
    layerChanged();
  }

  function delLayer(i) {
    if (design.layers.length <= 1) return;
    design.layers.splice(i, 1);
    sel = Math.max(0, Math.min(sel > i ? sel - 1 : sel, design.layers.length - 1));
    layerChanged();
  }

  function moveLayer(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= design.layers.length) return;
    const t = design.layers[i];
    design.layers[i] = design.layers[j];
    design.layers[j] = t;
    if (sel === i) sel = j; else if (sel === j) sel = i;
    layerChanged();
  }

  function toggleLayer(i) {
    design.layers[i].visible = design.layers[i].visible === false;
    layerChanged();
  }

  // ---------------------------------------------------------------- controls
  function buildControls() {
    const host = $('#controls');
    SCHEMA.forEach((g) => {
      const box = mk('section', { className: 'group' });
      const gh = mk('h3', { textContent: g.title });
      gh.addEventListener('click', () => box.classList.toggle('collapsed'));
      box.appendChild(gh);
      const grp = { el: box, def: g, rows: [] };
      groups.push(grp);
      g.items.forEach((it) => {
        if (it.type === 'hint') {
          const h = mk('p', { className: 'hint', textContent: it.text });
          grp.rows.push({ el: h, def: it });
          box.appendChild(h);
          return;
        }
        if (it.type === 'extras') {
          const wrap = mk('div', { className: 'extras' });
          grp.rows.push({ el: wrap, def: it });
          box.appendChild(wrap);
          extrasUI.host = wrap;
          return;
        }
        if (it.type === 'grid') {
          const wrap = mk('div', { className: 'cellgrid' });
          wrap.appendChild(mk('div', { className: 'cellgrid-title', textContent: it.title }));
          const cells = mk('div', { className: 'cells' });
          it.cells.forEach((c) => {
            const cell = mk('label', { className: 'cell' });
            cell.appendChild(mk('span', { textContent: c[1] }));
            const num = mk('input', { type: 'number', className: 'num', min: -30, max: 30, step: 0.5 });
            const commit = () => {
              let v = Number(num.value);
              if (num.value === '' || !Number.isFinite(v)) v = 0;
              v = Math.max(-30, Math.min(30, Math.round(v * 2) / 2));
              num.value = v;
              update(c[0], v);
            };
            num.addEventListener('change', commit);
            num.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
            cell.appendChild(num);
            cells.appendChild(cell);
            rows[c[0]] = { set: (v) => { num.value = v; } };
          });
          wrap.appendChild(cells);
          grp.rows.push({ el: wrap, def: it });
          box.appendChild(wrap);
          return;
        }
        const row = mk('div', { className: 'row' });
        row.appendChild(mk('span', { className: 'name', textContent: it.label }));
        const ctl = mk('span', { className: 'ctl' });
        row.appendChild(ctl);

        if (it.type === 'range') {
          const input = mk('input', { type: 'range', min: it.min, max: it.max, step: it.step });
          const k = it.pct ? 100 : 1;
          const num = mk('input', { type: 'number', className: 'num', min: it.min * k, max: it.max * k, step: it.step * k });
          const unit = mk('span', { className: 'unit', textContent: it.pct ? '%' : (it.unit || '') });
          const show = (v) => { num.value = it.pct ? Math.round(v * 100) : v; };
          input.addEventListener('input', () => {
            const v = Number(input.value);
            show(v);
            update(it.key, v);
          });
          const fromNum = () => {
            let v = Number(num.value);
            if (num.value === '' || !Number.isFinite(v)) { show(Number(input.value)); return; }
            v = Math.max(it.min, Math.min(it.max, v / k));
            v = Math.round(v / it.step) * it.step;
            v = Math.round(v * 1000) / 1000;
            input.value = v;
            show(v);
            update(it.key, v);
          };
          num.addEventListener('change', fromNum);
          num.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromNum(); e.stopPropagation(); });
          ctl.appendChild(input);
          ctl.appendChild(num);
          ctl.appendChild(unit);
          rows[it.key] = { set: (v) => { input.value = v; show(v); } };
        } else if (it.type === 'shape') {
          const btn = mk('button', { type: 'button', className: 'shape-btn' });
          const thumb = mk('canvas', { width: 72, height: 72 });
          const label = mk('span');
          btn.appendChild(thumb);
          btn.appendChild(label);
          btn.addEventListener('click', openShapePicker);
          ctl.appendChild(btn);
          rows[it.key] = { set: (v) => {
            label.textContent = (Crosshair.STYLE_LABELS[v] || v) + ' \u25be';
            drawShapeTile(thumb, v);
          } };
        } else if (it.type === 'text') {
          const inp = mk('input', { type: 'text', className: 'textin', maxLength: 24, spellcheck: false });
          inp.addEventListener('input', () => { update(it.key, inp.value); renderLayersSoon(); });
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          ctl.appendChild(inp);
          rows[it.key] = { set: (v) => { if (inp.value !== v) inp.value = v; } };
        } else if (it.type === 'action') {
          const b = mk('button', { type: 'button', textContent: it.text });
          b.addEventListener('click', it.fn);
          ctl.appendChild(b);
        } else if (it.type === 'drawtools') {
          buildDrawTools(ctl);
        } else if (it.type === 'pair') {
          it.items.forEach((p) => {
            const sel = mk('select');
            p.options.forEach((o) => sel.appendChild(mk('option', { value: o[0], textContent: o[1] })));
            sel.addEventListener('change', () => update(p.key, sel.value));
            ctl.appendChild(sel);
            rows[p.key] = { set: (v) => { sel.value = v; } };
          });
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
        grp.rows.push({ el: row, def: it });
        box.appendChild(row);
      });
      host.appendChild(box);
    });
  }

  // ---------------------------------------------------------------- shape picker
  const tileCache = {};

  // Draws a shape big on a scratch canvas, crops to its bounds and scales it to fit the tile.
  function drawShapeTile(canvas, id) {
    const S = 360;
    const key = id + '|' + canvas.width;
    let img = tileCache[key];
    if (!img) {
      const off = document.createElement('canvas');
      off.width = S; off.height = S;
      const g = off.getContext('2d');
      const demo = Crosshair.sanitize({
        style: id, color: '#ffffff', size: 10, gap: 3, thickness: 3, outline: true, outlineColor: '#000000',
        outlineThickness: 1, dot: false, tStyle: false, rotation: 0, opacity: 1
      });
      Crosshair.draw(g, demo, Crosshair.newAnim(), S / 2, S / 2, 4);
      const d = g.getImageData(0, 0, S, S).data;
      let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (d[(y * S + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      img = x1 < 0 ? null : { off: off, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      tileCache[key] = img;
    }
    const t = canvas.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const box = canvas.width * 0.78;
    const k = Math.min(box / img.w, box / img.h);
    const w = img.w * k, h = img.h * k;
    t.imageSmoothingQuality = 'high';
    t.drawImage(img.off, img.x, img.y, img.w, img.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  let shapeBuilt = false;
  function buildShapePicker() {
    if (shapeBuilt) return;
    shapeBuilt = true;
    const host = $('#shapeGroups');
    Crosshair.SHAPE_GROUPS.forEach((grp) => {
      const sec = mk('section', { className: 'shape-group' });
      sec.appendChild(mk('h4', { textContent: grp.title }));
      const grid = mk('div', { className: 'shape-grid' });
      grp.items.forEach((it) => {
        const tile = mk('button', { type: 'button', className: 'shape-tile', title: it[1] });
        tile.dataset.shape = it[0];
        const cv = mk('canvas', { width: 128, height: 128 });
        drawShapeTile(cv, it[0]);
        tile.appendChild(cv);
        tile.appendChild(mk('span', { textContent: it[1] }));
        tile.addEventListener('click', () => {
          update('style', it[0]);
          rows.style.set(it[0]);
          closeShapePicker();
        });
        grid.appendChild(tile);
      });
      sec.appendChild(grid);
      host.appendChild(sec);
    });
  }

  function openShapePicker() {
    buildShapePicker();
    document.querySelectorAll('.shape-tile').forEach((t) => t.classList.toggle('selected', t.dataset.shape === cur().style));
    $('#shapeModal').hidden = false;
    const sel = document.querySelector('.shape-tile.selected');
    if (sel) sel.scrollIntoView({ block: 'center' });
  }

  function closeShapePicker() {
    $('#shapeModal').hidden = true;
  }

  // ---------------------------------------------------------------- images, drawing, triggers
  let layersTimer = 0;
  function renderLayersSoon() {
    clearTimeout(layersTimer);
    layersTimer = setTimeout(renderLayers, 250);
  }

  // Reads an image file, shrinks it to at most 256px and returns a PNG data URL.
  function pickImage(cb) {
    const input = $('#imgFile');
    input.value = '';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onerror = () => toast('Could not read that image');
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const w0 = img.naturalWidth || 256;
          const h0 = img.naturalHeight || 256;
          // Animated formats keep their original bytes so the frames survive.
          if (/^data:image\/(gif|webp);base64,/.test(rd.result)) {
            if (rd.result.length <= 650000) {
              cb({ src: rd.result, aspect: h0 / w0, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image' });
              return;
            }
            if (/^data:image\/gif/.test(rd.result)) { toast('That GIF is too large (limit about 480 KB). Try fewer frames or a smaller size.'); return; }
          }
          let max = 256;
          let data = '';
          for (let tries = 0; tries < 4; tries++) {
            const k = Math.min(1, max / Math.max(w0, h0));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w0 * k));
            c.height = Math.max(1, Math.round(h0 * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            data = c.toDataURL('image/png');
            if (data.length <= 650000) break;
            max = Math.round(max * 0.6);
          }
          if (data.length > 650000) { toast('That image is too detailed. Try a smaller one.'); return; }
          cb({ src: data, aspect: h0 / w0, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image' });
        };
        img.onerror = () => toast('Could not read that image');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    input.click();
  }

  function setDrawMode(on) {
    drawMode = !!on && cur().kind === 'draw';
    $('#previewCanvas').classList.toggle('drawing', drawMode);
    const b = $('#drawToggle');
    if (b) { b.classList.toggle('active', drawMode); b.textContent = drawMode ? 'Drawing… (click to stop)' : 'Draw on preview'; }
    const hint = $('#drawHint');
    if (hint) hint.hidden = !drawMode;
  }

  function buildDrawTools(ctl) {
    const wrap = mk('div');
    const bar = mk('div', { className: 'draw-tools' });
    const tog = mk('button', { type: 'button', id: 'drawToggle', textContent: 'Draw on preview' });
    tog.addEventListener('click', () => setDrawMode(!drawMode));
    const undo = mk('button', { type: 'button', id: 'strokeUndo', textContent: 'Undo stroke' });
    undo.addEventListener('click', () => {
      const l = cur();
      if (l.kind !== 'draw' || !l.strokes.length) return;
      const n = Math.max(1, lastStrokeGroup);
      l.strokes.splice(Math.max(0, l.strokes.length - n), n);
      lastStrokeGroup = 1;
      strokesChanged();
    });
    const clr = mk('button', { type: 'button', id: 'strokeClear', textContent: 'Clear' });
    clr.addEventListener('click', () => { cur().strokes = []; strokesChanged(); });
    const sym = mk('select', { id: 'symSel' });
    [['none', 'No mirror'], ['x', 'Mirror left/right'], ['y', 'Mirror up/down'], ['xy', 'Mirror all 4']].forEach((o) => sym.appendChild(mk('option', { value: o[0], textContent: o[1] })));
    sym.addEventListener('change', () => { symmetry = sym.value; });
    bar.appendChild(tog);
    bar.appendChild(undo);
    bar.appendChild(clr);
    bar.appendChild(sym);
    wrap.appendChild(bar);
    wrap.appendChild(mk('div', { id: 'drawHint', className: 'draw-hint', hidden: true, textContent: 'Click and drag on the preview. Use a mirror option for a symmetric crosshair.' }));
    ctl.appendChild(wrap);
  }

  let lastStrokeGroup = 1;
  function strokesChanged() {
    preview.setConfig(design);
    updateZoom();
    drawLayerThumb(sel);
    pushSoon();
    commitNow();
  }

  function wirePreviewPointer() {
    const cv = $('#previewCanvas');
    let live = null; // arrays being filled for the current stroke (one per mirror)
    const toLayer = (e) => {
      const r = cv.getBoundingClientRect();
      const l = cur();
      let x = ((e.clientX - r.left) * (cv.offsetWidth / r.width) - cv.offsetWidth / 2) / previewZoom - l.offsetX;
      let y = ((e.clientY - r.top) * (cv.offsetHeight / r.height) - cv.offsetHeight / 2) / previewZoom - l.offsetY;
      const a = (-l.rotation * Math.PI) / 180;
      return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    };
    const mirrors = () => {
      const m = [[1, 1]];
      if (symmetry === 'x' || symmetry === 'xy') m.push([-1, 1]);
      if (symmetry === 'y' || symmetry === 'xy') m.push([1, -1]);
      if (symmetry === 'xy') m.push([-1, -1]);
      return m;
    };
    cv.addEventListener('pointerdown', (e) => {
      if (drawMode && cur().kind === 'draw') {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        const p = toLayer(e);
        const ms = mirrors();
        live = ms.map((m) => [[p[0] * m[0], p[1] * m[1]]]);
        live.forEach((st) => cur().strokes.push(st));
        live.ms = ms;
        preview.setConfig(design);
        return;
      }
      preview.input({ type: 'trigger', action: 'shoot', down: true });
    });
    cv.addEventListener('pointermove', (e) => {
      if (!live) return;
      const p = toLayer(e);
      let moved = false;
      live.forEach((st, i) => {
        const m = live.ms[i];
        const q = [p[0] * m[0], p[1] * m[1]];
        const last = st[st.length - 1];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 0.8 && st.length < 600) { st.push(q); moved = true; }
      });
      if (moved) preview.setConfig(design);
    });
    const end = () => {
      if (live) {
        lastStrokeGroup = live.length;
        live = null;
        strokesChanged();
      }
      preview.input({ type: 'trigger', action: 'shoot', down: false });
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // ---- triggers
  function triggerLabel(n) {
    return n.replace(/^Mouse(\d)$/, (m, d) => 'Mouse ' + d);
  }

  function renderTriggers() {
    const host = $('#triggerList');
    host.textContent = '';
    Crosshair.TRIGGER_IDS.forEach((id) => {
      const row = mk('div', { className: 'trig-row' });
      const name = mk('button', { type: 'button', className: 'trig-name', textContent: Crosshair.TRIGGER_LABELS[id], title: 'Hold to preview' });
      const down = (e) => { e.preventDefault(); name.classList.add('on'); preview.input({ type: 'trigger', action: id, down: true }); };
      const up = () => { name.classList.remove('on'); preview.input({ type: 'trigger', action: id, down: false }); };
      name.addEventListener('pointerdown', down);
      name.addEventListener('pointerup', up);
      name.addEventListener('pointerleave', up);
      const keys = mk('span', { className: 'trig-keys' });
      triggers[id].forEach((n, i) => {
        if (i > 0) keys.appendChild(mk('i', { textContent: '/' }));
        const chip = mk('button', { type: 'button', className: 'chip' + (customizing ? ' editable' : ''), textContent: triggerLabel(n), disabled: !customizing });
        chip.dataset.action = id;
        chip.dataset.slot = String(i);
        chip.addEventListener('click', () => captureTrigger(id, i, chip));
        keys.appendChild(chip);
      });
      row.appendChild(name);
      row.appendChild(keys);
      host.appendChild(row);
    });
    $('#trigCustomize').textContent = customizing ? 'Done' : 'Customize';
    $('#trigReset').hidden = !customizing;
    $('#trigHint').textContent = customizing
      ? 'Click a key, then press the key or mouse button you want. Esc cancels.'
      : 'Inputs that drive your crosshair animations. Press and hold an action name to preview it.';
  }

  function saveTriggers() {
    triggers = Crosshair.sanitizeTriggers(triggers);
    api.setTriggers(triggers);
  }

  function captureTrigger(id, i, chip) {
    chip.textContent = 'Press…';
    chip.classList.add('capturing');
    let armed = false;
    let finished = false;
    const done = (name) => {
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('contextmenu', onCtx, true);
      if (name) { triggers[id][i] = name; saveTriggers(); }
      renderTriggers();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { done(null); return; }
      if (e.repeat) return;
      done(Crosshair.domKeyName(e));
    };
    const onMouse = (e) => {
      if (!armed) return;
      e.preventDefault();
      e.stopPropagation();
      done(Crosshair.domMouseName(e.button));
    };
    const onCtx = (e) => e.preventDefault();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onCtx, true);
    setTimeout(() => { if (finished) return; armed = true; document.addEventListener('mousedown', onMouse, true); }, 0);
  }

  // ---------------------------------------------------------------- presets, backgrounds, backup, nudge
  function renderPresets() {
    const host = $('#presetGrid');
    host.textContent = '';
    (window.PRESETS || []).forEach((p) => {
      const d = Crosshair.sanitizeDesign({ layers: p.layers, dynamic: p.dynamic, rules: p.rules });
      const b = mk('button', { type: 'button', className: 'preset', title: 'Use ' + p.name });
      const c = mk('canvas', { width: 112, height: 112 });
      drawThumb(c, d);
      b.appendChild(c);
      b.appendChild(mk('span', { textContent: p.name }));
      b.addEventListener('click', () => { applyNewConfig(d); setCurName(p.name); toast('Loaded preset “' + p.name + '”'); });
      host.appendChild(b);
    });
  }

  // Lets you judge the crosshair on your own game screenshot.
  const BG_KEY = 'mishez.previewBg';
  function setPreviewBg(url) {
    const w = $('#previewWrap');
    w.className = 'preview bg-image';
    w.style.backgroundImage = 'url("' + url + '")';
  }

  function initPreviewBg() {
    try {
      const saved = localStorage.getItem(BG_KEY);
      if (saved && /^data:image\//.test(saved)) setPreviewBg(saved);
    } catch (e) { /* storage unavailable */ }
    $('#bgImgBtn').addEventListener('click', () => $('#bgFile').click());
    $('#bgFile').addEventListener('change', () => {
      const f = $('#bgFile').files && $('#bgFile').files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 700 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.82);
          setPreviewBg(url);
          try { localStorage.setItem(BG_KEY, url); } catch (e) { /* too big or blocked */ }
        };
        img.onerror = () => toast('Could not read that image');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
      $('#bgFile').value = '';
    });
  }

  function initBackup() {
    $('#backupBtn').addEventListener('click', async () => {
      const r = await api.exportBackup();
      if (r && r.ok) toast('Backup saved');
      else if (r && r.error) toast(r.error);
    });
    $('#restoreBtn').addEventListener('click', async () => {
      const r = await api.importBackup();
      if (r && r.ok) { toast('Backup restored'); } else if (r && r.error) toast(r.error);
    });
  }

  // Arrow keys nudge the selected layer by 1px (Shift = 10px) for pixel-perfect placement.
  function initNudge() {
    document.addEventListener('keydown', (e) => {
      if (!$('#tab-crosshair').classList.contains('active') || !$('#shapeModal').hidden || drawMode) return;
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'button'))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const d = e.shiftKey ? 10 : 1;
      const m = { ArrowLeft: ['offsetX', -d], ArrowRight: ['offsetX', d], ArrowUp: ['offsetY', -d], ArrowDown: ['offsetY', d] }[e.key];
      if (!m) return;
      e.preventDefault();
      const v = Math.max(-250, Math.min(250, cur()[m[0]] + m[1]));
      update(m[0], v);
      rows[m[0]].set(v);
    });
  }

  // ---------------------------------------------------------------- share codes
  const PREFIX = 'XH1:';
  function encodeCfg(c) { return PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(c)))); }
  function decodeCfg(text) {
    const t = String(text || '').trim().replace(/\s+/g, '');
    if (!t.startsWith(PREFIX)) throw new Error('That is not a crosshair code');
    let obj;
    try { obj = JSON.parse(decodeURIComponent(escape(atob(t.slice(PREFIX.length))))); } catch (e) { throw new Error('That code is corrupted'); }
    return Crosshair.sanitizeDesign(obj);
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
      const p = Crosshair.sanitizeDesign(state.profiles[n]);
      const row = mk('div', { className: 'prow' });
      const c = mk('canvas', { width: 48, height: 48 });
      drawThumb(c, p);
      row.appendChild(c);
      row.appendChild(mk('span', { className: 'pn', textContent: n, title: n }));
      const load = mk('button', { textContent: 'Load' });
      load.addEventListener('click', async () => {
        const loaded = await api.loadProfile(n);
        if (loaded) { applyNewConfig(loaded); setCurName(n); toast('Loaded \u201c' + n + '\u201d'); }
      });
      const del = mk('button', { textContent: 'Delete', className: 'danger' });
      del.addEventListener('click', () => api.deleteProfile(n));
      row.appendChild(load);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- home
  let homePrev = null;
  let curName = '';

  function setCurName(n) {
    curName = n || '';
    renderHome();
  }

  function renderHome() {
    if (!state || !$('#homeTitle')) return;
    const on = !!state.overlayVisible;
    $('#homeDot').classList.toggle('on', on);
    $('#homeState').textContent = on ? 'RUNNING' : 'READY';
    $('#homeTitle').textContent = on ? 'Overlay is running' : 'Ready to play';
    $('#homeToggle').textContent = on ? 'Stop overlay' : 'Start overlay';
    $('#homeToggle').classList.toggle('primary', !on);
    $('#homeSub').textContent = (curName || 'Your crosshair') + ' equipped \u00b7 ' +
      (state.displayMode === 'fullscreen' ? 'Fullscreen games mode' : 'Simple overlay mode') + ' \u00b7 ' + state.hotkey + ' toggles';
    $('#homeName').textContent = curName || 'Current crosshair';
  }

  function renderHomeGrid() {
    const host = $('#homeGrid');
    if (!host) return;
    host.textContent = '';
    const names = Object.keys(state.profiles || {}).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      host.appendChild(mk('div', { className: 'tile-empty', textContent: 'Nothing saved yet. Save a crosshair from the Designer and it shows up here.' }));
      return;
    }
    names.forEach((n) => {
      const d = Crosshair.sanitizeDesign(state.profiles[n]);
      const b = mk('button', { type: 'button', className: 'preset', title: 'Equip ' + n });
      const c = mk('canvas', { width: 112, height: 112 });
      drawThumb(c, d);
      b.appendChild(c);
      b.appendChild(mk('span', { textContent: n }));
      b.addEventListener('click', async () => {
        const loaded = await api.loadProfile(n);
        if (loaded) { applyNewConfig(loaded); setCurName(n); toast('Equipped \u201c' + n + '\u201d'); }
      });
      host.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- settings
  const ACCENTS = [['#3ddc84', 'Green'], ['#fcc800', 'Logo yellow'], ['#00e5ff', 'Cyan'], ['#4d9fff', 'Blue'], ['#b57bff', 'Purple'], ['#ff2bd6', 'Pink'], ['#ff5c6c', 'Red'], ['#ff9f1a', 'Orange'], ['#ffffff', 'White']];

  // Sets the app's accent color (CSS variables) and picks readable text for filled buttons.
  function applyAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#3ddc84';
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);
    root.setProperty('--on-accent', lum > 0.55 ? '#10130f' : '#ffffff');
    const sw = $('#accentSwatches');
    if (sw) {
      sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.c === hex.toLowerCase()));
      $('#accentPick').value = hex;
    }
  }

  function initAccent() {
    const sw = $('#accentSwatches');
    ACCENTS.forEach(([c, name]) => {
      const b = mk('button', { type: 'button', title: name });
      b.dataset.c = c;
      b.style.background = c;
      b.addEventListener('click', () => api.setSettings({ accentColor: c }));
      sw.appendChild(b);
    });
    $('#accentPick').addEventListener('input', (e) => { applyAccent(e.target.value); });
    $('#accentPick').addEventListener('change', (e) => api.setSettings({ accentColor: e.target.value }));
    $('#accentReset').addEventListener('click', () => api.setSettings({ accentColor: '#3ddc84' }));
    applyAccent(state.accentColor);
  }

  function renderSettings() {
    applyAccent(state.accentColor);
    $('#overlayToggle').checked = state.overlayVisible;
    $('#hotkeyBtn').textContent = state.hotkey;
    $('#hotkeyNextBtn').textContent = state.hotkeyNext;
    $('#hotkeyPrevBtn').textContent = state.hotkeyPrev;
    $('#startHidden').checked = !!state.startHidden;
    $('#lowPriority').checked = state.lowPriority !== false;
    $('#fpsSel').value = String(state.fpsCap === undefined ? 60 : state.fpsCap);
    if ($('#memSel')) {
      $('#memSel').value = state.memoryMode || 'low';
      const pending = (state.memoryMode || 'low') !== (state.memoryActive || 'low');
      $('#memRestart').hidden = !pending;
      $('#memNote').textContent = pending ? 'Restart the app to apply this.' :
        ({ balanced: 'Default Chromium settings.', low: 'Smaller caches and heaps. No visible difference.', lowest: 'Also draws in software and removes the GPU process (biggest saving). Fine for a small crosshair; switch back if anything looks off.' })[state.memoryMode || 'low'];
    }
    if (scaleCtl) { scaleCtl.set(state.overlayScale); opacityCtl.set(state.overlayOpacity); }
    if (offXCtl) { offXCtl.set(state.overlayOffsetX || 0); offYCtl.set(state.overlayOffsetY || 0); }
    $('#guideBtn').textContent = state.guide ? 'Hide alignment guide' : 'Show alignment guide (15 s)';
    renderGames();
    $('#autoStart').checked = state.autoStart;
    $('#autoStart').disabled = !state.isPackaged;
    $('#autoStartNote').textContent = state.isPackaged ? '' : 'Available in the installed build (npm run dist).';
    $('#hookWarn').hidden = state.hookState !== 'unavailable';
    const pill = $('#pill');
    pill.textContent = 'Overlay ' + (state.overlayVisible ? 'ON' : 'OFF') + ' \u00b7 ' + state.hotkey;
    pill.classList.toggle('on', state.overlayVisible);
    renderHome();
    const dsel = $('#displaySel');
    dsel.value = state.displayId === null ? '' : String(state.displayId);
    document.querySelectorAll('.mode-card').forEach((b) => b.classList.toggle('selected', b.dataset.mode === state.displayMode));
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
    document.querySelectorAll('.hk').forEach((btn) => {
      const which = btn.dataset.which;
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
        api.setHotkey(acc, which).then((r) => {
          state.hotkey = r.hotkeys.toggle;
          state.hotkeyNext = r.hotkeys.next;
          state.hotkeyPrev = r.hotkeys.prev;
          renderSettings();
          toast(r.ok ? 'Hotkey set to ' + acc : 'Could not use that shortcut (already taken?)');
        });
      }
      btn.addEventListener('click', () => {
        if (capturing) return;
        capturing = true;
        btn.textContent = 'Press a key\u2026 (Esc to cancel)';
        api.pauseHotkey(true);
        document.addEventListener('keydown', onKey, true);
      });
    });
  }

  // A slider with a typed number box, used by the settings cards.
  function makeSetting(host, o) {
    const row = mk('div', { className: 'row' });
    row.appendChild(mk('span', { className: 'name', textContent: o.label }));
    const ctl = mk('span', { className: 'ctl' });
    const range = mk('input', { type: 'range', min: o.min, max: o.max, step: o.step });
    const num = mk('input', { type: 'number', className: 'num', min: o.min * o.k, max: o.max * o.k, step: o.step * o.k });
    ctl.appendChild(range);
    ctl.appendChild(num);
    ctl.appendChild(mk('span', { className: 'unit', textContent: o.unit }));
    row.appendChild(ctl);
    host.appendChild(row);
    const set = (v) => { range.value = v; num.value = Math.round(v * o.k); };
    range.addEventListener('input', () => { num.value = Math.round(Number(range.value) * o.k); o.onChange(Number(range.value)); });
    const fromNum = () => {
      let v = Number(num.value);
      if (num.value === '' || !Number.isFinite(v)) { set(Number(range.value)); return; }
      v = Math.min(o.max, Math.max(o.min, v / o.k));
      set(v);
      o.onChange(v);
    };
    num.addEventListener('change', fromNum);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromNum(); e.stopPropagation(); });
    return { set: set };
  }

  let scaleCtl = null;
  let opacityCtl = null;
  let offXCtl = null;
  let offYCtl = null;

  function renderGames() {
    if (!$('#gameList')) return;
    $('#autoSwitch').checked = !!state.autoSwitch;
    $('#autoRevert').checked = state.autoRevert !== false;
    $('#followWindow').checked = !!state.followWindow;
    const games = state.gameProfiles || {};
    const profNames = Object.keys(state.profiles || {}).sort((a, b) => a.localeCompare(b));
    const list = $('#gameList');
    list.textContent = '';
    Object.keys(games).sort().forEach((exe) => {
      const row = mk('div', { className: 'grow' });
      row.appendChild(mk('b', { textContent: exe }));
      const sel = mk('select');
      const names = profNames.indexOf(games[exe]) >= 0 ? profNames : profNames.concat([games[exe]]);
      names.forEach((n) => sel.appendChild(mk('option', { value: n, textContent: n })));
      sel.value = games[exe];
      sel.addEventListener('change', () => api.setGames({ gameProfiles: Object.assign({}, games, { [exe]: sel.value }) }));
      row.appendChild(sel);
      const del = mk('button', { type: 'button', textContent: 'Remove' });
      del.addEventListener('click', () => {
        const next = Object.assign({}, games);
        delete next[exe];
        api.setGames({ gameProfiles: next });
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    const gp = $('#gameProf');
    const keep = gp.value;
    gp.textContent = '';
    profNames.forEach((n) => gp.appendChild(mk('option', { value: n, textContent: n })));
    if (keep && profNames.indexOf(keep) >= 0) gp.value = keep;
    $('#gameAdd').disabled = !profNames.length;
    $('#gameNote').textContent = profNames.length
      ? (state.watcherOn ? 'Watching the active window.' : '')
      : 'Save at least one crosshair first (Crosshair tab, Saved crosshairs), then pick it here.';
  }

  function initGames() {
    const set = (p) => api.setGames(p);
    $('#autoSwitch').addEventListener('change', (e) => set({ autoSwitch: e.target.checked }));
    $('#autoRevert').addEventListener('change', (e) => set({ autoRevert: e.target.checked }));
    $('#followWindow').addEventListener('change', (e) => set({ followWindow: e.target.checked }));
    $('#gameAdd').addEventListener('click', () => {
      const exe = $('#gameExe').value.trim().toLowerCase().replace(/\.exe$/, '');
      const prof = $('#gameProf').value;
      if (!exe || !prof) { toast('Type the game\u2019s process name and pick a crosshair'); return; }
      set({ gameProfiles: Object.assign({}, state.gameProfiles || {}, { [exe]: prof }) });
      $('#gameExe').value = '';
    });
    $('#gameExe').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('#gameAdd').click(); });
    $('#gamePick').addEventListener('click', async () => {
      const sel = $('#gamePickSel');
      const procs = await api.listProcs();
      sel.textContent = '';
      sel.appendChild(mk('option', { value: '', textContent: procs.length ? 'Choose an app\u2026' : 'None found (Windows only)' }));
      procs.forEach((n) => sel.appendChild(mk('option', { value: n, textContent: n })));
      sel.hidden = false;
    });
    $('#gamePickSel').addEventListener('change', (e) => {
      if (e.target.value) $('#gameExe').value = e.target.value;
      e.target.hidden = true;
    });
  }

  function initAlignment() {
    const mkOff = (host, label, key) => makeSetting(host, {
      label: label, min: -100, max: 100, step: 1, k: 1, unit: 'px',
      onChange: (v) => api.setSettings({ [key]: Math.round(v) })
    });
    offXCtl = mkOff($('#offXHost'), 'Horizontal offset', 'overlayOffsetX');
    offYCtl = mkOff($('#offYHost'), 'Vertical offset', 'overlayOffsetY');
    offXCtl.set(state.overlayOffsetX || 0);
    offYCtl.set(state.overlayOffsetY || 0);
    $('#offReset').addEventListener('click', () => api.setSettings({ overlayOffsetX: 0, overlayOffsetY: 0 }));
    $('#guideBtn').addEventListener('click', () => api.setGuide(!state.guide));
  }

  async function pollAlign() {
    try {
      const d = await api.getDiag();
      if (!d) return;
      const off = (n) => (n === null || n === undefined ? '?' : (Math.abs(n) < 0.01 ? '0' : n.toFixed(1)));
      $('#alignDiag').textContent = 'Display ' + d.physical + ' px at ' + Math.round(d.scale * 100) + '% scaling' +
        (d.following ? ', following the game window' : '') + '. Centre error: ' + off(d.errorX) + ' px across, ' + off(d.errorY) + ' px down.';
    } catch (e) { /* ignore */ }
  }
  let perfTimer = 0;

  function initSettings() {
    scaleCtl = makeSetting($('#scaleHost'), { label: 'Overlay size', min: 0.5, max: 3, step: 0.05, k: 100, unit: '%', onChange: (v) => api.setSettings({ overlayScale: v }) });
    opacityCtl = makeSetting($('#opacityHost'), { label: 'Overlay opacity', min: 0.2, max: 1, step: 0.05, k: 100, unit: '%', onChange: (v) => api.setSettings({ overlayOpacity: v }) });
    scaleCtl.set(state.overlayScale || 1);
    opacityCtl.set(state.overlayOpacity || 1);
    initAlignment();
    initGames();
    initAccent();
    $('#startHidden').addEventListener('change', (e) => api.setSettings({ startHidden: e.target.checked }));
    $('#lowPriority').addEventListener('change', (e) => api.setSettings({ lowPriority: e.target.checked }));
    $('#fpsSel').addEventListener('change', (e) => api.setSettings({ fpsCap: Number(e.target.value) }));
    $('#memSel').addEventListener('change', (e) => api.setSettings({ memoryMode: e.target.value }));
    $('#memRestart').addEventListener('click', () => api.relaunch());
    renderSettings();
  }

  // Live footprint readout, only polled while the Settings tab is showing.
  async function pollPerf() {
    if (!$('#tab-settings').classList.contains('active') || document.hidden) return;
    try {
      const p = await api.getPerf();
      $('#perfCpu').textContent = p.cpu.toFixed(1) + '%';
      $('#perfMem').textContent = Math.round(p.memMB) + ' MB';
      $('#perfWin').textContent = p.overlayVisible ? p.overlaySize + '\u00d7' + p.overlaySize + ' px' : 'hidden';
      $('#perfHook').textContent = p.hook === 'running' ? 'active' : p.hook === 'unavailable' ? 'unavailable' : 'idle';
      pollAlign();
    } catch (e) { /* ignore */ }
  }

  function startPerfPolling() {
    clearInterval(perfTimer);
    perfTimer = setInterval(pollPerf, 1500);
    pollPerf();
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
        if (raw && hasOwn(raw, p.name)) proEdits[p.name] = Crosshair.sanitizeDesign(raw[p.name]);
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
    return { d: d, cfg: Crosshair.sanitizeDesign(c) };
  }

  // The crosshair a pro card stands for: the user's saved edit, or the decoded original.
  function proConfig(p) {
    if (hasOwn(proEdits, p.name)) return Crosshair.sanitizeDesign(proEdits[p.name]);
    return codeToConfig(p.code).cfg;
  }

  // Keeps the user's own animation and offset settings when a shared crosshair is applied.
  function applyShared(c, label) {
    const d = Crosshair.sanitizeDesign(c);
    const old = design.layers[0];
    if (d.layers.length === 1) {
      Object.assign(d.layers[0], {
        offsetX: old.offsetX,
        offsetY: old.offsetY,
        animation: old.animation,
        animIntensity: old.animIntensity,
        animDuration: old.animDuration,
        animTrigger: old.animTrigger,
        animMode: old.animMode,
        animEase: old.animEase
      });
    }
    applyNewConfig(d);
    toast(label);
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
    setCurName(p.name);
    updateEditBar();
    showTab('crosshair');
  }

  function finishEdit() {
    if (!editingPro) return;
    const name = editingPro;
    proEdits[name] = Crosshair.sanitizeDesign(canon());
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

  function exportFields() {
    const L = design.layers;
    if (L.length !== 1 || L[0].kind !== 'shape' || L[0].style !== 'cross') {
      throw new Error('Export needs a single plain cross layer (remove other layers and set the shape to Cross)');
    }
    return ShareCode.fromConfig(L[0], { screenHeight: proOpts.height, scale: proOpts.scale, dpr: window.devicePixelRatio || 1 });
  }

  async function exportCrosshair(kind) {
    try {
      const f = exportFields();
      const text = kind === 'code' ? ShareCode.encode(f) : ShareCode.toConsole(f);
      await api.clipboardWrite(text);
      toast(kind === 'code' ? 'CS2 code copied' : 'Console commands copied');
    } catch (e) {
      toast(e.message);
    }
  }

  function initPros() {
    $('#csExportCode').addEventListener('click', () => exportCrosshair('code'));
    $('#csExportCmd').addEventListener('click', () => exportCrosshair('cmd'));
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
    design = viewOf(Crosshair.sanitizeDesign(state.crosshair), 'base');
    sel = 0;

    preview = Crosshair.createController($('#previewCanvas'), { size: 340, zoom: 2 });
    homePrev = Crosshair.createController($('#homePreview'), { size: 200, zoom: 3 });
    homePrev.setConfig(canon());
    buildControls();
    initDynamics();
    initStates();
    renderLayers();
    applyToControls();
    preview.setConfig(design);
    updateZoom();
    commitNow();
    triggers = Crosshair.sanitizeTriggers(state.triggers);
    renderTriggers();
    wirePreviewPointer();
    Crosshair.onAssetLoad(() => { renderLayersSoon(); });
    $('#addLayerBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#addMenu').hidden = !$('#addMenu').hidden; });
    document.querySelectorAll('#addMenu button').forEach((b) => b.addEventListener('click', () => addOfKind(b.dataset.kind)));
    document.addEventListener('click', (e) => { if (!e.target.closest('.add-wrap')) $('#addMenu').hidden = true; });
    $('#trigCustomize').addEventListener('click', () => { customizing = !customizing; renderTriggers(); });
    $('#trigReset').addEventListener('click', () => { triggers = Crosshair.sanitizeTriggers(null); saveTriggers(); renderTriggers(); toast('Triggers reset'); });
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    document.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
    });
    document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => {
      state.displayMode = b.dataset.mode;
      renderSettings();
      api.setDisplayMode(b.dataset.mode);
      toast(b.dataset.mode === 'fullscreen' ? 'Fullscreen games mode on' : 'Windowed / borderless mode on');
    }));


    document.querySelectorAll('.bgs button[data-bg]').forEach((b) => {
      b.addEventListener('click', () => {
        $('#previewWrap').className = 'preview bg-' + b.dataset.bg;
        $('#previewWrap').style.backgroundImage = '';
      });
    });
    initPreviewBg();
    renderPresets();
    initBackup();
    initNudge();

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
        if (b.dataset.tab === 'settings') refreshDisplays();
      });
    });

    $('#exportBtn').addEventListener('click', async () => {
      await api.clipboardWrite(encodeCfg(canon()));
      toast('Crosshair code copied to clipboard');
    });
    $('#importBtn').addEventListener('click', () => {
      if (importFrom($('#importIn').value)) $('#importIn').value = '';
    });
    $('#imgImportBtn').addEventListener('click', () => pickImage((img) => {
      applyNewConfig({ layers: [{ name: img.name, kind: 'image', src: img.src, imgAspect: Math.min(20, Math.max(0.05, img.aspect)), imgSize: 32, animation: 'none' }] });
      setCurName(img.name);
      toast('Imported “' + img.name + '” - adjust its size in the Designer');
      document.querySelector('[data-tab=crosshair]').click();
    }));
    $('#pasteBtn').addEventListener('click', async () => {
      const text = await api.clipboardRead();
      $('#importIn').value = text;
      importFrom(text);
    });

    $('#saveProfileBtn').addEventListener('click', async () => {
      const name = $('#profileName').value.trim();
      if (!name) { toast('Give it a name first'); return; }
      const r = await api.saveProfile(name, canon());
      if (r.ok) { toast('Saved \u201c' + name + '\u201d'); $('#profileName').value = ''; }
      else toast('That name is not allowed');
    });

    $('#overlayToggle').addEventListener('change', (e) => api.setOverlay(e.target.checked));
    $('#pill').addEventListener('click', () => api.setOverlay(!state.overlayVisible));
    $('#homeToggle').addEventListener('click', () => api.setOverlay(!state.overlayVisible));
    $('#homeEdit').addEventListener('click', () => showTab('crosshair'));
    $('#displaySel').addEventListener('change', (e) => api.setDisplay(e.target.value === '' ? null : Number(e.target.value)));
    $('#autoStart').addEventListener('change', (e) => api.setAutoStart(e.target.checked));
    $('#resetBtn').addEventListener('click', () => { applyNewConfig(Crosshair.DEFAULT_DESIGN); toast('Crosshair reset'); });
    wireHotkeyCapture();
    $('#shapeClose').addEventListener('click', closeShapePicker);
    $('#shapeModal').addEventListener('mousedown', (ev) => { if (ev.target === $('#shapeModal')) closeShapePicker(); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#shapeModal').hidden) closeShapePicker(); });

    renderProfiles();
    renderSettings();
    renderHomeGrid();
    refreshDisplays();

    api.onState((s) => {
      state = s;
      if (!customizing && s.triggers) { triggers = Crosshair.sanitizeTriggers(s.triggers); renderTriggers(); }
      renderProfiles();
      renderSettings();
      renderHomeGrid();
    });
    api.onInput((e) => { preview.input(e); if (homePrev) homePrev.input(e); });

    initPros();
    initSettings();
    startPerfPolling();
    api.onCrosshair((c) => applyNewConfig(c));
  }

  init();
})();
