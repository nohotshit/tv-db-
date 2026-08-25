# API reference

Base URL: your backend service on Render.

Two audiences with different authentication:

- **Browsers** — a bearer token, issued to a HUD, in `Authorization`.
- **In-world objects** — a signature over the body, in `X-MI-Signature`.
  They carry no `Origin` header and are not subject to CORS.

Nothing is trusted from a request body for identity or authority. The server
re-derives both, on every call.

---

## Public

### `GET /api/health`

Never requires authentication; Render's health check uses it.

```json
{
  "ok": true,
  "subsystems": { "api": "ok", "realtime": "ok", "database": "ok" },
  "activeTvs": 2,
  "serverTime": 1787626961912,
  "notes": []
}
```

Returns 200 even when the database is down, because the service genuinely still
works without one. `subsystems.database` and `notes` report the truth.

---

## TV state

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/tv` | none | TVs this process knows about (ids and counts only) |
| `GET` | `/api/tv/:id` | none | One TV's public description |
| `GET` | `/api/tv/:id/state` | none | Full snapshot: media, queue, viewers, host |
| `GET` | `/api/tv/:id/users` | none | Viewers and current host |
| `POST` | `/api/tv/:id/sync` | token | Playback command |
| `GET`/`POST` | `/api/tv/:id/messages` | token | Session messages |
| `GET`/`POST` | `/api/tv/:id/games` | token | Game state and moves |

A snapshot's `media.positionMs` is extrapolated to *now* and stamped with
`media.updatedAtServer`, so a late joiner lands in the right place on its first
frame rather than starting at zero and being corrected.

`POST /api/tv/:id/sync` takes `{ action, media?, positionMs?, atServerTime? }`
where action is `play`, `pause`, `stop`, `seek`, `select` or `state`. Returns
403 with a readable reason when the caller does not hold control.

---

## Personal data

All require a HUD token. There is no route that takes a user id, so there is
nothing to enumerate — the identity always comes from the verified token.

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/favorites` | List, add |
| `DELETE` | `/api/favorites/:id` | Remove |
| `GET`/`POST` | `/api/history` | List, add |
| `DELETE` | `/api/history` | Clear all |
| `GET`/`PUT` | `/api/settings` | Read, save |

The shared TV screen cannot use these and gets a 401 that explains why: it has
no way to know who is looking at it.

`PUT /api/settings` accepts only known keys; anything else is dropped. An
unbounded blob from a client is not a preferences object, it is free storage.

Any of these return **503 with `degraded: true`** when the database is
unavailable. That is not an error to retry — it means local storage is in
charge for now.

---

## Second Life bridge

Every route requires `X-MI-Timestamp` (UNIX **seconds**) and `X-MI-Signature`:

```
inner     = sha256(secret + ":" + timestamp + ":" + body)
signature = sha256(secret + ":" + inner)
```

Not HMAC — see [LIMITATIONS.md §10](LIMITATIONS.md#10-lsl-cannot-compute-hmac-sha256).
Timestamps outside a five-minute window are rejected as replays.

| Path | Called when | Returns |
|---|---|---|
| `/api/lsl/register` | Script start, rez, region change | `sec` (device secret), `st` (state) |
| `/api/lsl/poll` | Fallback timer | `st`, `q` (queued commands) |
| `/api/lsl/presence` | Nearby avatars changed | Viewer count |
| `/api/lsl/pair` | An avatar touches the TV | `t` (HUD token), `ttl` |
| `/api/lsl/command` | A button or menu choice | `ok`, `st` |
| `/api/lsl/message` | Text typed at the object | `ok` |

Responses are kept well under 2048 bytes, because that is where LSL truncates.
Keys are short for the same reason.

`register` is called routinely rather than once: the HTTP-in URL it reports dies
on every script reset, rez and region restart.

---

## WebSocket `/rt`

```
wss://backend/rt?tv=<tvId>&surface=tv|hud&t=<token>
```

Identity comes from the token at connection time. `surface=tv` is anonymous by
nature and may only control the TV when the mode is `everyone`.

**Client → server:** `hello`, `time`, `ping`, `resync`, `sync`, `moap`, `host`,
`remote`, `message`, `queue`, `game`, `config`.

**Server → client:** `snapshot`, `sync`, `viewers`, `message`, `game`, `notice`,
`time`, `pong`, `error`.

### Clock handshake

`time` carries `{t0}` and comes back `{t0, t1, t2}`, straddling server
processing. The client repeats it a few times and takes the median:

```
offset = ((t1 - t0) + (t2 - t3)) / 2
```

This is what makes "server time" mean the same thing on every viewer's machine,
and therefore what makes half-second synchronisation possible at all.

### Rate limiting

Token buckets, not minimum gaps: capacity 20 refilled at 12/s per socket, and 12
at 6/s per TV for playback commands. A fixed minimum gap silently swallows
legitimate input — the Music view sends `select` immediately followed by `play`,
and a double-press of a remote button is a normal thing for a person to do.
Exceeding the bucket returns an `error` frame rather than dropping the command
in silence.
