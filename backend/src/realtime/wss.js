'use strict';
/**
 * WebSocket layer.
 *
 * Connections come from two kinds of surface and they are NOT equivalent:
 *
 *   surface=tv   the shared TV screen. Anonymous by nature - every avatar in
 *                range loads the same page, so it cannot say who is watching.
 *                It receives everything and may only send control commands
 *                when the TV is set to everyone.
 *
 *   surface=hud  a personal remote, carrying a signed token for one avatar.
 *                This is the only surface that can act as a named person.
 *
 * The server never takes an identity from the message body. It takes it from
 * the token verified at connection time, and re-derives permission on every
 * command.
 */

const { WebSocketServer } = require('ws');
const url = require('url');

const tvState = require('../services/tvState');
const tokens = require('../services/tokens');
const games = require('../services/games');
const lsl = require('../services/lslBridge');
const config = require('../config');
const log = require('../util/log');

/** tvId -> Set<ws> */
const rooms = new Map();
let wss = null;

function attach(server) {
  wss = new WebSocketServer({ server: server, path: '/rt', maxPayload: 64 * 1024 });

  wss.on('connection', function (ws, req) {
    const params = url.parse(req.url, true).query;
    const tvId = String(params.tv || '').slice(0, 64);

    if (!tvId) {
      ws.close(4000, 'tv id required');
      return;
    }

    // Identity comes from the token, never from the query name fields.
    let user = null;
    if (params.t) {
      const claims = tokens.verify(String(params.t));
      if (claims && claims.tvId === tvId) {
        user = { key: claims.key, name: claims.name };
      } else {
        log.warn('[ws] rejected token for', tvId);
      }
    }

    ws.mi = {
      tvId: tvId,
      surface: params.surface === 'hud' ? 'hud' : 'tv',
      user: user,
      alive: true,
      lastMessageAt: 0
    };

    join(tvId, ws);
    log.info('[ws] connected', tvId, ws.mi.surface, user ? user.name : '(anonymous screen)');

    tvState.hydrate(tvId).then(function (tv) {
      if (user) tvState.touchViewer(tv, { key: user.key, name: user.name, surface: ws.mi.surface });
      sendTo(ws, 'snapshot', tvState.snapshot(tv));
      broadcastViewers(tv);
    });

    ws.on('message', function (raw) { onMessage(ws, raw); });
    ws.on('pong', function () { ws.mi.alive = true; });
    ws.on('close', function () { leave(tvId, ws); });
    ws.on('error', function (err) { log.debug('[ws] socket error:', err.message); });
  });

  // Drop sockets that stopped answering. A viewer that crashed or teleported
  // away leaves a half-open connection behind otherwise.
  setInterval(function () {
    wss.clients.forEach(function (ws) {
      if (!ws.mi) return;
      if (!ws.mi.alive) { ws.terminate(); return; }
      ws.mi.alive = false;
      try { ws.ping(); } catch (e) { /* closing anyway */ }
    });
  }, 30000).unref();

  return wss;
}

/* ---- room management ---------------------------------------------------- */

function join(tvId, ws) {
  if (!rooms.has(tvId)) rooms.set(tvId, new Set());
  rooms.get(tvId).add(ws);
}

function leave(tvId, ws) {
  const room = rooms.get(tvId);
  if (!room) return;
  room.delete(ws);
  if (!room.size) rooms.delete(tvId);

  if (ws.mi && ws.mi.user && tvState.has(tvId)) {
    const tv = tvState.get(tvId);
    // Only drop the viewer if no other socket of theirs remains - someone can
    // have both the HUD and the screen open.
    const stillHere = Array.from(room).some(function (other) {
      return other.mi && other.mi.user && other.mi.user.key === ws.mi.user.key;
    });
    if (!stillHere && tv.viewers.get(ws.mi.user.key)
        && tv.viewers.get(ws.mi.user.key).surface !== 'inworld') {
      tv.viewers.delete(ws.mi.user.key);
      broadcastViewers(tv);
    }
  }
  log.debug('[ws] disconnected', tvId);
}

/**
 * Token bucket, per socket.
 *
 * Capacity 20, refilled at 12 per second. A person mashing a remote button, or
 * a view sending a short burst of related commands, passes through untouched.
 * A runaway loop does not.
 */
function allow(ws, now) {
  const b = ws.mi.bucket || (ws.mi.bucket = { tokens: 20, at: now });
  const refill = ((now - b.at) / 1000) * 12;
  b.tokens = Math.min(20, b.tokens + refill);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function sendTo(ws, type, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: type, payload: payload || {}, sentAt: Date.now() }));
  } catch (e) {
    log.debug('[ws] send failed:', e.message);
  }
}

