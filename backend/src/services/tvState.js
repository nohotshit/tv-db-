'use strict';
/**
 * Authoritative TV state.
 *
 * This is the single source of truth for what is playing, who is here and who
 * is in control. Clients send INTENT; this module decides what actually
 * happened and broadcasts the result. Nothing a browser sends is trusted:
 * a page can claim to be the host as loudly as it likes and `canControl` will
 * still say no.
 *
 * Live state is held in memory because it changes several times a second when
 * people are using the TV, and a database round trip per play button press
 * would be pure cost. It is written through to Postgres on meaningful changes
 * so a restart - which on Render free tier happens whenever the service sleeps
 * - resumes where it left off.
 */

const sessionsRepo = require('../db/repos/sessions');
const devicesRepo = require('../db/repos/devices');
const config = require('../config');
const log = require('../util/log');

/** tvId -> state */
const tvs = new Map();

function blank(tvId) {
  return {
    tvId: tvId,
    name: 'Smart TV',
    ownerKey: null,
    ownerName: '',
    region: '',
    permissionMode: 'owner',
    groupKey: null,

    media: {
      title: '', url: '', source: '', playback: 'idle',
      positionMs: 0, durationMs: 0, isLive: false, external: false,
      updatedAtServer: Date.now(), controller: ''
    },

    // Which section everyone is looking at.
    //
    // Without this the "shared" screen is not shared: the prim carries one
    // url, but every viewer runs their own copy of the page, so one person
    // opening Games leaves everybody else on Home. The url is common; the
    // view was not.
    view: 'home',
    viewParams: {},

    queue: [],
    queueIndex: -1,
    queueLocked: false,
    repeat: 'off',
    shuffle: false,

    host: null,               // { key, name, since }
    viewers: new Map(),       // key -> { key, name, seen, surface, inGroup }
    messages: [],             // transient, session only
    game: null,               // { game, seats, state }

    lastCommandAt: 0,
    bucket: null,          // command rate limiter, see takeToken
    dirty: false
  };
}

function get(tvId) {
  if (!tvId) return null;
  if (!tvs.has(tvId)) tvs.set(tvId, blank(tvId));
  return tvs.get(tvId);
}

function has(tvId) {
  return tvs.has(tvId);
}

function all() {
  return Array.from(tvs.values());
}

/* -------------------------------------------------------------------------
   Permission
   -------------------------------------------------------------------------
   The one place control is decided. Every mutating path calls this, and it
   deliberately takes the identity the SERVER established, never one the client
   asserted.

   Group membership is the interesting case: only the in-world script can know
   whether an avatar shares the object group, because that information exists
   only in Second Life. The object tells us when it reports a viewer, we store
   the answer, and we re-check against the stored answer. We never take a
   browser word for it.
   ------------------------------------------------------------------------- */

function canControl(tv, userKey) {
  if (!tv) return false;

  // The shared TV screen has no identity. It may control the TV only when the
  // owner has opened it to everyone; otherwise control needs the HUD.
  if (!userKey || userKey === 'screen') return tv.permissionMode === 'everyone';

  if (tv.ownerKey && userKey === tv.ownerKey) return true;

  switch (tv.permissionMode) {
    case 'everyone':
      return true;
    case 'group': {
      const viewer = tv.viewers.get(userKey);
      return !!(viewer && viewer.inGroup);
    }
    case 'host':
      return !!(tv.host && tv.host.key === userKey);
    case 'owner':
    default:
      return false;
  }
}

function roleOf(tv, userKey) {
  if (!tv || !userKey) return 'viewer';
  if (tv.ownerKey && userKey === tv.ownerKey) return 'owner';
  if (tv.host && tv.host.key === userKey) return 'host';
  return 'viewer';
}

