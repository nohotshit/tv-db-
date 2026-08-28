# Playback synchronisation

Everyone watching the TV sees roughly the same moment of the video, including
someone who arrives after it started.

## The model: broadcast an anchor, not a position

The shared state is four values:

| Field | Meaning |
|---|---|
| `video` | what is playing |
| `startedAt` | the Unix second at which **position 0** occurred |
| `state` | `playing` \| `paused` \| `stopped` |
| `pausedAt` | position, while paused |

Nobody is ever told where to be. Each viewer computes it:

```
position = now - startedAt      (playing)
position = pausedAt             (paused)
```

A video anchored at Unix 1000, opened by a viewer at Unix 1300, is at **300
seconds**. That viewer derived it alone, from a value that has not changed
since playback began. Nothing was sent to them, and nobody else was disturbed.

## Why this shape, for Second Life specifically

The anchor changes only when someone presses a button. Between presses the
in-world script does *nothing*: no timer, no listener, no chat, no polling, no
per-viewer bookkeeping. Twenty people watching a two-hour film cost the same as
one person watching it.

The obvious alternative — broadcasting the current position a few times a
second — costs more the more people are watching, which is precisely backwards
for a region with a crowd in it. It is also unnecessary: position is a pure
function of the clock, and everyone already has a clock.

The anchor rides in the MOAP url, so a page load carries the sync state with
it. A late joiner is correct on its **first frame** — no request, no round
trip, no visible seek from zero.

## Clocks

`startedAt` is in Unix seconds, which `llGetUnixTime()` and `Date.now()` both
speak. Machine clocks are NTP-disciplined and typically agree within a second,
so the local clock is used directly.

Deliberately *not* done: passing "the time this url was built" and deriving an
offset from it. That folds page load time — often several seconds, and highly
variable — into every later calculation. Trusting an NTP clock is the more
accurate of the two. `setClockOffset()` refines it when a server time source is
available.

## Drift correction

A player left alone wanders: buffering stalls it, a slow machine drops frames,
clocks disagree slightly. Correction is graded, because the cure is easily
worse than the disease — a seek every few seconds is far more irritating than
being half a second out.

| Drift | Action | Why |
|---|---|---|
| under 0.5 s | nothing | Nobody can see this. Correcting it is visible where the error is not. |
| 0.5 – 2.0 s | nudge `playbackRate` ±3% | Glides back over a few seconds. Inaudible on speech and music, invisible on video. |
| over 2.0 s | seek | Abrupt, but so is being two seconds behind the room. |

Checked every 4 seconds, on one timer, regardless of audience size. Live
streams are skipped entirely: there is no meaningful position to correct
towards, and seeking a live edge only triggers a rebuffer.

## Files

| File | Role |
|---|---|
| `second-life/tv/sync_epoch.lsl` | Holds the anchor, publishes it in the MOAP url |
| `frontend/js/core/epoch-sync.js` | Computes position, corrects drift |

The JavaScript has no dependency on the rest of the TV. `createSync(adapter)`
works with anything exposing `getPosition / seek / play / pause`, and
`mediaElementAdapter(el)` wraps a plain `<video>` or `<audio>`.

## Commands

Send to `sync_epoch.lsl` on link message **160**:

```
play          resume from where it was, never from zero
pause         freeze at the current position
stop          back to 0
toggle        play or pause
seek|<secs>
select|<video>              start a new video at 0
select|<video>;<duration>   with duration, enabling end handling and looping
republish     re-assert the anchor onto the face
```

## What this does not do

It cannot synchronise a site loaded directly onto the prim — YouTube, Twitch,
a film site. Once the media face shows someone else's page, no script of ours
runs inside it, so there is nothing to read or seek. This applies to media the
TV plays itself: HTML5 `<video>` / `<audio>`, and embedded players that expose
a position API.

Live streams cannot be position-synchronised by anyone. Viewers sit near the
live edge within a few seconds of each other, and that spread is inside the
player where nothing outside can reach it.
