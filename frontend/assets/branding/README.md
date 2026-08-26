# Branding assets

Drop your own artwork here — nothing else in the project needs to change.

| File | Used for | Notes |
|------|----------|-------|
| `logo.png` | boot, idle, status bar, HUD, About | **Live logo.** 1024×1024 RGBA, transparent background. |
| `logo-source-2000.png` | master copy | The original 2000×2000 export, kept for re-processing. Not loaded at runtime. |
| `logo.svg` | fallback if `logo.png` fails to load | Built-in vector approximation. |
| `logo-mark.png` | optional small square mark | Falls back to `logo.png`. |
| `favicon.svg` | browser tab | Optional. |

## Why the live logo is 1024 and transparent

The source export is 2000×2000 with the black background baked in as opaque
pixels. That works, but two things are better at 1024 RGBA:

- **Second Life textures cap at 1024** and want power-of-two dimensions, so
  this file uploads as-is for the in-world idle screen.
- **A baked black background shows a visible square edge** against the
  interface, which is `#0a0a0b` rather than pure black, and against the boot
  screen's vignette. Transparency removes the seam.

Alpha was derived from luminance rather than a hard colour key, so the
antialiased edges of the headphones and script lettering stay smooth, and the
colour was un-premultiplied afterwards so edge pixels keep their true hue.

Result: 45 KB instead of 130 KB, 84.6% transparent, 15.4% artwork.

## Replacing it

Drop in any `logo.png`. Transparent PNG, ideally 1024×1024. Resolution order is
defined in `frontend/branding.json` and resolved at runtime by
`frontend/js/core/branding.js`, which walks down the chain on a load failure so
a bad file degrades instead of leaving a broken image on screen.

A `LOGO_URL` environment variable on Render overrides all of the above without
touching the repository, and the in-world notecard's `logo_uuid` sets the
texture used for the offline idle screen.

## Uploading to Second Life

Upload `logo.png` as a texture, then right-click it in inventory →
**Copy Asset UUID**, and paste that into `logo_uuid` in the `TV Config`
notecard. That is what the TV shows when the cloud is unreachable.
