/**
 * Epoch synchronisation.
 *
 * THE MODEL
 *   The shared state is not a position. It is an ANCHOR:
 *
 *       { videoId, startedAt, state, pausedAt }
 *
 *   `startedAt` is the Unix second at which position 0 of the video occurred.
 *   Every viewer computes its own position from it:
 *
 *       position = now - startedAt          (while playing)
 *       position = pausedAt                 (while paused)
 *
 *   Nobody is ever *told* where to be. A viewer arriving three hundred seconds
 *   late derives 300 on its own, from a value that has not changed since
 *   playback began.
 *
 * WHY THIS SHAPE SUITS SECOND LIFE
 *   The anchor only changes when someone presses a button. Ten people watching
 *   a two hour film generate exactly as much traffic as one person: none after
 *   the initial load. There is no position broadcast, no per-viewer state, no
 *   heartbeat. That is the difference between a TV that works on a busy sim
 *   and one that gets blamed for lag.
 *
 * CLOCKS
 *   `startedAt` is in Unix seconds, which llGetUnixTime() and Date.now() both
 *   speak. Machine clocks are NTP-disciplined and typically agree within a
 *   second, so the local clock is used directly by default.
 *
 *   Deliberately NOT done: passing "the time when this url was built" and
 *   deriving an offset from it. That folds the page load time - often several
 *   seconds, and highly variable - into every future calculation. Trusting an
 *   NTP clock is the more accurate of the two.
 *
 *   When a server time source is available, `setClockOffset()` refines it.
 */

const DEFAULTS = {
  toleranceS: 0.5,      // below this, leave it alone
  hardSeekS: 2.0,       // above this, seek rather than glide
  rateNudge: 0.03,      // +/- 3%: inaudible, invisible on video
  checkEveryMs: 4000    // drift check interval
};

/* -------------------------------------------------------------------------
   Clock
   ------------------------------------------------------------------------- */

let clockOffsetS = 0;

/** Unix seconds as this client understands them. */
export function now() {
  return Date.now() / 1000 + clockOffsetS;
}

/**
 * Refine the clock against a server. Optional: without it the local NTP clock
 * is used, which is normally within a second.
 */
export function setClockOffset(seconds) {
  if (isFinite(seconds)) clockOffsetS = seconds;
}

export function clockOffset() {
  return clockOffsetS;
}

/* -------------------------------------------------------------------------
   The anchor
   ------------------------------------------------------------------------- */

/**
 * Read the anchor from the MOAP url. LSL writes these when it sets the media,
 * so the state arrives with the page and a late joiner is correct on its very
 * first frame - no request, no round trip, no waiting.
 *
 *   ?v=<videoId>&t0=<startedAt>&st=playing|paused|stopped&p=<pausedAt>&loop=1
 */
export function anchorFromUrl(search) {
  const q = new URLSearchParams(search === undefined ? window.location.search : search);
  const startedAt = Number(q.get('t0'));

  return {
    videoId:   q.get('v') || '',
    startedAt: isFinite(startedAt) ? startedAt : 0,
    state:     q.get('st') || 'stopped',
    pausedAt:  Number(q.get('p')) || 0,
    loop:      q.get('loop') === '1',
    duration:  Number(q.get('d')) || 0
  };
}

/**
 * Where the video should be, right now, for this anchor.
 *
 * This is the whole synchronisation system. Everything else is plumbing.
 */
export function expectedPosition(anchor, atUnix) {
  if (!anchor || anchor.state === 'stopped') return 0;
  if (anchor.state === 'paused') return Math.max(0, anchor.pausedAt);

  const t = (atUnix === undefined ? now() : atUnix);
  let position = t - anchor.startedAt;
  if (position < 0) position = 0;          // anchor is in the future: not started

  // Past the end: loop back round, or sit at the end.
  if (anchor.duration > 0) {
    if (anchor.loop) position = position % anchor.duration;
    else if (position > anchor.duration) position = anchor.duration;
  }
  return position;
}

/**
 * The anchor for "start playing from `position` at this moment".
 *
 * Note what this does NOT do: it never says "seek to 0". Pressing play on a
 * paused video anchors it so that the CURRENT position lands now, which is why
 * a new viewer joining never restarts anything.
 */
export function anchorForPlay(anchor, position, atUnix) {
  const t = (atUnix === undefined ? now() : atUnix);
  const from = position === undefined ? expectedPosition(anchor, t) : position;
  return Object.assign({}, anchor, { state: 'playing', startedAt: t - from });
}

export function anchorForPause(anchor, atUnix) {
  const t = (atUnix === undefined ? now() : atUnix);
  return Object.assign({}, anchor, { state: 'paused', pausedAt: expectedPosition(anchor, t) });
}

export function anchorForStop(anchor) {
  return Object.assign({}, anchor, { state: 'stopped', pausedAt: 0, startedAt: 0 });
}