function broadcast(tvId, type, payload, except) {
  const room = rooms.get(tvId);
  if (!room) return;
  const frame = JSON.stringify({ type: type, payload: payload || {}, sentAt: Date.now() });
  room.forEach(function (ws) {
    if (ws === except || ws.readyState !== 1) return;
    try { ws.send(frame); } catch (e) { /* dropped */ }
  });
}

function broadcastViewers(tv) {
  broadcast(tv.tvId, 'viewers', { viewers: tvState.viewerList(tv), host: tv.host });
}

function broadcastSnapshot(tv) {
  broadcast(tv.tvId, 'snapshot', tvState.snapshot(tv));
}

function roomSize(tvId) {
  const room = rooms.get(tvId);
  return room ? room.size : 0;
}

/* -------------------------------------------------------------------------
   Inbound dispatch
   -------------------------------------------------------------------------
   Every branch re-derives the caller identity from ws.mi.user, which was
   established from a verified token at connection time. Nothing in the message
   body is trusted for identity or authority.
   ------------------------------------------------------------------------- */

async function onMessage(ws, raw) {
  if (raw.length > 32 * 1024) { ws.close(1009, 'too large'); return; }

  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return sendTo(ws, 'error', { error: 'Malformed message.' });
  }
  if (!msg || typeof msg.type !== 'string') return;

  // Per-socket rate limit, as a token bucket rather than a minimum gap.
  //
  // A fixed minimum gap silently swallows legitimate input: the music view
  // sends `select` immediately followed by `play`, and a double press of a
  // remote button is a normal thing for a person to do. A bucket absorbs those
  // bursts and only pushes back on a genuine flood - and says so, rather than
  // dropping the command without a word.
  const now = Date.now();
  if (!allow(ws, now)) {
    return sendTo(ws, 'error', { error: 'Slow down - too many commands at once.' });
  }
  ws.mi.lastMessageAt = now;

  const tv = await tvState.hydrate(ws.mi.tvId);
  const user = ws.mi.user;
  const p = msg.payload || {};

  switch (msg.type) {
    case 'hello':
      if (user) {
        tvState.touchViewer(tv, { key: user.key, name: user.name, surface: ws.mi.surface });
        broadcastViewers(tv);
      }
      sendTo(ws, 'snapshot', tvState.snapshot(tv));
      break;

    // Clock handshake. t1 and t2 straddle our own processing so the client can
    // subtract server-side time from the round trip.
    case 'time':
      sendTo(ws, 'time', { t0: p.t0, t1: now, t2: Date.now() });
      break;

    case 'ping':
      sendTo(ws, 'pong', { t: now });
      break;

    case 'resync':
      sendTo(ws, 'snapshot', tvState.snapshot(tv));
      break;

    case 'sync': {
      const result = tvState.applyCommand(tv, user, p);
      if (!result.ok) {
        if (!result.silent) sendTo(ws, 'error', { error: result.error });
        return;
      }
      const snap = tvState.snapshot(tv);
      broadcast(tv.tvId, 'sync', Object.assign({ action: p.action }, snap));
      lsl.state(tv.tvId, tvState.lslSnapshot(tv));
      break;
    }

    // Hand the prim face to an external site, or bring it back.
    case 'moap': {
      if (!tvState.canControl(tv, user && user.key)) {
        return sendTo(ws, 'error', { error: 'You do not have control of this TV.' });
      }
      if (p.action === 'home' || !p.url) {
        tvState.returnToApp(tv);
        broadcastSnapshot(tv);
        // Fire and forget. The bridge has its own retry and queue, and a sim
        // that is restarting must not hold up the browsers - an 8 second fetch
        // timeout would be an 8 second freeze on every screen in the room.
        lsl.home(tv.tvId);
      } else {
        const safe = safeUrl(p.url);
        if (!safe) return sendTo(ws, 'error', { error: 'That address cannot be opened.' });
        tvState.setExternal(tv, safe, p);
        broadcastSnapshot(tv);
        lsl.navigate(tv.tvId, safe, p);
      }
      break;
    }

    case 'host': {
      if (!user) return sendTo(ws, 'error', { error: 'Only a linked HUD can request control.' });
      const result = tvState.setHost(tv, user, p.action);
      if (!result.ok) return sendTo(ws, 'error', { error: result.error });
      broadcastViewers(tv);
      broadcastSnapshot(tv);
      break;
    }

    // A HUD button press, relayed to every screen watching this TV.
    case 'remote': {
      if (!user) return sendTo(ws, 'error', { error: 'Only a linked HUD can send remote commands.' });
      if (p.kind === 'open') {
        const safe = safeUrl(p.value);
        if (!safe) return sendTo(ws, 'error', { error: 'That address cannot be opened.' });
        if (!tvState.canControl(tv, user.key)) {
          return sendTo(ws, 'error', { error: 'You do not have control of this TV.' });
        }
        tvState.setExternal(tv, safe, p);
        broadcastSnapshot(tv);
        lsl.navigate(tv.tvId, safe, p);
      } else {
        broadcast(tv.tvId, 'notice', { level: 'remote', kind: p.kind, value: p.value });
        broadcast(tv.tvId, 'remote', { kind: p.kind, value: p.value, from: user.name });
      }
      break;
    }

    case 'message': {
      if (!user) return sendTo(ws, 'error', { error: 'Only a linked HUD can send messages.' });
      const text = String(p.text || '').slice(0, config.messageMax).trim();
      if (!text) return;

      const entry = {
        from: { key: user.key, name: user.name },
        to: p.to && p.to.key ? { key: String(p.to.key), name: String(p.to.name || '') } : null,
        text: text,
        at: Date.now()
      };
      tv.messages.push(entry);
      if (tv.messages.length > 100) tv.messages.shift();

      broadcast(tv.tvId, 'message', entry);
      lsl.say(tv.tvId, entry);
      break;
    }

    // Move every screen to the same section.
    case 'view': {
      const result = tvState.setView(tv, user, p.view, p.params);
      if (!result.ok) return sendTo(ws, 'error', { error: result.error });
      // `except` the sender: they already navigated locally, and echoing it
      // back would fight their own UI.
      broadcast(tv.tvId, 'view', { view: tv.view, params: tv.viewParams }, ws);
      break;
    }

    case 'queue': {
      const result = tvState.queueOp(tv, user, p);
      if (!result.ok) return sendTo(ws, 'error', { error: result.error });
      broadcastSnapshot(tv);
      break;
    }

    case 'game': {
      let result;
      if (p.action === 'start') result = games.start(tv, p.game, user);
      else if (p.action === 'move') result = games.move(tv, user, p.move);
      else if (p.action === 'restart') result = games.restart(tv);
      else if (p.action === 'leave') result = games.leave(tv, user);
      else result = { ok: false, error: 'Unknown game action.' };

      if (!result.ok) return sendTo(ws, 'error', { error: result.error });

      broadcast(tv.tvId, 'game', {
        game: tv.game ? tv.game.game : null,
        session: tvState.redactGame(tv.game)
      });
      break;
    }

    // Object-level configuration: permission mode, idle timeout, urls. These
    // belong to the TV, not to a viewer, so they are relayed to the object,
    // which is where they are actually stored (Linkset Data).
    case 'config': {
      if (!tvState.canControl(tv, user && user.key)) {
        return sendTo(ws, 'error', { error: 'You do not have control of this TV.' });
      }
      const key = String(p.key || '').slice(0, 32);
      const value = String(p.value === undefined ? '' : p.value).slice(0, 200);

      if (key === 'permission_mode') {
        const modes = ['owner', 'group', 'everyone', 'host'];
        if (modes.indexOf(value) < 0) return sendTo(ws, 'error', { error: 'Unknown permission mode.' });
        tv.permissionMode = value;
        tv.dirty = true;
      }
      if (key === 'host_clear') tv.host = null;

      broadcastSnapshot(tv);
      lsl.config(tv.tvId, key, value);
      break;
    }

    default:
      log.debug('[ws] unhandled type', msg.type);
  }
}

/**
 * The last line of url defence before an address reaches the prim.
 *
 * The browser checks first for a quick error message, this checks because the
 * browser cannot be trusted, and the object keeps a media whitelist of its own.
 * Three checks is not paranoia when the result is a url shown to everyone
 * standing in the room.
 */
function safeUrl(input) {
  let u;
  try {
    u = new URL(String(input || ''));
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.hostname.indexOf('.') < 0) return null;
  // Block addresses that would point the viewer embedded browser at something
  // on the machine running it.
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)) return null;
  if (u.href.length > 1000) return null;
  return u.href;
}

module.exports = {
  attach, broadcast, broadcastViewers, broadcastSnapshot, sendTo, roomSize, safeUrl
};
