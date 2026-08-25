/**
 * Playback synchronisation engine.
 *
 * WHAT CAN ACTUALLY BE SYNCHRONISED
 * ---------------------------------
 * Full position sync is only possible for media this page itself controls:
 * an HTML5 <audio>/<video> element, or a YouTube IFrame API player. For those
 * we can read currentTime and seek, so we can hold every viewer inside a
 * half-second window.
 *
 * It is NOT possible for a site loaded directly onto the TV prim face
 * (direct mode). Once the MOAP url points at youtube.com or twitch.tv, the
 * page is theirs, not ours: no script of ours runs in it, so there is nothing
 * to read or seek. For those sources "sync" means every viewer is navigated to
 * the same url at the same moment, and the UI says so rather than drawing a
 * fake progress bar.
 *
 * Live streams (Twitch, Kick) self-synchronise at the live edge within a few
 * seconds and cannot be tightened further from outside the player.
 */

import { config } from './config.js';
import { state, patch, canControl } from './state.js';
import { send, serverNow, isConnected } from './socket.js';
import { on, emit } from './bus.js';
import { log } from './log.js';

/**
 * The currently registered player adapter, or null.
 * Adapter contract:
 *   getPositionMs() -> number
 *   getDurationMs() -> number
 *   seekMs(ms)
 *   play() / pause()
 *   setRate(multiplier)   optional; omit for players without rate control
 *   isLive() -> boolean
 *   isSeekable() -> boolean
 */
let adapter = null;
let driftTimer = null;

export function registerPlayer(next) {
  adapter = next;
  if (next) startDriftLoop(); else stopDriftLoop();
}

export function unregisterPlayer(which) {
  if (!which || adapter === which) {
    adapter = null;
    stopDriftLoop();
  }
}

export function hasPositionControl() {
  return !!adapter && adapter.isSeekable && adapter.isSeekable();
}

/* -------------------------------------------------------------------------
   Outbound: local intent -> backend
   -------------------------------------------------------------------------
   The backend is the authority. It re-checks permission on every command, so
   a client that lies about holding control simply gets rejected. We check
   locally too, purely so the UI can grey out controls instead of letting a
   viewer press buttons that will bounce.
   ------------------------------------------------------------------------- */

export function command(action, extra) {
  if (!canControl()) {
    emit('notice', {
      level: 'warn',
      title: 'Not in control',
      message: hintForMode()
    });
    return false;
  }

  const payload = Object.assign({
    tvId: state.tv.id,
    action: action,
    media: state.media.url ? {
      title: state.media.title,
      url: state.media.url,
      source: state.media.source,
      isLive: state.media.isLive
    } : null,
    positionMs: adapter ? Math.round(adapter.getPositionMs()) : state.media.positionMs,
    atServerTime: serverNow(),
    controller: state.me.key || 'screen'
  }, extra || {});

  patch({ sync: { lastCommand: action } });

  if (!isConnected()) {
    // Offline: apply locally so the TV still responds, and say so once.
    applyLocalOnly(action, payload);
    emit('notice', {
      level: 'warn',
      title: 'Cloud synchronisation unavailable',
      message: 'Local TV controls remain available. Other viewers will not follow.'
    });
    return false;
  }

  send('sync', payload);
  return true;
}

function hintForMode() {
  const mode = state.tv.permissionMode;
  if (mode === 'owner') return 'Only the owner can control this TV.';
  if (mode === 'group') return 'Only group members can control this TV.';
  if (mode === 'host') {
    return state.host
      ? 'The host is ' + state.host.name + '. Ask them to hand over control.'
      : 'No host has been assigned yet.';
  }
  return 'You do not have control of this TV right now.';
}

function applyLocalOnly(action, payload) {
  if (action === 'play')  { patch({ media: { playback: 'playing' } }); if (adapter) adapter.play(); }
  if (action === 'pause') { patch({ media: { playback: 'paused' } });  if (adapter) adapter.pause(); }
  if (action === 'stop')  { patch({ media: { playback: 'stopped', positionMs: 0 } }); if (adapter) { adapter.pause(); adapter.seekMs(0); } }
  if (action === 'seek' && adapter) adapter.seekMs(payload.positionMs);
}