/** Claim or release the host seat. */
function setHost(tv, user, action) {
  if (action === 'release') {
    if (tv.host && user && tv.host.key !== user.key && !(tv.ownerKey === user.key)) {
      return { ok: false, error: 'Only the host or the owner can release control.' };
    }
    tv.host = null;
    tv.dirty = true;
    return { ok: true, host: null };
  }

  if (tv.permissionMode === 'owner' && tv.ownerKey !== user.key) {
    return { ok: false, error: 'This TV is set to owner only.' };
  }
  if (tv.permissionMode === 'group') {
    const viewer = tv.viewers.get(user.key);
    if (!viewer || !viewer.inGroup) {
      return { ok: false, error: 'This TV is set to group members only.' };
    }
  }
  if (tv.host && tv.host.key !== user.key && tv.ownerKey !== user.key) {
    return { ok: false, error: tv.host.name + ' currently has control.' };
  }

  tv.host = { key: user.key, name: user.name || 'Resident', since: Date.now() };
  tv.dirty = true;
  return { ok: true, host: tv.host };
}

/* -------------------------------------------------------------------------
   Playback
   ------------------------------------------------------------------------- */

const ACTIONS = ['play', 'pause', 'stop', 'seek', 'select', 'state'];

/**
 * Apply a playback command. Returns { ok, media } or { ok:false, error }.
 * `user` is the identity the server established, not one the client claimed.
 */
function applyCommand(tv, user, cmd) {
  if (!cmd || ACTIONS.indexOf(cmd.action) < 0) {
    return { ok: false, error: 'Unknown action.' };
  }
  if (!canControl(tv, user && user.key)) {
    return { ok: false, error: 'You do not have control of this TV.' };
  }

  // Flood guard, as a token bucket rather than a minimum gap between commands.
  //
  // A blanket "ignore anything within 100ms" rule looks reasonable and is
  // quietly wrong: legitimate pairs arrive back to back all the time. Picking a
  // station sends `select` then `play`; two people can press pause within the
  // same tick. Dropping the second one - silently, worst of all - would leave
  // the TV stuck buffering with no indication why.
  //
  // The bucket absorbs those bursts and only refuses a sustained flood, and it
  // refuses out loud so the caller can show something.
  const now = Date.now();
  if (!takeToken(tv, now)) {
    return { ok: false, error: 'Too many commands at once. Try again in a moment.' };
  }
  tv.lastCommandAt = now;

  const m = tv.media;

  if (cmd.action === 'select' && cmd.media) {
    m.title = String(cmd.media.title || '').slice(0, 200);
    m.url = String(cmd.media.url || '').slice(0, 1000);
    m.source = String(cmd.media.source || 'web').slice(0, 24);
    m.isLive = !!cmd.media.isLive;
    m.durationMs = Number(cmd.media.durationMs) || 0;
    m.positionMs = 0;
    m.playback = 'buffering';
  } else if (cmd.action === 'play') {
    m.playback = 'playing';
    if (typeof cmd.positionMs === 'number') m.positionMs = Math.max(0, cmd.positionMs);
  } else if (cmd.action === 'pause') {
    m.positionMs = extrapolate(m);
    m.playback = 'paused';
  } else if (cmd.action === 'stop') {
    m.playback = 'stopped';
    m.positionMs = 0;
  } else if (cmd.action === 'seek') {
    m.positionMs = Math.max(0, Number(cmd.positionMs) || 0);
  }

  m.updatedAtServer = now;
  m.controller = (user && user.key) || 'screen';
  tv.dirty = true;

  return { ok: true, media: Object.assign({}, m) };
}

/**
 * Per-TV token bucket: capacity 12, refilled at 6 per second.
 * Comfortably above any human or UI burst, far below a runaway loop.
 */
