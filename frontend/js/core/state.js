/**
 * Central state store.
 *
 * One object, shallow-merged patches, key-scoped subscriptions. Views never
 * mutate `state` directly - they call `patch()` (local intent) or receive a
 * server snapshot via `applyServer()`.
 *
 * Authority rule: anything under `state.media`, `state.queue`, `state.host`
 * and `state.viewers` is OWNED BY THE BACKEND. Local edits are optimistic
 * only, and a server snapshot always wins. The backend re-checks permission on
 * every mutation, so a client that lies about being host changes nothing.
 */

import { log } from './log.js';

const subscribers = [];

export const state = {
  // ---- navigation ------------------------------------------------------
  view: 'home',
  viewParams: {},
  history: [],

  // ---- this TV ---------------------------------------------------------
  tv: {
    id: '',
    name: 'Smart TV',
    powered: true,
    permissionMode: 'owner',      // owner | group | everyone | host
    queueLocked: false,
    region: ''
  },

  // ---- playback (server-owned) ----------------------------------------
  media: {
    title: '',
    url: '',
    source: '',                   // youtube | twitch | kick | music | web | movies
    playback: 'idle',             // idle | playing | paused | stopped | buffering
    positionMs: 0,
    durationMs: 0,
    isLive: false,
    external: false,              // true when the TV face left our app (direct mode)
    updatedAtServer: 0,
    controller: ''
  },

  queue: [],
  queueIndex: -1,
  repeat: 'off',                  // off | one | all
  shuffle: false,

  // ---- people (server-owned) ------------------------------------------
  viewers: [],
  host: null,

  // ---- this client -----------------------------------------------------
  me: { key: '', name: '', role: 'viewer' },   // viewer | host | owner

  // ---- audio -----------------------------------------------------------
  volume: 80,
  muted: false,

  // ---- connectivity ----------------------------------------------------
  cloud: {
    status: 'offline',            // offline | connecting | online | degraded
    latencyMs: null,
    offsetMs: 0,
    lastError: '',
    since: 0
  },

  sync: {
    enabled: true,
    toleranceS: 0.5,
    driftS: 0,
    corrections: 0,
    lastCommand: ''
  },

  // ---- user data -------------------------------------------------------
  favorites: [],
  historyItems: [],
  messages: [],
  games: { active: null, session: null },

  // ---- preferences -----------------------------------------------------
  settings: {
    timezone: 'America/New_York',
    timeFormat: '12',             // 12 | 24
    showSeconds: false,
    dateFormat: 'MM/DD/YYYY',
    theme: 'brand',
    uiScale: 1,
    brightness: 1,
    idleEnabled: true,
    idleTimeoutS: 300,
    autoplay: true,
    resume: true,
    defaultSource: 'home',
    browserHome: '',
    moviesUrl: '',
    syncEnabled: true,
    syncToleranceS: 0.5,
    messagingEnabled: true,
    detectionRangeM: 20,
    notifications: true,
    debug: false
  },

  ui: { idle: false, booted: false, modal: null }
};

/**
 * Subscribe to changes.
 *   subscribe(fn)                  - every change
 *   subscribe('media', fn)         - only when `media` is patched
 *   subscribe(['media','host'], fn)
 * Returns an unsubscribe function.
 */
export function subscribe(keys, fn) {
  if (typeof keys === 'function') { fn = keys; keys = null; }
  const entry = {
    keys: keys ? (Array.isArray(keys) ? keys : [keys]) : null,
    fn: fn
  };
  subscribers.push(entry);
  return function unsubscribe() {
    const i = subscribers.indexOf(entry);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

/**
 * Shallow-merge a patch. Nested plain objects listed in DEEP are merged one
 * level so callers can write patch({ media: { playback: 'playing' } }) without
 * clobbering the rest of media.
 */
const DEEP = ['tv', 'media', 'me', 'cloud', 'sync', 'settings', 'ui', 'games'];

export function patch(delta) {
  if (!delta) return;
  const changed = [];

  Object.keys(delta).forEach(function (key) {
    const next = delta[key];
    if (DEEP.indexOf(key) >= 0 && next && typeof next === 'object' && !Array.isArray(next)) {
      const target = state[key];
      let dirty = false;
      Object.keys(next).forEach(function (k) {
        if (target[k] !== next[k]) { target[k] = next[k]; dirty = true; }
      });
      if (dirty) changed.push(key);
    } else if (state[key] !== next) {
      state[key] = next;
      changed.push(key);
    }
  });

  if (changed.length) notify(changed);
}

function notify(changed) {
  subscribers.slice().forEach(function (s) {
    if (s.keys && !s.keys.some(function (k) { return changed.indexOf(k) >= 0; })) return;
    try {
      s.fn(state, changed);
    } catch (err) {
      log.error('[state] subscriber threw:', err.message);
    }
  });
}

/**
 * Apply an authoritative snapshot from the backend. Only the server-owned
 * slices are touched; local preferences and navigation are never overwritten
 * by another client.
 */
export function applyServer(snapshot) {
  if (!snapshot) return;
  const delta = {};
  if (snapshot.media)   delta.media = snapshot.media;
  if (snapshot.queue)   { delta.queue = snapshot.queue; }
  if (typeof snapshot.queueIndex === 'number') delta.queueIndex = snapshot.queueIndex;
  if (snapshot.viewers) delta.viewers = snapshot.viewers;
  if ('host' in snapshot) delta.host = snapshot.host;
  if (snapshot.tv)      delta.tv = snapshot.tv;
  if (snapshot.repeat)  delta.repeat = snapshot.repeat;
  if (typeof snapshot.shuffle === 'boolean') delta.shuffle = snapshot.shuffle;
  if (snapshot.games)   delta.games = snapshot.games;
  patch(delta);
  recomputeRole();
}

/** Derive our own role from the current host + permission mode. */
export function recomputeRole() {
  const me = state.me.key;
  let role = 'viewer';
  if (!me) role = 'viewer';
  else if (state.tv.ownerKey && state.tv.ownerKey === me) role = 'owner';
  else if (state.host && state.host.key === me) role = 'host';
  if (state.me.role !== role) patch({ me: { role: role } });
}

/** Can this client issue control commands right now? */
export function canControl() {
  const mode = state.tv.permissionMode;
  if (state.me.role === 'owner') return true;
  if (mode === 'everyone') return true;
  if (mode === 'host') return state.me.role === 'host';
  if (mode === 'group') return !!state.me.inGroup;
  return state.me.role === 'owner';
}
