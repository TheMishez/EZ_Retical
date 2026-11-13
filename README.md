# Mishez Xhair

## What's in it

* **Overlay:** transparent, click-through, always-on-top window centered on the chosen display. Toggle with a global hotkey (default F8, changeable in Settings).
* **Editor:** style (cross, X, circle, square, dot), size, gap, thickness, rotation, T-style, color, opacity, outline, center dot, offset, with a live zoomed preview.
* **Animations:** expand, shrink, pulse or flash on click, and expand while moving (WASD). These use a global input hook, which is only started while an animation other than None is selected.
* **Pro crosshairs:** a searchable list of about 28 CS2 pros. Each entry is a CS share code that the app decodes, converts to pixels for your game's screen height, and previews. "Use" applies it, "Save" adds it to your list. You can also paste any `CSGO-xxxxx-...` code to import it. "Edit" opens a pro in the editor; "Save to <name>" keeps your own version on that pro's card (marked "edited", with a Reset button to restore the original).
* **Share and save:** copy/paste crosshair codes (`XH1:...`) and save named crosshairs.
* **Aim trainer:** Gridshot, Flick, Tracking, drawn with your own crosshair, with mouse capture and sensitivity, local best scores, and a daily seed (same target sequence for everyone on a given day).

## Limits

* The overlay only shows over games in **borderless windowed** or windowed mode, not exclusive fullscreen.
* It is a plain overlay window: no injection and no reading game memory. Some games, anti-cheats, or tournaments still restrict overlay crosshairs, so check their rules.
* Leaderboards need a server and are not included. Trainer scores are stored locally.
* The trainer's sensitivity is a simple multiplier, not matched to any game's sensitivity.

## Pro crosshair notes

* The list is in `pros.js`: to update a pro, replace their `code`. Codes were copied from csdb.gg (reviewed July 2026) and wecoach.gg (undated), so some may be out of date.
* Only the older `CSGO-xxxxx-...` code format is supported. Codes starting with `CS` and no dashes are rejected with a message.
* Size conversion assumes 1 CS unit = screen height / 600 pixels. If a crosshair looks off next to CS2, use the calibration slider.

## Files

|File|Purpose|
|-|-|
|`main.js`|App lifecycle, overlay window, tray, hotkey, input hook, settings storage|
|`preload.js`|Safe bridge between the windows and the main process|
|`crosshair.js`|Shared config validation, drawing and animation|
|`overlay.html` / `overlay.js`|The click-through crosshair window|
|`editor.html` / `editor.css` / `editor.js`|Editor, share codes, profiles, settings|
|`sharecode.js`|CS2 share-code decoder and mapper|
|`pros.js`|The pro crosshair list (codes and sources)|
|`trainer.js`|Aim trainer|

Settings are saved to `%APPDATA%/Mishez Xhair/settings.json`.