function takeToken(tv, now) {
  const b = tv.bucket || (tv.bucket = { tokens: 12, at: now });
  b.tokens = Math.min(12, b.tokens + ((now - b.at) / 1000) * 6);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Where the media is right now, if it has been playing since the last stamp.
 * The clients do this too; doing it here means a late joiner gets a correct
 * position in its very first snapshot rather than after the first correction.
 */
function extrapolate(media) {
  if (media.playback !== 'playing' || media.isLive) return media.positionMs;
  const elapsed = Date.now() - media.updatedAtServer;
  return Math.max(0, media.positionMs + Math.max(0, elapsed));
}

/**
 * Change the section every viewer is showing.
 *
 * Permission-checked exactly like playback: changing what the room is looking
 * at is a control action, not a personal preference. A viewer without control
 * can still browse their own HUD screen freely - that surface is theirs.
 */
function setView(tv, user, view, params) {
  if (!canControl(tv, user && user.key)) {
    return { ok: false, error: 'You do not have control of this TV.' };
  }
  const name = String(view || 'home').slice(0, 32);
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return { ok: false, error: 'Unknown section.' };

  tv.view = name;
  tv.viewParams = (params && typeof params === 'object') ? params : {};
  tv.dirty = true;
  return { ok: true, view: name };
}

/** Record that the TV face has been handed to an external site. */
function setExternal(tv, url, meta) {
  tv.media.external = true;
  tv.media.url = String(url || '').slice(0, 1000);
  tv.media.title = String((meta && meta.title) || '').slice(0, 200);
  tv.media.source = String((meta && meta.source) || 'web').slice(0, 24);
  tv.media.isLive = !!(meta && meta.isLive);
  tv.media.playback = 'playing';
  tv.media.positionMs = 0;
  tv.media.updatedAtServer = Date.now();
  tv.dirty = true;
}

function returnToApp(tv) {
  tv.media.external = false;
  tv.media.updatedAtServer = Date.now();
  tv.dirty = true;
}

/* -------------------------------------------------------------------------
   Queue
   ------------------------------------------------------------------------- */

function queueOp(tv, user, op) {
  const controls = canControl(tv, user && user.key);
  const isOwner = tv.ownerKey && user && tv.ownerKey === user.key;

  // A locked queue is the host way of saying "no more requests". Adding is
  // the only operation ordinary viewers ever get, and only while unlocked.
  if (op.action === 'add') {
    if (tv.queueLocked && !controls) return { ok: false, error: 'The queue is locked.' };
    if (tv.queue.length >= 50) return { ok: false, error: 'The queue is full.' };
    tv.queue.push({
      id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: String(op.title || '').slice(0, 200),
      url: String(op.url || '').slice(0, 1000),
      source: String(op.source || 'web').slice(0, 24),
      addedBy: (user && user.name) || 'Screen',
      addedAt: Date.now()
    });
    tv.dirty = true;
    return { ok: true };
  }

  if (!controls) return { ok: false, error: 'You do not have control of this TV.' };

  const index = tv.queue.findIndex(function (q) { return q.id === op.id; });

  switch (op.action) {
    case 'remove':
      if (index < 0) return { ok: false, error: 'Not in the queue.' };
      tv.queue.splice(index, 1);
      if (tv.queueIndex >= index) tv.queueIndex--;
      break;

    case 'up':
      if (index <= 0) return { ok: false, error: 'Already first.' };
      swap(tv.queue, index, index - 1);
      break;

    case 'down':
      if (index < 0 || index >= tv.queue.length - 1) return { ok: false, error: 'Already last.' };
      swap(tv.queue, index, index + 1);
      break;

    case 'next': {
      // Move this entry to immediately after whatever is playing now.
      if (index < 0) return { ok: false, error: 'Not in the queue.' };
      const item = tv.queue.splice(index, 1)[0];
      const target = Math.min(tv.queue.length, Math.max(0, tv.queueIndex + 1));
      tv.queue.splice(target, 0, item);
      break;
    }

    case 'clear':
      tv.queue = [];
      tv.queueIndex = -1;
      break;

    case 'shuffle':
      shuffleInPlace(tv.queue);
      break;

    case 'repeat':
      tv.repeat = ['off', 'one', 'all'].indexOf(op.value) >= 0 ? op.value : 'off';
      break;

    case 'lock':
      if (!isOwner && tv.permissionMode !== 'host') {
        return { ok: false, error: 'Only the owner or host can lock the queue.' };
      }
      tv.queueLocked = !!op.value;
      break;

    default:
      return { ok: false, error: 'Unknown queue action.' };
  }

  tv.dirty = true;
  return { ok: true };
}

function swap(arr, a, b) {
  const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    swap(arr, i, j);
  }
}

