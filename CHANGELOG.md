# EZ Reticle – Changelog

Windows-first crosshair overlay built with Electron: a transparent, click-through, always-on-top overlay with a layered crosshair designer.

## v1.3.0: Lighter input, game detection and idle CPU
- **Click/key animations no longer use a low-level input hook.** A small native helper reads clicks and keys through Windows Raw Input, which gets a copy of each event after Windows has already delivered it to the game. Nothing waits on EZ Reticle, so it cannot add input lag, even when the PC is under load. Mouse movement is dropped inside the helper; only button and key changes reach the app.
- **Per-game profiles and "follow game window" no longer start PowerShell.** The same helper is told by Windows when the active window changes, saving the ~50–100 MB PowerShell process and reacting instantly instead of up to a second later.
- **Efficiency mode while idle**: with a static crosshair and the editor closed, EZ Reticle runs in Windows Efficiency mode (idle priority + EcoQoS), like Task Manager's toggle. Animations and the open editor keep normal low-priority scheduling.
- **Fix**: with "Only show the crosshair while a game is in front", the crosshair no longer reappears a few seconds after being hidden.
- Both fall back to the old uiohook / PowerShell paths if the helper isn't built. When the uiohook fallback is active, the main process keeps normal priority so the hook is never starved.

## v1.2.0: Hotkeys, startup and updates
- **Saved crosshair hotkeys** in Settings > Hotkeys: give every saved crosshair its own key to swap mid-match, next to Show/hide, Next and Previous.
- **Startup** card: Start with Windows, Start minimized to the tray, and the new **Only show the crosshair while a game is in front**. With all three on, EZ Reticle waits in the tray and the crosshair appears when your game is focused.
- Games list: add a game with **Keep current crosshair** to use it just for showing/hiding (no automatic switch).
- **In-app updates**: a line in the sidebar (and the tray menu) says when a newer version is on GitHub Releases. Click it to download in the background, then click again to restart into the new version. Settings > Updates can turn checks off, check now, or open the releases page. Nothing downloads until you click.
- **Hide from recordings and streams** (Settings > Overlay): keeps the crosshair out of OBS, Discord screen share, clips and screenshots while you still see it.
- **Default crosshair** is now selectable: first in the Saved crosshairs dropdown and first in the starter presets.
- **First-run setup guide**: pick your game and fullscreen/borderless, pick a crosshair (or paste a CS2 / EZ code), set the hotkey and startup options. Run it again from Settings > Reset.
- Release builds are ready for free code signing through SignPath Foundation (see docs/SIGNING.md); they stay unsigned until it's set up.

## v1.1.0: New Designer
- Three-panel layout in the EZGG matte black + yellow look: Layers on the left, a large canvas in the middle, the Inspector on the right, and a top bar with name, hotkey, saved status, New / Undo / Redo / Share / Save / Apply.
- **Canvas editing**: click a layer to select it, drag to move, corner handles to resize, top handle to rotate (Shift = 15° steps). Grid and Snap toggles (Alt moves freely), zoom with −/+ or the mouse wheel, and Fit.
- **Multi-select**: Shift/Ctrl-click layers in the list or on the canvas, Ctrl+A for all. Moving, rotating, hiding, duplicating, deleting and most inspector settings apply to every selected layer.
- **Layer list**: drag to reorder, thumbnails, animation badge, eye toggle, double-click or F2 to rename, right-click menu (duplicate, hide, forward/backward, mirror, copy/paste style, delete).
- **1:1 in-game preview**: a floating card shows the crosshair at real size (times your overlay scale) over game-style backgrounds or your own screenshot; ‹ › switches backgrounds.
- **Animation strip** under the canvas: "Animate this layer" opens one card per animation (effect, when, mode, easing curve, strength, speed, hold-to-test). Dynamic spread and Color rules moved here as tabs.
- **Per-crosshair hotkeys**: give a saved crosshair its own hotkey from the top bar to equip it in game.
- Saved crosshairs moved into the dropdown next to the name; the Save button saves under that name (Ctrl+S).
- Shortcuts: Ctrl+D duplicate, Delete, H hide, G grid, F fit, Ctrl+[ / Ctrl+] reorder, arrow keys nudge.
- Default accent is now EZGG yellow, with neutral black and grey panels.
- 1:1 preview backgrounds: CS2, Deadlock, grass, sky, dark, light, or your own screenshot.
- Windows installer is built automatically by GitHub Actions for each release.

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
