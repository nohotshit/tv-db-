'use strict';
/**
 * Second Life bridge - the backend half of talking to the object.
 *
 * WHY THIS EXISTS
 *   LSL has no WebSocket client, so the object cannot hold a realtime
 *   connection. Instead it registers an llRequestSecureURL endpoint with us and
 *   we POST to it when something needs to happen in world. That endpoint is
 *   ephemeral: it dies on script reset, on rez, and on region restart, so a
 *   failed push is an ordinary event, not an error.
 *
 * WHY A QUEUE
 *   When the push fails we hold the command. The object polls on a slow timer
 *   anyway - once every thirty seconds is plenty for a fallback - and collects
 *   whatever is waiting. That keeps the TV working through a region restart
 *   without either side spinning.
 *
 * SIZE
 *   LSL truncates an http_response body at 2048 bytes. Everything sent here is
 *   deliberately compact: short keys, seconds instead of milliseconds, urls
 *   trimmed. If a payload would exceed the cap it is dropped with a warning
 *   rather than silently arriving in world cut in half.
 */

const devicesRepo = require('../db/repos/devices');
const tokens = require('./tokens');
const config = require('../config');
const log = require('../util/log');

/** tvId -> { url, secret, queue: [], failures } */
const endpoints = new Map();

function registerEndpoint(tvId, url, secret) {
  const existing = endpoints.get(tvId) || { queue: [], failures: 0 };
  endpoints.set(tvId, {
    url: url || '',
    secret: secret || existing.secret || '',
    queue: existing.queue,
    failures: 0
  });
  log.info('[lsl] endpoint registered for', tvId, url ? '(live)' : '(cleared)');
}

function endpointOf(tvId) {
  return endpoints.get(tvId) || null;
}

/** Commands waiting for an object that is not answering. */
function drainQueue(tvId) {
  const ep = endpoints.get(tvId);
  if (!ep || !ep.queue.length) return [];
  const items = ep.queue.slice();
  ep.queue.length = 0;
  return items;
}

function enqueue(tvId, command) {
  const ep = endpoints.get(tvId) || { url: '', secret: '', queue: [], failures: 0 };
  ep.queue.push(command);
  while (ep.queue.length > config.lslQueueMax) ep.queue.shift();
  endpoints.set(tvId, ep);
}

/**
 * Push a command to the object.
 *
 * Never throws and never blocks a caller: the browser side of the TV must not
 * wait on a sim that is restarting. Returns true when the object accepted it.
 */
async function push(tvId, command) {
  const ep = endpoints.get(tvId);
  const body = JSON.stringify(command);

  if (body.length > config.lslBodyMax) {
    log.warn('[lsl] payload too large for', tvId, body.length, 'bytes; dropped');
    return false;
  }

  if (!ep || !ep.url) {
    enqueue(tvId, command);
    log.debug('[lsl] no live endpoint for', tvId, '- queued');
    return false;
  }

  const stamp = tokens.signOutbound(body, ep.secret);

  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 8000);

    const res = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MI-Timestamp': String(stamp.timestamp),
        'X-MI-Signature': stamp.signature
      },
      body: body,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error('status ' + res.status);
    }

    ep.failures = 0;
    return true;
  } catch (err) {
    ep.failures++;
    enqueue(tvId, command);
    log.warn('[lsl] push to', tvId, 'failed (' + err.message + '), attempt', ep.failures);

    // Three failures means the url is almost certainly dead - a script reset
    // or a region restart. Forget it and wait for the object to re-register.
    if (ep.failures >= 3) {
      log.info('[lsl] endpoint for', tvId, 'looks dead; waiting for re-registration');
      ep.url = '';
      devicesRepo.clearCallback(tvId).catch(function () { /* best effort */ });
    }
    return false;
  }
}

/* ---- command builders --------------------------------------------------
   Short keys because of the 2048 byte cap. The LSL side parses these with
   a small JSON reader rather than llJson2List on a big structure.
   ------------------------------------------------------------------------ */

function navigate(tvId, url, meta) {
  return push(tvId, {
    c: 'nav',
    url: String(url || '').slice(0, 1000),
    ttl: String((meta && meta.title) || '').slice(0, 48),
    src: String((meta && meta.source) || 'web').slice(0, 16)
  });
}

function home(tvId) {
  return push(tvId, { c: 'home' });
}

function state(tvId, snapshot) {
  return push(tvId, Object.assign({ c: 'state' }, snapshot));
}

function say(tvId, message) {
  return push(tvId, {
    c: 'say',
    to: (message.to && message.to.key) || '',
    from: String((message.from && message.from.name) || 'TV').slice(0, 48),
    txt: String(message.text || '').slice(0, 300)
  });
}

function config_(tvId, key, value) {
  return push(tvId, { c: 'cfg', k: String(key).slice(0, 32), v: String(value).slice(0, 200) });
}

module.exports = {
  registerEndpoint, endpointOf, drainQueue, enqueue, push,
  navigate, home, state, say, config: config_
};