/* -------------------------------------------------------------------------
   Inbound: authoritative state -> local player
   ------------------------------------------------------------------------- */

on('sync:command', applyRemote);
on('sync:snapshot', applyRemote);

function applyRemote(cmd) {
  if (!state.settings.syncEnabled) return;
  if (!adapter) return;                     // direct mode, or no media mounted

  const target = targetPositionMs(cmd);

  if (cmd.playback === 'playing' || cmd.action === 'play') {
    adapter.seekMs(target);
    adapter.play();
  } else if (cmd.playback === 'paused' || cmd.action === 'pause') {
    adapter.pause();
    adapter.seekMs(target);
  } else if (cmd.playback === 'stopped' || cmd.action === 'stop') {
    adapter.pause();
    adapter.seekMs(0);
  } else if (cmd.action === 'seek') {
    adapter.seekMs(target);
  }
}

/**
 * Where the media should be right now, given where it was when the server
 * stamped the command and how long ago that was in server time.
 */
function targetPositionMs(cmd) {
  const base = typeof cmd.positionMs === 'number' ? cmd.positionMs : state.media.positionMs;
  const playing = cmd.playback === 'playing' || cmd.action === 'play';
  if (!playing || !cmd.atServerTime) return base;
  const elapsed = serverNow() - cmd.atServerTime;
  return Math.max(0, base + Math.max(0, elapsed));
}

/* -------------------------------------------------------------------------
   Drift correction
   -------------------------------------------------------------------------
   Runs once a second while a player is mounted.

     drift < SYNC_TOLERANCE (0.5s)   do nothing - correcting here would be
                                     more visible than the error
     0.5s .. 2.0s                    nudge playbackRate by +/-3% and glide
                                     back over a few seconds. Inaudible.
     > 2.0s                          hard seek. Visible, but so is being two
                                     seconds behind everyone else.

   Live streams are skipped entirely: there is no meaningful position to
   correct towards, and seeking a live edge just rebuffers.
   ------------------------------------------------------------------------- */

function startDriftLoop() {
  stopDriftLoop();
  driftTimer = setInterval(tickDrift, 1000);
}

function stopDriftLoop() {
  if (driftTimer) clearInterval(driftTimer);
  driftTimer = null;
}

function tickDrift() {
  if (!adapter || !state.settings.syncEnabled) return;
  if (state.media.playback !== 'playing') return;
  if (adapter.isLive && adapter.isLive()) {
    patch({ sync: { driftS: 0 } });
    return;
  }
  if (!state.media.atServerTime && !state.media.updatedAtServer) return;

  const expected = targetPositionMs({
    positionMs: state.media.positionMs,
    atServerTime: state.media.updatedAtServer,
    playback: 'playing'
  });
  const actual = adapter.getPositionMs();
  const driftS = (actual - expected) / 1000;

  patch({ sync: { driftS: Math.round(driftS * 100) / 100 } });

  const tolerance = state.settings.syncToleranceS || config.SYNC_TOLERANCE_S;
  const abs = Math.abs(driftS);

  if (abs < tolerance) {
    if (adapter.setRate) adapter.setRate(1);
    return;
  }

  if (abs > config.SYNC_DRIFT_HARD_S || !adapter.setRate) {
    log.info('[sync] hard seek, drift', driftS.toFixed(2), 's');
    adapter.seekMs(expected);
    if (adapter.setRate) adapter.setRate(1);
    patch({ sync: { corrections: state.sync.corrections + 1 } });
    return;
  }

  // Behind -> speed up slightly; ahead -> slow down slightly.
  const rate = driftS < 0 ? 1 + config.SYNC_RATE_NUDGE : 1 - config.SYNC_RATE_NUDGE;
  adapter.setRate(rate);
  patch({ sync: { corrections: state.sync.corrections + 1 } });
}

/** Ask the backend for a fresh snapshot - the HUD Sync button. */
export function resync() {
  if (!isConnected()) {
    emit('notice', { level: 'warn', title: 'Offline', message: 'Cannot resynchronise while the cloud is unreachable.' });
    return false;
  }
  send('resync', { tvId: state.tv.id });
  emit('notice', { level: 'ok', title: 'Synchronising', message: 'Requesting current state from the cloud.' });
  return true;
}
