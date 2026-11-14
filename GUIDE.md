# EZ Reticle

A Windows crosshair overlay with a live crosshair designer, built with Electron.

## Run it

Requires Node.js 18 or newer.

```
npm install
npm start
```

The editor opens and a green crosshair appears at the center of your screen. Closing the editor window keeps the overlay running in the system tray. Use the tray icon to reopen the editor or quit.

## Build an installer

```
npm run dist
```

The Windows installer is written to `dist/`. Add `build/icon.ico` (256x256) before shipping so the installer and exe use your own icon.

## What's in it

- **Overlay:** transparent, click-through, always-on-top window centered on the chosen display. Toggle with a global hotkey (default F8, changeable in Settings).
- **Editor:** a library of about 45 shapes in a grouped picker (crosshairs, basic shapes, radial, gauges), size, gap, thickness, rotation, T-style, color, opacity, outline, center dot, offset, with a live zoomed preview.
- **Animations:** expand, shrink, pulse or flash on click, and expand while moving (WASD). These use a global input hook, which is only started while an animation other than None is selected.
- **Pro crosshairs:** a searchable list of about 28 CS2 pros. Each entry is a CS share code that the app decodes, converts to pixels for your game's screen height, and previews. "Use" applies it, "Save" adds it to your list. You can also paste any `CSGO-xxxxx-...` code to import it. "Edit" opens a pro in the editor; "Save to <name>" keeps your own version on that pro's card (marked "edited", with a Reset button to restore the original).
- **Share and save:** copy/paste crosshair codes (`XH1:...`) and save named crosshairs.

## Limits

- The overlay only shows over games in **borderless windowed** or windowed mode, not exclusive fullscreen.
- It is a plain overlay window: no injection and no reading game memory. Some games, anti-cheats, or tournaments still restrict overlay crosshairs, so check their rules.

## Pro crosshair notes

- The list is in `pros.js`: to update a pro, replace their `code`. Codes were copied from csdb.gg (reviewed July 2026) and wecoach.gg (undated), so some may be out of date.
- Only the older `CSGO-xxxxx-...` code format is supported. Codes starting with `CS` and no dashes are rejected with a message.
- Size conversion assumes 1 CS unit = screen height / 600 pixels. If a crosshair looks off next to CS2, use the calibration slider.

## Files

| File | Purpose |
| --- | --- |
| `main.js` | App lifecycle, overlay window, tray, hotkey, input hook, settings storage |
| `preload.js` | Safe bridge between the windows and the main process |
| `crosshair.js` | Shared config validation, drawing and animation |
| `overlay.html` / `overlay.js` | The click-through crosshair window |
| `editor.html` / `editor.css` / `editor.js` | Editor, share codes, profiles, settings |
| `sharecode.js` | CS2 share-code decoder and mapper |
| `pros.js` | The pro crosshair list (codes and sources) |

Settings are saved to `%APPDATA%/EZ Reticle/settings.json`.

## Layers (crosshair designer)

The Crosshair tab now has a **Layers** panel. Each layer is its own shape with its own color, size, outline, offset, animation and new **Glow / Blur** effects.
- **+ Add layer** (up to 16), duplicate, delete, reorder (top of the list draws on top), show/hide (the dot), double-click a name to rename.
- **Undo / Redo** with the buttons or Ctrl+Z / Ctrl+Y.
- Share codes, saved crosshairs and pro edits all work with multi-layer designs. Older single-layer saves load as one layer.

## Display mode (Settings)

- **Fullscreen games** – re-asserts "always on top" four times a second, which keeps the crosshair visible over most fullscreen-optimized games.
- **Windowed or borderless** – the simple overlay.

Limitation: a normal Electron overlay cannot draw over *true exclusive* fullscreen. EZ-Crosshair solves that with a separate Xbox Game Bar widget, which this app does not include. If the crosshair vanishes, set the game to **Fullscreen Windowed**.

## Layer types

**+ Add layer** offers four kinds:
- **Shape** – the 46-shape library.
- **Image** – upload a PNG/JPG/WebP/GIF (shrunk to 256px). Optional tint with the layer color.
- **Text** – any text, 5 fonts, bold, outline.
- **Draw** – sketch on the preview with a brush; mirror left/right, up/down or all 4 for symmetric crosshairs.

All kinds support rotation, offset, opacity, glow, blur and animation.

## Animation triggers

Each layer picks a **Trigger** (Shoot, Aim, Reload, Jump, Move, Run), an **Effect** (Expand, Shrink, Pulse, Flash, Spin, Fade, Hide, Show only) and a **Mode** (pulse on press, or hold while pressed). Defaults: Mouse 1, Mouse 2, R, Space, WASD, Shift. Click **Customize** in the Triggers card to rebind any key or mouse button. Press and hold an action name to preview it without the game. Global input is only listened to while a layer uses an animation.

## Performance

- The overlay is a tiny transparent window sized to your design (e.g. 64x64 px for the default crosshair), not a full-screen layer.
- Idle crosshairs cost nothing: the canvas only redraws while an animation plays, capped to the **Animation frame cap** (default 60).
- The global input hook only runs while a layer uses an animation **and** the overlay is visible.
- All processes run at below-normal priority (toggle: Low CPU priority). Closing the editor fully unloads it.
- Settings > Performance shows live CPU and memory for everything except the editor window.

## More settings

Overlay size and opacity, hotkeys for next/previous saved crosshair (F9 / Shift+F9), start hidden in the tray.

## Also included