/* -------------------------------------------------------------------------
   Presence
   -------------------------------------------------------------------------
   Two sources feed this, and they mean different things:

     - the object reports avatars it detects on the parcel. That is who is
       physically at the TV, and it carries the group flag we cannot learn
       any other way.
     - a HUD or screen connecting over WebSocket reports itself. That is who
       has the interface open.

   Someone can be in one list and not the other, which is fine and correct.
   Entries expire so a viewer that walks away or closes the HUD disappears
   without needing a goodbye message.
   ------------------------------------------------------------------------- */

function touchViewer(tv, viewer) {
  if (!viewer || !viewer.key) return;
  const existing = tv.viewers.get(viewer.key) || {};
  tv.viewers.set(viewer.key, {
    key: viewer.key,
    name: viewer.name || existing.name || 'Resident',
    surface: viewer.surface || existing.surface || 'tv',
    inGroup: typeof viewer.inGroup === 'boolean' ? viewer.inGroup : !!existing.inGroup,
    seen: Date.now()
  });
}

function replaceDetected(tv, list) {
  const now = Date.now();
  (list || []).forEach(function (v) {
    if (!v || !v.key) return;
    touchViewer(tv, { key: v.key, name: v.name, inGroup: v.inGroup, surface: 'inworld' });
  });
  // Drop in-world entries the object no longer reports.
  const present = new Set((list || []).map(function (v) { return v.key; }));
  tv.viewers.forEach(function (v, key) {
    if (v.surface === 'inworld' && !present.has(key)) tv.viewers.delete(key);
    else if (now - v.seen > config.presenceTtlMs) tv.viewers.delete(key);
  });

  // A host who has left cannot keep holding control.
  if (tv.host && !tv.viewers.has(tv.host.key)) {
    log.info('[tv] host', tv.host.name, 'left; releasing control on', tv.tvId);
    tv.host = null;
    tv.dirty = true;
  }
}

function expireViewers(tv) {
  const now = Date.now();
  let changed = false;
  tv.viewers.forEach(function (v, key) {
    if (now - v.seen > config.presenceTtlMs) { tv.viewers.delete(key); changed = true; }
  });
  return changed;
}

function viewerList(tv) {
  return Array.from(tv.viewers.values()).map(function (v) {
    return { key: v.key, name: v.name, surface: v.surface, inGroup: !!v.inGroup };
  });
}

/* -------------------------------------------------------------------------
   Snapshots and persistence
   ------------------------------------------------------------------------- */

/**
 * The complete authoritative picture, as sent to browsers.
 *
 * `positionMs` is extrapolated to now and stamped with the server clock, so a
 * client that joins mid-programme lands in the right place immediately instead
 * of starting at zero and being corrected a second later.
 */
function snapshot(tv) {
  const media = Object.assign({}, tv.media, {
    positionMs: extrapolate(tv.media),
    updatedAtServer: Date.now()
  });

  return {
    tv: {
      id: tv.tvId,
      name: tv.name,
      ownerKey: tv.ownerKey,
      region: tv.region,
      permissionMode: tv.permissionMode,
      queueLocked: tv.queueLocked,
      powered: true
    },
    media: media,
    view: tv.view,
    viewParams: tv.viewParams,
    queue: tv.queue,
    queueIndex: tv.queueIndex,
    repeat: tv.repeat,
    shuffle: tv.shuffle,
    viewers: viewerList(tv),
    host: tv.host,
    games: tv.game ? { active: tv.game.game, session: redactGame(tv.game) } : { active: null, session: null },
    serverTime: Date.now()
  };
}

