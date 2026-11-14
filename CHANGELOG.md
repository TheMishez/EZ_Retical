# EZ Reticle – Changelog

Windows-first crosshair overlay built with Electron: a transparent, click-through, always-on-top overlay with a layered crosshair designer.

## Core
- Transparent click-through always-on-top overlay, tray icon, global hotkeys (toggle / next / previous crosshair).
- Display modes (borderless, fullscreen) and overlay scale.
- Layered crosshair designer with live preview, undo/redo, and saved crosshairs.
- Layer types: shapes, images, text, and freehand drawing.
- Shapes with size, gap, thickness, rotation, T-style, center dot, outline, glow, blur, and offsets.

## Crosshair features
- **Rounded edges** per layer (applies to the overlay as well as the preview).
- **Separate fill and outline opacity** sliders.
- **GIF / animated image layers** (frames decode and loop in the overlay).
- **Animations**: expand, shrink, pulse, flash, spin, fade, hide, show, driven by triggers (shoot, aim, reload, jump, move, run) in pulse or hold mode, with a choice of easing curves and customizable key bindings.
- **Dynamic spread**: the whole crosshair grows or tightens while moving, running, shooting, jumping, aiming or reloading, with adjustable speed and curve, plus hold-to-test buttons.
- **Color rules**: blend toward a color while an action is active (e.g. red while reloading), optionally recoloring the outline.
- **States**: a separate crosshair design shown while Aim, Reload, Jump, Run, Move or Shoot is held.
- **Multiple effects per layer**: stack up to 6 animations on one layer, each with its own trigger, mode, easing, strength and speed.
- **Reactions panel**: one compact section per layer combines the animation effect (when, easing, strength, speed) with spread. Choose "Follow crosshair settings", "Custom for this layer" (own gap change while moving, running, shooting, jumping, aiming or reloading) or "Don't spread or recolor".
- Fade out now fades to fully invisible.
- **Layer tools**: copy/paste style, mirror left/right and up/down, per-layer flip, per-layer opt-out of dynamics.
- Starter presets, including "Crosshair 2", colorblind-friendly sets, "Dynamic Spread" and "Reload Red".
- Custom default crosshair on first install (green cross with dot and pulse).

## Pro crosshairs and codes
- 99 pro player crosshairs with a search box, applied at the correct size for your resolution (pixel-based scaling with a screen-height setting).
- **CS2 share code** import and export (`CS…` codes), plus export as console commands.
- Own share codes (`XH1:…`) that carry layers, dynamics, color rules and states.
- **Import image…** to turn a PNG crosshair from another app into a crosshair.
- Backup and restore of settings.

## Alignment and games
- **Per-game crosshairs**: automatically switch crosshair (and revert) based on the active game's exe, with optional follow-the-window.
- **Accurate centering** across DPI scaling and multiple monitors, with manual offsets and an on-screen alignment guide.

## App and UI
- Redesigned interface: left sidebar (Home, Designer, Pro Crosshairs, Settings), status card with Start overlay, quick-switch grid, collapsible inspector.
- Custom logo as the exe, installer, tray and in-app icon.
- **UI accent color** setting (green by default).
- Memory modes (Balanced / Low / Lowest) to reduce RAM use.
- Windows installer built with electron-builder (`npm run dist`).

## Removed
- Aim trainer (removed in favor of crosshair tools).

## Known limits
- CS2 code export requires a single plain cross layer; states, dynamics and color rules are not part of CS2 codes.
- The Windows-specific pieces (overlay centering, game detection, low-memory modes) were developed against a mock and need verification on real hardware.
