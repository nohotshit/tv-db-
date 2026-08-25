# Musical Impact Smart TV

A Second Life Smart TV and media centre: an in-world TV object and remote HUD,
a web interface rendered on the prim through Media-on-a-Prim, and a realtime
backend that keeps every viewer in the room watching the same thing.

Black and red throughout, from the Musical Impact logo.

```
   IN WORLD                          RENDER                       DATA
 ┌────────────────┐            ┌──────────────────┐        ┌──────────────┐
 │ TV object      │  HTTPS     │ Backend          │        │ PostgreSQL   │
 │  12 LSL        │◄──────────►│  REST + WebSocket│◄──────►│  7 tables    │
 │  scripts       │  signed    │  SL bridge       │        └──────────────┘
 └───────┬────────┘            └────────┬─────────┘
         │ sets media url                │ WebSocket
         ▼                               ▼
 ┌────────────────┐            ┌──────────────────┐
 │ Prim media face│───loads───►│ Frontend         │
 │ 1024 x 576     │            │  static site     │
 └────────────────┘            └──────────────────┘
 ┌────────────────┐
 │ Remote HUD     │  the only surface that knows WHO is using it
 └────────────────┘
```

## What it does

| | |
|---|---|
| 🎬 Movies · ▶ YouTube · 📺 Twitch · 🟢 Kick | Open as full sites on the screen |
| 🎵 Music | Plays inside the TV, so it stays position-synchronised |
| 🌐 Browser | Address bar, favorites, history, validated URLs |
| 💬 Messages | A board for the people standing at the TV |
| 🎮 Games | Tic-Tac-Toe, Connect Four, Rock Paper Scissors, Trivia, Number Guessing, Reaction |
| 🕒 Clock | Full timezone support with correct daylight saving |
| ⚙ Settings | Media, sync, clock, idle, permissions, messaging, display |

Plus a boot screen, a configurable idle screen, four permission modes, a media
queue, favorites, recent history, a debug overlay, and graceful degradation to
local-only operation when the cloud is unreachable.

## Repository layout

```
frontend/     static Smart TV interface, plain ES modules, no build step
backend/      Express API, WebSocket realtime, Second Life bridge
second-life/  12 LSL scripts (TV and HUD) plus the config notecard
docs/         deployment, in-world install, limitations, testing, API
```

## Getting started

```bash
git clone https://github.com/nohotshit/tv-db-.git
cd tv-db-/backend && npm install && npm test
```

Then follow, in order:

1. **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — deploy to Render and set up the database
2. **[docs/SECOND-LIFE-INSTALL.md](docs/SECOND-LIFE-INSTALL.md)** — build the TV and HUD in world
3. **[docs/TESTING.md](docs/TESTING.md)** — work through the test plan

## Read this before anything else

**[docs/LIMITATIONS.md](docs/LIMITATIONS.md)** sets out what Second Life can and
cannot actually do here, with the reasons. Several things people expect from a
Smart TV are not possible on a prim, and the ones that are not are named
plainly rather than faked. It is the most useful document in the repository.

## Your logo

The logo lives in `frontend/assets/branding/logo.png` and is used on the boot
screen, the idle screen, the status bar, the HUD and the About page. Replace
that one file and everything updates. It can also be overridden per deployment
with a `LOGO_URL` environment variable, or per TV from the in-world notecard —
no rebuild in any case. See `frontend/assets/branding/README.md`.

## Secrets

None are in this repository and none should ever be committed. Everything
sensitive comes from environment variables; `backend/.env.example` documents
every one. `.env` is gitignored, and `render.yaml` generates the secret values
on first deploy so they never pass through a keyboard.

## Licence and use

Point the Movies tile wherever you like — the address is configuration, not
code. Note that unlicensed streaming sites can draw a complaint against your
land or account, which is your call to make. Nothing in this project downloads,
records, re-hosts or redistributes anyone's content, and nothing works around
access controls: every media section is a browser pointed at a website.