/**
 * Strip hidden information before a game state leaves the server.
 *
 * Keys beginning with an underscore are secrets by convention - the number
 * guessing answer, for one - and an unrevealed Rock Paper Scissors pick must
 * not be readable by the opponent from the browser console.
 */
function redactGame(game) {
  if (!game) return null;
  const state = {};
  Object.keys(game.state || {}).forEach(function (k) {
    if (k.charAt(0) === '_') return;
    state[k] = game.state[k];
  });

  if (game.game === 'rps' && state.picks && !state.revealed) {
    state.picks = state.picks.map(function (p) { return p ? 'hidden' : null; });
  }

  return { game: game.game, seats: game.seats, state: state };
}

/** The compact form sent to the object. LSL caps a response body at 2048
 *  bytes, so this stays small on purpose. */
function lslSnapshot(tv) {
  return {
    st: tv.media.playback,
    src: tv.media.source,
    url: tv.media.url.slice(0, 900),
    ttl: tv.media.title.slice(0, 60),
    pos: Math.round(extrapolate(tv.media) / 1000),
    ext: tv.media.external ? 1 : 0,
    host: tv.host ? tv.host.name.slice(0, 40) : '',
    n: tv.viewers.size,
    mode: tv.permissionMode
  };
}

/* ---- write-through persistence ----------------------------------------- */

/**
 * Flush dirty TVs to Postgres.
 *
 * Called on a slow interval rather than on every change: playback state
 * changes many times a minute while people are using the TV, and none of those
 * intermediate states matter after a restart. If the database is unavailable
 * the write simply does not happen and the TV carries on.
 */
async function flush() {
  for (const tv of tvs.values()) {
    if (!tv.dirty) continue;
    tv.dirty = false;
    await sessionsRepo.save(tv.tvId, {
      hostKey: tv.host ? tv.host.key : null,
      hostName: tv.host ? tv.host.name : '',
      media: tv.media,
      source: tv.media.source,
      playback: tv.media.playback,
      positionMs: extrapolate(tv.media),
      positionAt: Date.now(),
      queue: tv.queue,
      queueIndex: tv.queueIndex,
      queueLocked: tv.queueLocked
    });
  }
}

/** Restore a TV from the database the first time it is asked for. */
async function hydrate(tvId) {
  const tv = get(tvId);
  if (tv._hydrated) return tv;
  tv._hydrated = true;

  const device = await devicesRepo.get(tvId);
  if (device) {
    tv.name = device.name;
    tv.ownerKey = device.owner_key;
    tv.ownerName = device.owner_name;
    tv.region = device.region;
    tv.permissionMode = device.permission_mode;
    tv.groupKey = device.group_key;
  }

  const row = await sessionsRepo.get(tvId);
  if (row) {
    const media = row.current_media || {};
    tv.media = Object.assign(tv.media, media, {
      playback: row.playback_state,
      positionMs: Number(row.position_ms) || 0,
      updatedAtServer: row.position_at ? new Date(row.position_at).getTime() : Date.now(),
      // Never resume as "playing": nobody is watching a restarted backend, and
      // resuming playback into an empty room is worse than starting paused.
      external: false
    });
    if (tv.media.playback === 'playing') tv.media.playback = 'paused';
    tv.queue = Array.isArray(row.queue) ? row.queue : [];
    tv.queueIndex = row.queue_index;
    tv.queueLocked = row.queue_locked;
    if (row.host_key) tv.host = { key: row.host_key, name: row.host_name, since: Date.now() };
  }

  return tv;
}

module.exports = {
  get, has, all, hydrate, flush, snapshot, lslSnapshot, redactGame,
  canControl, roleOf, setHost, applyCommand, extrapolate,
  setExternal, returnToApp, queueOp, setView,
  touchViewer, replaceDetected, expireViewers, viewerList
};
