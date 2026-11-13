/*
 * CS2 crosshair share-code decoder (legacy "CSGO-xxxxx-..." v1/v3/v4; the newer "CS..." format is recognised but not decoded),
 * plus a mapper from the decoded CS2 fields to this app's crosshair config.
 * Byte layouts follow the public format notes in akiver/csgo-sharecode (MIT).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShareCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
  const STYLE_NAMES = [
    'Dynamic Cross', 'Dynamic Circle', 'Dynamic Cross (Legacy)', 'Static Circle', 'Static Cross',
    'Static Cross (Shot Feedback)', 'Dot Only', 'Dynamic Quad', 'Static Square', 'Static Quad'
  ];

  const s8 = (b) => (b > 127 ? b - 256 : b);

  function toBytes(body, length) {
    let n = 0n;
    const chars = body.split('').reverse();
    for (const c of chars) {
      const i = DICT.indexOf(c);
      if (i < 0) throw new Error('Invalid character "' + c + '" in code');
      n = n * 57n + BigInt(i);
    }
    const bytes = new Array(length).fill(0);
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    if (n !== 0n) throw new Error('Code is too long');
    return bytes;
  }

  function decode(input) {
    const raw = String(input || '').trim();
    let bytes;
    let kind;
    if (/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(raw)) {
      bytes = toBytes(raw.replace(/^CSGO/, '').replace(/-/g, ''), 18);
      kind = 'legacy';
    } else if (/^CS[A-Za-z0-9]{44}$/.test(raw)) {
      bytes = toBytes(raw.slice(2), 32);
      kind = 'cs2';
    } else {
      throw new Error('Not a CS2 crosshair code');
    }
    let sum = 0;
    for (let i = 1; i < bytes.length; i++) sum += bytes[i];
    if (sum % 256 !== bytes[0]) throw new Error('Code failed its checksum (typo or corrupted)');

    const version = bytes[1];
    const out = { format: kind + '-v' + version, version: version, splitDistance: 0 };

    if (kind === 'legacy' && version === 1) {
      out.gap = s8(bytes[2]) / 10;
      out.outlineThickness = bytes[3] / 2;
      out.outlineEnabled = !!(bytes[10] & 8);
      out.rgb = [bytes[4], bytes[5], bytes[6]];
      out.alpha = bytes[7];
      out.colorMode = bytes[10] & 7;
      out.thickness = bytes[12] / 10;
      out.style = (bytes[13] >> 1) & 7;
      out.dot = !!(bytes[13] & 16);
      out.tStyle = !!(bytes[13] & 128);
      out.length = bytes[14] / 10;
      out.units = 'game'; // tenths of game units: scales with screen height
    } else if (kind === 'legacy' && (version === 3 || version === 4)) {
      out.style = bytes[2] & 15;
      out.dot = !!(bytes[2] & 64);
      out.tStyle = !!(bytes[2] & 128);
      out.rgb = [bytes[3], bytes[4], bytes[5]];
      out.alpha = bytes[6];
      out.gap = s8(bytes[7]);
      out.length = bytes[8];
      const f = (bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24)) >>> 0;
      out.thickness = (f >>> 23) & 31;
      if (version === 3) out.outlineEnabled = !!(bytes[2] & 32);
      else out.outlineEnabled = ((f >>> 28) & 3) !== 0;
      out.outlineThickness = out.outlineEnabled ? 1 : 0;
      out.screenHeight = bytes[14] | (bytes[15] << 8);
      out.colorMode = 5;
      out.units = 'px';
    } else {
      throw new Error(kind === 'cs2' ? 'New-format CS codes (starting with "CS" and no dashes) are not supported yet. Use a CSGO-xxxxx-... code.' : 'Unsupported crosshair code version (v' + version + ')');
    }
    out.styleName = STYLE_NAMES[out.style] || 'Style ' + out.style;
    return out;
  }

  const PRESET_COLORS = [
    [250, 50, 50], // 0 red
    [50, 250, 50], // 1 green
    [250, 250, 50], // 2 yellow
    [50, 50, 250], // 3 blue
    [50, 250, 250] // 4 cyan
  ];

  function hex2(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  }

  function rgbOf(d) {
    if (d.colorMode >= 0 && d.colorMode <= 4) return PRESET_COLORS[d.colorMode];
    return d.rgb;
  }

  // Maps decoded CS2 fields to this app's config.
  //   opts.screenHeight: height (physical px) the game runs at; default 1080
  //   opts.dpr: devicePixelRatio of the display that shows the overlay; default 1
  //   opts.scale: manual size calibration multiplier; default 1
  // Console values (size/gap/thickness) are "game units"; 1 unit = screenHeight/600 physical px.
  function toConfig(d, opts) {
    opts = opts || {};
    const gameH = opts.screenHeight || 1080;
    const dpr = opts.dpr || 1;
    const extra = opts.scale || 1;
    // Pixel-based formats store console values at the height they were authored at.
    const toUnits = (v) => (d.units === 'game' ? v : (v * 1080) / (d.screenHeight || 1080));
    // The game rounds to whole physical pixels, so do the same, then convert to overlay (DIP) units.
    const px = (units) => Math.round(units * (gameH / 600) * extra) / dpr;
    const rgb = rgbOf(d);

    const length = toUnits(d.length);
    const thickness = toUnits(d.thickness);
    let inner = toUnits(d.gap) + 4; // arms start (gap + 4) units from the center
    let arm = length;
    if (inner < 0) {
      // Opposite arms overlap through the center: the union reaches max(|inner|, inner + length).
      arm = Math.max(-inner, inner + length);
      inner = 0;
    }
    arm = Math.max(0, arm);

    const cfg = {
      style: 'cross',
      color: '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]),
      opacity: d.alpha === undefined ? 1 : Math.max(0.1, d.alpha / 255),
      size: px(arm),
      gap: px(inner),
      thickness: Math.max(1, px(thickness)),
      rotation: 0,
      tStyle: !!d.tStyle,
      dot: !!d.dot,
      dotSize: Math.max(1, px(Math.max(thickness, 1))),
      outline: !!d.outlineEnabled,
      outlineColor: d.outlineRgb ? '#' + hex2(d.outlineRgb[0]) + hex2(d.outlineRgb[1]) + hex2(d.outlineRgb[2]) : '#000000',
      outlineThickness: d.outlineEnabled ? Math.max(1, px(Math.max(d.outlineThickness, 1))) : 0,
      offsetX: 0,
      offsetY: 0,
      animation: 'none'
    };
    if (d.style === 1 || d.style === 3) cfg.style = 'circle';
    else if (d.style === 8) cfg.style = 'square';
    else if (d.style === 6) cfg.style = 'dot';
    return cfg;
  }

  return { decode: decode, toConfig: toConfig, STYLE_NAMES: STYLE_NAMES, DICT: DICT };
});