- **Starter presets** (11 ready-made crosshairs, including reactive ones) on the Crosshair tab.
- **Preview on your own screenshot**: the "Photo" button sets the preview background.
- **Arrow keys** nudge the selected layer 1px (Shift = 10px).
- **Backup / restore** of everything from Settings. A damaged settings file is copied to `settings.json.corrupt` instead of being lost, and errors are logged to `error.log` in the app's data folder rather than shown as pop-ups.

## Build an installer

```
npm install
npm run dist
```

This produces `dist/EZ-Reticle-Setup-<version>.exe` with a desktop shortcut and the app icon (`build/icon.png`, regenerate with `node tools/make-icon.js`). The installed build also enables "Start with Windows".

## CS2 share codes

- Import: paste a new-style `CS…` code (44 characters) in the Pros tab. Legacy `CSGO-…` codes still work but are no longer the focus.
- Pros list: 99 players with new-format codes (totalcsgo.com, Nov 2026). Pros change settings often, so replace a code in `pros.js` to update one.
- Export: **Copy CS2 code** / **Copy console commands** for a single plain cross layer. The code layout was reverse-engineered from real codes (round-trips on all 99 pro codes); the T-style and style flags are not mapped, so check an exported code in game. Console commands are the safe fallback.
- Colorblind presets (CB Orange, Sky Blue, Yellow, White + Dot) use the Okabe-Ito palette.

## Easing, GIFs, per-game crosshairs, alignment

- **Easing:** every animated layer has an Easing dropdown (19 curves, including overshoot, elastic and bounce). Pressing again mid-animation continues from the current value instead of snapping.
- **GIF layers:** add an Image layer and pick a `.gif` (or animated `.webp`). Frames play on a clock; the file must stay under about 480 KB and at most 90 frames are used. Static images work as before.
- **Per-game crosshairs (Settings, Windows):** add a game's process name (e.g. `cs2`, use *Pick from running apps*) and choose a saved crosshair. It switches when that game is in front and, optionally, goes back afterwards. A small hidden PowerShell process watches the active window (once per second, only while this feature is on).
- **Centre on the game window:** for windowed games, the overlay centres on the game's client area instead of the display.
- **Alignment:** the overlay is centred on the exact middle physical pixel (handles 125%/150% scaling, mixed-DPI monitors, sleep/unlock and monitor changes). Settings shows the measured centre error, has an X/Y pixel offset, and a 15 s guide (magenta lines through the exact centre with cyan ticks every 10 px).

## Rounded edges

Shape layers have a **Rounded edges** slider (0-100%) that rounds the corners of cross arms, bars and square frames. It is a visual option only: CS2 codes and console commands can't store it.

## Crosshair 2 and separate opacities

- **Crosshair 2** is the first starter preset: four red tapered spikes (size 11.8, gap 5.3, width 4.8) matching the EZ-Crosshair look. The *Crosshair 2* shape's width now follows the Thickness slider.
- **Crosshair opacity** and **Outline opacity** are separate sliders. CS2 codes carry both, so imports and exports keep them. Size, Gap and Thickness now step in 0.1.

## Default crosshair

New installs start with a green cross (#00ff91, size 4, gap 4, thickness 2) with a size-4 centre dot and a pulse animation. *Reset crosshair to defaults* restores it. Existing installs keep their saved crosshair.

## Memory use

Settings > Performance > **Memory use** (restart to apply):
- **Balanced:** Chromium defaults.
- **Low (default):** smaller JS heap and caches, low-end-device rendering, no background networking or update checks.
- **Lowest:** also draws in software, which removes the GPU process (the largest single saving). If the crosshair ever looks wrong, switch back to Low.

Check the effect in Task Manager (add up all "EZ Reticle" processes) or in the live Memory readout in Settings.

## Pro crosshairs (CS2 codes)

New-format codes store gap, length and thickness in pixels at the code's screen height. They are now scaled to your *Game screen height* setting. Exported codes and console commands use the same units (`cl_crosshair_gap`, `cl_crosshair_length`, `cl_crosshair_thickness`, `cl_crosshair_screen_height`).

## Branding

The EZ Reticle logo is the installer/exe icon (`build/icon.png`), the window and tray icon and the header logo (`logo.png`, `logo-64.png`). Accents default to green and can be changed in Settings > Appearance.

## App accent color

The app is green by default again. **Settings > Appearance** lets you pick any accent (9 presets including the logo yellow, or a custom color). It is saved with your settings and included in backups.


## Dynamics & color rules (Designer tab)

- **Dynamic spread:** the whole crosshair grows or tightens with what you do (moving, running, shooting, jumping, aiming, reloading), with an adjustable speed and easing curve. Positive values spread, negative values tighten. Hold the test buttons to preview.
- **Color rules:** blend every layer toward a color while an action is active (e.g. red while reloading). Optionally recolor the outline too.
- A layer can opt out with "React to dynamics & rules" (Animation section). Presets "Dynamic Spread" and "Reload Red" show both.

## States & layer tools

- **States:** in the Designer, "Editing" lets you design a separate crosshair for while you hold Aim, Reload, Jump, Run, Move or Shoot (e.g. a tiny dot while scoped). It replaces the normal crosshair only while that action is held; if several are held, Aim wins, then Reload, Jump, Run, Move, Shoot. A • marks states you've made. "Remove state" deletes one.
- **Layer tools:** Copy/Paste style (color, outline, effects, animation), Mirror ↔ / ↕ (duplicates the layer mirrored), and per-layer Flip left/right and up/down.
- CS2 code export still needs a single plain cross layer, so states and dynamics aren't included in CS2 codes (they are in XH1 codes and saved crosshairs).

- **Import image:** Home → Share → "Import image…" turns a PNG crosshair (e.g. exported from Crosshair X) into a new crosshair.
