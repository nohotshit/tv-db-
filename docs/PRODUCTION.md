# Production readiness

State of the system, honestly. Ticked items are verified, not assumed.

## Done and verified

**Code**
- [x] No secrets in the repository; every credential comes from the environment
- [x] Config refuses to boot in production with placeholder secrets
- [x] Debug overlay off by default
- [x] Unsigned Second Life requests refused in production
- [x] No debug leftovers, TODOs or dead credentials (audited)
- [x] CORS is an explicit allow list, never a wildcard
- [x] Rate limiting: HTTP limiter, plus per-socket and per-TV token buckets
- [x] Input validated at three layers — browser, backend, and the object's own whitelist

**Reliability**
- [x] Runs with no database at all; only saved data is lost
- [x] Runs with no backend at all; local controls, clock, idle and games continue
- [x] Migrations run at boot, non-fatal on failure
- [x] Ephemeral HTTP-in urls re-register on reset, rez and region restart
- [x] Failed pushes to the object queue and are collected on its next poll
- [x] A rejected device key re-pairs itself instead of locking out
- [x] WebSocket reconnects with backoff, indefinitely

**Verified by test**
- [x] 13 backend integration tests — signatures, replay windows, all four permission modes, hidden game state
- [x] 12 epoch checks — including a viewer joining 300s late landing at 300s
- [x] 8 end-to-end sync checks — late joiner at 4.22s after 4s elapsed
- [x] 6 server-media conversions — playing, paused, late joiner, clamping
- [x] 40,880 timezone samples against real tzdata, zero mismatches
- [x] All 14 LSL scripts pass structural checks

**Operations**
- [x] Backend on a paid instance; no spin-down, no cold starts
- [x] Database isolated in its own schema, sharing safely with another project
- [x] Health endpoint reports each subsystem honestly, including when degraded
- [x] Screens self-report connection problems to the service log

## Still required

**Before any public use**

- [ ] **Rotate `shared_secret`.** The current value was generated in a chat
      transcript. Set a new one in Render and the notecard, re-drop, done.
- [ ] **Confirm HUD pairing works.** Fixed but never observed succeeding.
- [ ] **Test with two avatars.** The synchronisation is the reason this exists
      and has never run with real viewers. See TESTING.md.
- [ ] **Resolve the local-mode report.** Diagnostics now land in the service
      log; reproduce it once and the cause will be there.

**Before it runs unattended**

- [ ] **Database expires 2026-09-26.** Free Postgres, 30 day limit, shared with
      `musical-impact-api`. When it goes, favorites, history and saved settings
      stop persisting; everything else keeps working.
- [ ] **Name the TV object.** It currently reports as "Object", which is what
      viewers see in menus and messages.
- [ ] **Decide the Movies destination.** `flixbaba.tv` is configuration, not
      code. Unlicensed streaming sites can draw a complaint against the land or
      account hosting them.

**Worth knowing, not blocking**

- [ ] Browser autoplay policy may prevent a late joiner hearing audio until
      they click. Unconfirmed in the viewer's browser. The remedy is a "tap to
      enable audio" overlay if it turns out to apply.
- [ ] Media volume for external sites cannot be controlled from a script; the
      buttons grey out and say so.

## What cannot be fixed, only understood

These are platform limits, documented in full in LIMITATIONS.md:

- A media face cannot identify who is looking at it. Personal features live on
  the HUD for this reason.
- LSL has no WebSocket client, no HMAC, no timezone database, and 32-bit
  integers.
- Sites loaded directly onto the prim cannot be synchronised or read.
- Live streams cannot be position-synchronised by anyone.
