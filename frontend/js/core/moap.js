/**
 * MOAP bridge - "put this url on the TV face".
 *
 * The page cannot change the prim media url itself. Only LSL can, via
 * llSetLinkMedia(PRIM_MEDIA_CURRENT_URL, ...). And the page cannot call the
 * object directly either: LSL HTTP-in cannot emit CORS headers, so a browser
 * fetch to an llRequestSecureURL endpoint is blocked before it leaves the tab.
 *
 * So the path is always:
 *
 *     this page  --WebSocket-->  Render backend  --HTTP POST-->  LSL HTTP-in
 *
 * The backend holds the object's current HTTP-in url (the object re-registers
 * it on rez and on region change, because those urls are ephemeral) and a
 * per-device HMAC secret. If the object has no live url the backend queues the
 * command, and the object picks it up on its next poll.
 */

import { state, canControl } from './state.js';
import { send, isConnected } from './socket.js';
import { emit } from './bus.js';
import { log } from './log.js';

/** Schemes we are willing to put on a prim face. */
const ALLOWED_SCHEMES = ['http:', 'https:'];

/**
 * Validate and normalise a user-entered address.
 * Returns { ok, url } or { ok:false, reason }.
 */
export function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) return { ok: false, reason: 'Enter an address.' };

  // Bare domain or search term?
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(raw)) raw = 'https://' + raw;
    else return { ok: false, reason: 'search', query: raw };
  }

  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return { ok: false, reason: 'That does not look like a valid address.' };
  }

  if (ALLOWED_SCHEMES.indexOf(u.protocol) < 0) {
    return { ok: false, reason: 'Only http and https addresses can be opened on the TV.' };
  }
  if (!u.hostname || u.hostname.indexOf('.') < 0) {
    return { ok: false, reason: 'That address has no valid host name.' };
  }

  return { ok: true, url: u.toString() };
}

/** Human-friendly host for lists and the status bar. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url || '';
  }
}

/**
 * Send the TV prim to an external url (direct mode).
 *
 * This is a control action: it changes what everyone in range sees, so it is
 * permission-gated exactly like playback. The backend re-checks anyway.
 */
export function openOnTv(url, meta) {
  const check = normalizeUrl(url);
  if (!check.ok) {
    emit('notice', {
      level: 'warn',
      title: 'Cannot open that address',
      message: check.reason === 'search' ? 'That looks like a search term, not an address.' : check.reason
    });
    return false;
  }

  if (!canControl()) {
    emit('notice', {
      level: 'warn',
      title: 'Not in control',
      message: 'Only whoever controls this TV can change what is on screen.'
    });
    return false;
  }

  if (!isConnected()) {
    emit('notice', {
      level: 'warn',
      title: 'Cloud synchronisation unavailable',
      message: 'The TV screen is changed by the in-world script, which is reached through the cloud. Use the HUD remote to navigate while the backend is down.'
    });
    return false;
  }

  const payload = {
    tvId: state.tv.id,
    url: check.url,
    title: (meta && meta.title) || hostOf(check.url),
    source: (meta && meta.source) || 'web',
    isLive: !!(meta && meta.isLive),
    controller: state.me.key || 'screen'
  };

  log.info('[moap] requesting prim navigation to', payload.url);
  send('moap', payload);
  return true;
}

/**
 * Bring the TV face back to this application.
 * LSL holds the app url in Linkset Data, so the object knows where "home" is
 * even if the backend is unreachable - the HUD Home button works either way.
 */
export function returnToApp() {
  if (!canControl()) return false;
  if (!isConnected()) {
    emit('notice', {
      level: 'warn',
      title: 'Use the HUD Home button',
      message: 'The in-world script can return the screen to the TV interface on its own while the cloud is unreachable.'
    });
    return false;
  }
  send('moap', { tvId: state.tv.id, url: '', action: 'home', controller: state.me.key || 'screen' });
  return true;
}