/* -------------------------------------------------------------------------
   Drift correction
   -------------------------------------------------------------------------
   A player left alone will wander: buffering stalls it, a slow machine drops
   frames, and clocks disagree slightly. Correction is graded, because the cure
   is easily worse than the disease - a seek every few seconds is far more
   annoying than being half a second out.

       under 0.5s   leave it. Nobody can see this, and correcting it is
                    visible where the error is not.
       0.5 - 2.0s   nudge playbackRate by 3% and let it glide back over a few
                    seconds. Inaudible on speech and music, invisible on video.
       over 2.0s    seek. Visibly abrupt, but so is being two seconds behind
                    everyone else in the room.

   Live streams are skipped: there is no meaningful position to correct
   towards, and seeking a live edge only triggers a rebuffer.
   ------------------------------------------------------------------------- */

/**
 * Adapter contract - anything implementing this can be synchronised:
 *
 *   getPosition()      seconds, as a number
 *   seek(seconds)
 *   play() / pause()
 *   setRate(multiplier)   optional; omit and correction falls back to seeking
 *   isLive()              optional; true skips correction entirely
 */
export function createSync(adapter, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});

  let anchor = null;
  let timer = null;
  let corrections = 0;
  let lastDrift = 0;

  function apply() {
    if (!anchor || !adapter) return;
    const target = expectedPosition(anchor);

    if (anchor.state === 'playing') {
      adapter.seek(target);
      adapter.play();
    } else if (anchor.state === 'paused') {
      adapter.pause();
      adapter.seek(target);
    } else {
      adapter.pause();
      adapter.seek(0);
    }
  }

  function check() {
    if (!anchor || !adapter || anchor.state !== 'playing') return;
    if (adapter.isLive && adapter.isLive()) return;

    const expected = expectedPosition(anchor);
    const actual = adapter.getPosition();
    if (!isFinite(actual)) return;

    const drift = actual - expected;
    lastDrift = drift;
    const magnitude = Math.abs(drift);

    if (magnitude < opts.toleranceS) {
      if (adapter.setRate) adapter.setRate(1);
      return;
    }

    if (magnitude > opts.hardSeekS || !adapter.setRate) {
      adapter.seek(expected);
      if (adapter.setRate) adapter.setRate(1);
      corrections++;
      return;
    }

    // Behind: speed up slightly. Ahead: slow down slightly.
    adapter.setRate(drift < 0 ? 1 + opts.rateNudge : 1 - opts.rateNudge);
    corrections++;
  }

  return {
    /** Adopt a new anchor and align the player to it immediately. */
    setAnchor: function (next) {
      anchor = next;
      apply();
      return this;
    },

    /** Start correcting. One timer, whatever the audience size. */
    start: function () {
      if (timer) return this;
      timer = setInterval(check, opts.checkEveryMs);
      return this;
    },

    stop: function () {
      if (timer) clearInterval(timer);
      timer = null;
      if (adapter && adapter.setRate) adapter.setRate(1);
      return this;
    },

    getAnchor: function () { return anchor; },
    expected: function () { return expectedPosition(anchor); },
    stats: function () {
      return { driftS: Math.round(lastDrift * 100) / 100, corrections: corrections };
    }
  };
}

/** Adapter for a plain HTML5 <video> or <audio> element. */
export function mediaElementAdapter(el) {
  return {
    getPosition: function () { return el.currentTime; },
    seek: function (s) { try { el.currentTime = s; } catch (e) { /* not ready */ } },
    play: function () { const p = el.play(); if (p && p.catch) p.catch(function () {}); },
    pause: function () { el.pause(); },
    setRate: function (r) { el.playbackRate = r; },
    isLive: function () { return !isFinite(el.duration) || el.duration === Infinity; }
  };
}

/**
 * Convert the backend's media state into an anchor.
 *
 * The server sends `positionMs` together with `updatedAtServer`, the instant
 * that position was true. That pair IS an anchor wearing different clothes:
 *
 *     startedAt = (updatedAtServer - positionMs) / 1000
 *
 * Expressing it this way means one implementation of the arithmetic for both
 * the url-anchored path and the WebSocket path, instead of two that can drift
 * apart in behaviour.
 */
export function anchorFromServerMedia(media) {
  if (!media) return null;

  const positionS = (Number(media.positionMs) || 0) / 1000;
  const stampS = (Number(media.updatedAtServer) || Date.now()) / 1000;

  let state = 'stopped';
  if (media.playback === 'playing') state = 'playing';
  else if (media.playback === 'paused' || media.playback === 'buffering') state = 'paused';

  return {
    videoId: media.url || '',
    startedAt: stampS - positionS,
    state: state,
    pausedAt: positionS,
    duration: (Number(media.durationMs) || 0) / 1000,
    loop: false,
    isLive: !!media.isLive
  };
}
