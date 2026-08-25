# Branding assets

Drop your own artwork here — nothing else in the project needs to change.

| File | Used for | Notes |
|------|----------|-------|
| `logo.png`  | boot screen, idle screen, About, HUD splash | **Your real logo.** Preferred. Transparent PNG, >= 512px. |
| `logo.svg`  | fallback if `logo.png` is missing/fails to load | Built-in vector approximation. |
| `logo-mark.png` | small corner watermark, HUD button | Optional. Square crop. Falls back to `logo.png`. |
| `favicon.svg` | browser tab | Optional. |

Resolution order is defined in `frontend/branding.json` and resolved at runtime by
`frontend/js/core/branding.js`. A `LOGO_URL` environment variable on Render
overrides all of the above without a code change.

In-world, the same logo should be uploaded to Second Life as a texture and its
UUID stored in Linkset Data under `logo_uuid` (see the TV config notecard).
