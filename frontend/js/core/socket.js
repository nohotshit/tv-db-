/**
 * Realtime client.
 *
 * The page has full WebSocket support because MOAP runs a Chromium build. LSL
 * does NOT - there is no WebSocket client in the scripting language - so the
 * in-world object is fed by the backend over HTTP-in instead. That asymmetry
 * is the reason all realtime state flows browser <-> backend here, and the
 * backend mirrors what the object needs to know.
 *
 * Responsibilities:
 *   - connect, authenticate, resubscribe after a drop
 *   - exponential backoff that never gives up (a TV may sit unattended)
 *   - clock offset estimation, so "server time" means the same thing on every
 *     viewer's machine - this is what makes playback sync possible at all
 *   - dispatch inbound events onto the bus
 */

import { config, hasBackend } from './config.js';
import { state, patch, applyServer } from './state.js';
import { emit } from './bus.js';
import { log } from './log.js';

let ws = null;
let retryIndex = 0;
let retryTimer = null;
let heartbeatTimer = null;
let closedByUs = false;
let offsetSamples = [];

export function connect() {
  if (!hasBackend()) {
    patch({ cloud: { status: 'offline', lastError: 'no-backend' } });
    log.warn('[ws] no backend configured; running local-only');
    return;
  }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

  closedByUs = false;
  patch({ cloud: { status: 'connecting' } });

  const qs = new URLSearchParams({
    tv: config.tvId || '',
    surface: config.surface,
    u: config.userKey || '',
    n: config.userName || '',
    t: config.token || ''
  });

  try {
    ws = new WebSocket(config.wsUrl + '?' + qs.toString());
  } catch (e) {
    log.error('[ws] construction failed:', e.message);
    scheduleRetry();
    return;
  }

  ws.onopen = handleOpen;
  ws.onmessage = handleMessage;
  ws.onclose = handleClose;
  ws.onerror = function () { /* onclose always follows; handled there */ };
}

function handleOpen() {
  retryIndex = 0;
  offsetSamples = [];
  patch({ cloud: { status: 'online', lastError: '', since: Date.now() } });
  log.info('[ws] connected');
  emit('cloud:connected');

  send('hello', {
    tvId: config.tvId,
    surface: config.surface,
    user: config.userKey ? { key: config.userKey, name: config.userName } : null
  });

  // Kick off the clock handshake immediately: sync is meaningless until we
  // know how far this machine's clock is from the server's.
  measureOffset();

  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(function () {
    if (ws && ws.readyState === 1) send('ping', { t: Date.now() });
  }, config.HEARTBEAT_MS);
}

function handleClose(ev) {
  clearInterval(heartbeatTimer);
  ws = null;
  if (closedByUs) return;
  log.warn('[ws] closed', ev && ev.code);
  patch({ cloud: { status: 'offline', lastError: 'disconnected' } });
  emit('cloud:lost', 'disconnected');
  scheduleRetry();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delays = config.WS_RETRY_MS;
  const delay = delays[Math.min(retryIndex, delays.length - 1)];
  retryIndex++;
  log.debug('[ws] retry in', delay, 'ms');
  retryTimer = setTimeout(connect, delay);
}

export function disconnect() {
  closedByUs = true;
  clearTimeout(retryTimer);
  clearInterval(heartbeatTimer);
  if (ws) { try { ws.close(); } catch (e) { /* already gone */ } }
  ws = null;
}

/** Fire-and-forget send. Returns false when the socket is not usable. */
export function send(type, payload) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify({ type: type, payload: payload || {}, sentAt: Date.now() }));
    return true;
  } catch (e) {
    log.warn('[ws] send failed:', e.message);
    return false;
  }
}

export function isConnected() {
  return !!ws && ws.readyState === 1;
}

/* -------------------------------------------------------------------------
   Clock offset estimation
   -------------------------------------------------------------------------
   Standard three-timestamp round trip, repeated a few times, median taken.
   offset = ((t1 - t0) + (t2 - t3)) / 2   where
     t0 = client send, t1 = server receive, t2 = server send, t3 = client recv
   The median rejects the occasional slow round trip, which matters because a
   viewer three sim-hops away can spike to several hundred milliseconds.
   ------------------------------------------------------------------------- */

function measureOffset() {
  let taken = 0;
  const step = function () {
    if (!isConnected() || taken >= config.CLOCK_SAMPLES) return;
    taken++;
    send('time', { t0: Date.now() });
    setTimeout(step, 220);
  };
  step();
}

function recordOffset(t0, t1, t2) {
  const t3 = Date.now();
  const rtt = (t3 - t0) - (t2 - t1);
  const offset = ((t1 - t0) + (t2 - t3)) / 2;

  offsetSamples.push({ offset: offset, rtt: rtt });
  if (offsetSamples.length > config.CLOCK_SAMPLES) offsetSamples.shift();

  const sorted = offsetSamples.slice().sort(function (a, b) { return a.offset - b.offset; });
  const median = sorted[Math.floor(sorted.length / 2)];

  patch({ cloud: { offsetMs: Math.round(median.offset), latencyMs: Math.round(median.rtt) } });
}

/** Server time as this client best understands it. */
export function serverNow() {
  return Date.now() + state.cloud.offsetMs;
}

/* ---- inbound dispatch --------------------------------------------------- */

function handleMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch (e) {
    log.warn('[ws] unparseable frame');
    return;
  }
  const p = msg.payload || {};

  switch (msg.type) {
    case 'time':
      recordOffset(p.t0, p.t1, p.t2);
      break;

    case 'snapshot':
      applyServer(p);
      emit('sync:snapshot', p);
      break;

    case 'sync':
      // A playback command from whoever currently holds control.
      applyServer(p);
      patch({ sync: { lastCommand: p.action || 'state' } });
      emit('sync:command', p);
      break;

    case 'viewers':
      patch({ viewers: p.viewers || [], host: 'host' in p ? p.host : state.host });
      break;

    case 'message':
      patch({ messages: state.messages.concat([p]).slice(-100) });
      emit('message:in', p);
      break;

    case 'game':
      patch({ games: { active: p.game, session: p.session } });
      emit('game:update', p);
      break;

    case 'notice':
      emit('notice', p);
      break;

    case 'pong':
      break;

    case 'error':
      log.warn('[ws] server error:', p.error);
      emit('notice', { level: 'error', title: 'Cloud', message: p.error });
      break;

    default:
      log.debug('[ws] unhandled type', msg.type);
  }
}
