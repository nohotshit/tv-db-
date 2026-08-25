/**
 * REST client.
 *
 * Every call is failure-tolerant by design. Requirement 36 is that the TV
 * keeps working when Render is unreachable, so nothing here ever throws into a
 * view: callers get { ok, data, error } and decide how to degrade.
 */

import { config, hasBackend } from './config.js';
import { state, patch } from './state.js';
import { log } from './log.js';
import { emit } from './bus.js';

let consecutiveFailures = 0;

/** Auth header, present only on surfaces that carry an identity (the HUD). */
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (config.token) h['Authorization'] = 'Bearer ' + config.token;
  if (config.tvId) h['X-TV-Id'] = config.tvId;
  return h;
}

export async function request(method, path, body, opts) {
  if (!hasBackend()) {
    return { ok: false, error: 'no-backend', offline: true };
  }

  const url = config.backendUrl + path;
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); },
    (opts && opts.timeoutMs) || config.API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit'
    });
    clearTimeout(timeout);

    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.indexOf('application/json') >= 0) {
      data = await res.json();
    }

    if (!res.ok) {
      log.warn('[api]', method, path, res.status);
      return { ok: false, status: res.status, error: (data && data.error) || ('http-' + res.status), data: data };
    }

    onSuccess();
    return { ok: true, status: res.status, data: data };
  } catch (err) {
    clearTimeout(timeout);
    const reason = err.name === 'AbortError' ? 'timeout' : 'network';
    onFailure(reason);
    return { ok: false, error: reason, offline: true };
  }
}

function onSuccess() {
  if (consecutiveFailures > 0) {
    consecutiveFailures = 0;
    emit('cloud:recovered');
  }
  if (state.cloud.status === 'offline' || state.cloud.status === 'degraded') {
    patch({ cloud: { status: 'online', lastError: '' } });
  }
}

function onFailure(reason) {
  consecutiveFailures++;
  // One blip is not an outage. Three in a row is.
  if (consecutiveFailures >= 3 && state.cloud.status !== 'offline') {
    patch({ cloud: { status: 'offline', lastError: reason } });
    emit('cloud:lost', reason);
    log.warn('[api] backend considered offline after', consecutiveFailures, 'failures');
  }
}

export const api = {
  health:      function ()            { return request('GET',  '/api/health'); },
  getTv:       function (id)          { return request('GET',  '/api/tv/' + encodeURIComponent(id)); },
  getState:    function (id)          { return request('GET',  '/api/tv/' + encodeURIComponent(id) + '/state'); },
  postSync:    function (id, cmd)     { return request('POST', '/api/tv/' + encodeURIComponent(id) + '/sync', cmd); },
  getUsers:    function (id)          { return request('GET',  '/api/tv/' + encodeURIComponent(id) + '/users'); },
  getMessages: function (id)          { return request('GET',  '/api/tv/' + encodeURIComponent(id) + '/messages'); },
  sendMessage: function (id, msg)     { return request('POST', '/api/tv/' + encodeURIComponent(id) + '/messages', msg); },
  getGames:    function (id)          { return request('GET',  '/api/tv/' + encodeURIComponent(id) + '/games'); },
  gameAction:  function (id, action)  { return request('POST', '/api/tv/' + encodeURIComponent(id) + '/games', action); },

  listFavorites:  function ()         { return request('GET',    '/api/favorites'); },
  addFavorite:    function (fav)      { return request('POST',   '/api/favorites', fav); },
  removeFavorite: function (favId)    { return request('DELETE', '/api/favorites/' + encodeURIComponent(favId)); },

  listHistory:  function ()           { return request('GET',    '/api/history'); },
  addHistory:   function (item)       { return request('POST',   '/api/history', item); },
  clearHistory: function ()           { return request('DELETE', '/api/history'); },

  getSettings:  function ()           { return request('GET',  '/api/settings'); },
  saveSettings: function (settings)   { return request('PUT',  '/api/settings', settings); }
};
