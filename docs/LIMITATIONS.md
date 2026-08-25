# What Second Life can and cannot do here

Read this before filing a bug. Several things people reasonably expect from a
Smart TV are not possible on a prim, and this project names them rather than
faking them. Each entry says what the limit is, why it exists, and what the
system does instead.

---

## 1. A media face cannot tell you who is looking at it

**The limit.** Every avatar's viewer loads the media URL independently. The
page has no per-viewer identity, no way to know who clicked it, and no way to
distinguish two people standing side by side.

**Why.** Media-on-a-Prim is a browser instance running inside each person's own
viewer. The prim stores a URL, not a session. There has never been an API for
per-viewer state on a shared face.

**What this project does.** The TV screen is treated as a *shared display*. All
personal functionality lives on the **remote HUD**, which is attached to exactly
one avatar, so `hud_core.lsl` can build its media URL with that avatar's key and
a signed token. That is why favorites, per-user settings and "claim host" are on
the HUD and not on the screen — not a design preference, the platform's shape.

---

## 2. LSL has no WebSocket client

**The limit.** The in-world object cannot hold a realtime connection.

**Why.** No such function exists in LSL. `llHTTPRequest` is one-shot.

**What this project does.** Realtime lives in the browser, which has full
WebSocket support. The object registers an `llRequestSecureURL` endpoint and the
backend **pushes** to it over HTTP, with a slow poll as fallback. The frontend
holds the WebSocket; the backend mirrors to the object whatever it needs.

---

## 3. The page cannot call the object directly

**The limit.** JavaScript in the media face cannot `fetch` the object's HTTP-in
URL.

**Why.** `llHTTPResponse` returns a status and a body — it cannot emit CORS
headers, so the browser blocks the request before it leaves the tab. There is no
way to add `Access-Control-Allow-Origin` from LSL.

**What this project does.** Everything relays through the backend:
`page ⇄ backend ⇄ object`. It is a constraint, but it is also the correct
design, because it puts one authoritative server between the untrusted browser
and the object.

---

## 4. HTTP-in URLs are ephemeral

**The limit.** The URL from `llRequestSecureURL` dies on script reset, on rez,
on region restart, and when the object changes region.

**What this project does.** `net_bridge.lsl` re-registers on all of those events.
The backend treats a failed push as routine: it queues the command, and the
object collects it on its next poll. A dead endpoint is expected, not an error.

---

## 5. There is no volume control for a media face

**The limit.** `PRIM_MEDIA_*` has no volume parameter. Media volume is each
viewer's own preference slider.

**What this project does.** The HUD volume buttons control audio **the TV app
itself plays** — the HTML5 audio in the Music section, or an embedded player.
When an external site is on screen those buttons are greyed out and the UI says
why, rather than pretending to do something.

---

## 6. Playback position cannot be read from a third-party site

**The limit.** Once the media face is showing `youtube.com` or `twitch.tv`, no
script of ours runs in it. We cannot read the playhead or seek it.

**What this project does.** Position synchronisation works for media the TV
plays itself — HTML5 audio, and YouTube through the IFrame API, where our own
player exposes `currentTime`. For a site opened full-screen, "sync" means every
viewer is navigated to the same URL at the same moment, and the interface says
so instead of drawing a fake progress bar. Live streams sit at the live edge
within a few seconds of each other and cannot be tightened from outside.

---

## 7. Most sites cannot be embedded in a frame

**The limit.** YouTube, Twitch, Kick and most of the web send
`X-Frame-Options` or `frame-ancestors` headers that forbid iframing.

**What this project does.** Two display modes. **App mode** keeps our interface
and embeds only players that permit it. **Direct mode** hands the whole prim
face to the site, which replaces our UI entirely — the HUD becomes the way back,
and pressing Home tells LSL to restore the app URL. The distinction is visible
throughout the interface because it changes what is possible.

---

## 8. Navigation is "set a URL", and nothing else

**The limit.** `llSetLinkMedia` can only *set* the current URL. There is no
back, no forward, no reload, and no way to ask what is currently loaded.

**What this project does.** Back and Forward are a URL stack the TV keeps
itself, re-setting a remembered address. Refresh re-sets the current URL, which
is exactly what a reload is from outside. Links the user follows *inside* a site
are invisible to us and belong to their viewer's own history, which no script
can read — the interface says this when you reach the end of the stack.

