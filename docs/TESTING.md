# Test plan

## Automated

```bash
cd backend && npm test
```

Thirteen integration tests covering the paths worth guaranteeing. They need no
database — the backend is designed to run without one, and the suite exercises
that mode deliberately.

| Test | What it protects |
|---|---|
| Unsigned request rejected | Anyone who learns a TV id cannot drive it |
| Signed register pairs the TV | The bridge handshake works |
| Replayed old signature rejected | The five-minute replay window holds |
| HUD pairing issues a token | Per-avatar identity is possible at all |
| Owner plays, every screen told | Sync fan-out reaches all viewers |
| Viewer cannot control owner-only TV | Permission is enforced server-side |
| Anonymous screen cannot either | A page cannot grant itself control |
| Everyone mode lets the screen control | Mode changes take effect |
| Private address cannot reach the prim | SSRF-shaped URLs are refused |
| Number-guess answer never leaves | Hidden state stays hidden |
| Unrevealed RPS pick is masked | An opponent cannot read the WebSocket |
| Object can poll for missed commands | Region restarts recover |
| Presence populates the viewer list | Group flag reaches the backend |

Two more checkers, both run from the repository root:

```bash
./check-js.sh        # every frontend ES module parses
python check-lsl.py  # LSL braces, declaration order, event names
```

`check-lsl.py` exists because there is no LSL compiler outside the viewer, and a
function called before it is declared is the easiest way to break a script.

---

## Manual

Work down this list on a live parcel. Each row says what "pass" means, so a
partial result is still useful information.

### Startup

| Step | Pass |
|---|---|
| Rez the TV with scripts and notecard | Chat confirms configuration loaded |
| Watch the screen | Logo, then `SMART TV`, then the home screen |
| Check the status bar | Clock ticking, cloud indicator green |
| Backend log | `[lsl] registered <key> in <region>` |

### Media

| Step | Pass |
|---|---|
| Movies, YouTube, Twitch, Kick | Site fills the screen; interface is replaced |
| HUD → Home | Interface returns |
| Music → add a station → play | Audio plays; transport responds |
| Volume and mute during music | Volume actually changes |
| Volume while an external site is up | Buttons greyed with a stated reason — **this is correct** |
| Browser → type an address → Go | Opens; appears in history |
| Browser → `file:///etc/passwd` | Refused with a clear message |

### Synchronisation — needs two avatars

| Step | Pass |
|---|---|
| Both at the TV, one presses Play | Both hear it start |
| Second person joins mid-stream | Lands at the current position, not at zero |
| Pause on one HUD | Both pause |
| Settings → Sync → watch drift | Stays under the tolerance |
| Open a live stream | Marked **Live**, no progress bar — **correct**, not a bug |

### Permissions

| Mode | Owner | Group member | Stranger |
|---|---|---|---|
| Owner | control | refused | refused |
| Group | control | control **with the tag active** | refused |
| Everyone | control | control | control |
| Host | control | only the appointed host | refused |

Also: appoint a host, have them walk away — control should be released
automatically.

### Clock and timezones

| Step | Pass |
|---|---|
| Settings → Clock → switch zones | Time changes; abbreviation matches (EST vs EDT) |
| 12 / 24 hour, seconds, three date formats | All apply immediately |
| Reload the page | Choices persisted |
| Object menu → time | Matches the screen for US zones |

### Idle and logo

| Step | Pass |
|---|---|
| Leave it idle past the timeout | Idle screen with logo, clock, prompt |
| Touch it | Wakes to home |
| Set the timeout to 30 s, play something, wait | **Does not** idle out mid-playback |
| Replace `logo.png`, redeploy | New logo everywhere |

### Games

For each of the six: start, play to a finish, restart. Two avatars for the
two-player games. Confirm turn enforcement rejects a move out of turn, and that
an opponent's Rock Paper Scissors pick is not visible before the reveal.

### Failure modes — the important section

| Step | Pass |
|---|---|
| Suspend the backend on Render | "Cloud synchronisation unavailable. Local TV controls remain available." |
| While it is down: clock, settings, idle, object menu, local games | All still work |
| Restore the backend | Reconnects on its own; toast confirms |
| Suspend the database only | TV fully works; saved data reports itself unavailable |
| Restart the region | HTTP-in URL re-registers; TV recovers |
| Take the TV to inventory and re-rez | Settings survive; media resumes **paused**, never playing |
| Change the object's owner | Device secret and permissive mode are cleared |

### Debug mode

Settings → Display → Debug, or `?debug=1`. Should show TV id, media, playback,
sync drift, corrections, viewers, host, backend and WebSocket state, latency,
clock offset, last command and recent errors. **Off by default** — verify that
on a fresh load.