---

## 9. LSL has no timezone database

**The limit.** There is no `llConvertToTimezone`, and no IANA rules in the
scripting environment. A script cannot know that `America/New_York` means UTC−5
in January and UTC−4 in July.

**What this project does.** The on-screen clock uses `Intl.DateTimeFormat`,
which has real tzdata, and handles every zone correctly. For the object itself,
`clock_manager.lsl` implements the one rule set it can implement correctly: the
US daylight saving rule in force since 2007. That covers every US zone the
requirements list, plus Arizona and Hawaii, which never shift, plus UTC. Any
other zone falls back to Second Life time and **says so** rather than printing a
wrong number.

That implementation was verified against real tzdata over 40,880 samples across
eight zones and fourteen years, with zero mismatches, and both 2026 transition
boundaries land exactly to the second.

---

## 10. LSL cannot compute HMAC-SHA256

**The limit.** HMAC needs the key XORed byte-wise with the ipad/opad constants
and the inner digest concatenated as raw bytes. `llSHA256String` hashes the
UTF-8 bytes of a *string*: there is no byte-array type, no XOR across a string,
and any digest byte above `0x7F` would be re-encoded as two UTF-8 bytes and
change the result.

**What this project does.** A two-pass construction both sides can compute over
ASCII:

```
inner     = sha256(secret + ":" + timestamp + ":" + body)
signature = sha256(secret + ":" + inner)
```

This avoids the length-extension weakness a naive `sha256(secret + message)`
would carry. Specifying HMAC here would have meant specifying something that
cannot be built in-world.

---

## 11. LSL integers are 32-bit

**The limit.** `llGetUnixTime() * 1000` overflows. An object cannot produce a
millisecond timestamp.

**What this project does.** The bridge protocol speaks **UNIX seconds**. The
backend accepts milliseconds too, for anything else that talks to it. The same
32-bit ceiling means all this arithmetic is good until 2038, like everything
else built on `llGetUnixTime`.

---

## 12. Rate limits and size caps

| Limit | Value | How it is handled |
|---|---|---|
| `llHTTPRequest` throttle | ~25 requests / 20 s **per owner per region**, shared by every script that owner runs there | One script (`net_bridge`) owns all HTTP and stays under 18 per window, queueing the rest |
| `llHTTPResponse` body | **2048 bytes**, a hard cap | Replies to pushes are a few dozen bytes |
| `llHTTPRequest` response body | 2048 bytes by default, raisable to **16384** with `HTTP_BODY_MAXLENGTH` | Raised to 16384; the backend still keeps payloads small |
| Media face texture | **1024 × 1024** max | Interface designed at 1024 × 576 |
| Linkset Data | **128 KB** per linkset, keys and values | Configuration only; cloud data is never duplicated there |
| `llDialog` | **12 buttons**, 24-character labels | Menus are paged |
| Mono script memory | **64 KB** each | Twelve focused scripts instead of one large one |
| `llInstantMessage` | 2-second script delay | Used only as the fallback for someone who has left the region |
| Avatar detection | ~96 m practical ceiling | Range setting is clamped to it |

---

## 13. Things this project deliberately does not do

- **Read private instant messages, group chat, friend lists or accounts.** No
  LSL function exposes them, by design, and nothing here tries to work around
  that. Every message in the Messages section was typed into this TV.
- **Download, record, re-host or redistribute anyone's content.** Every media
  section is a browser pointed at a website.
- **Circumvent DRM or access controls.** Nowhere in the codebase.
- **Collect unnecessary personal data.** History stores title, URL, source and
  timestamp, trims itself to sixty rows per user by database trigger, and can be
  cleared from the interface. Presence keeps a name and key while someone is
  standing there and drops it when they leave. No positions, no analytics.

---

## 14. Things that are Render's shape, not Second Life's

- **Free web services sleep after ~15 minutes idle.** The cold start is roughly
  50 seconds and it drops WebSockets. The TV keeps working locally throughout
  and reconnects on its own, but for anything people actually use, the paid tier
  is the right call.
- **Free PostgreSQL instances expire.** The system runs without a database at
  all — sync, presence, messaging and games are all in-memory — so this
  degrades rather than breaks. Only favorites, history and saved settings need
  it, and those fall back to per-viewer local storage.
