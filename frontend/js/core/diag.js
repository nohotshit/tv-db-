/**
 * Self-reporting diagnostics.
 *
 * The screen describes its own condition to the backend when something
 * notable happens, so a problem can be diagnosed from the service log instead
 * of asking whoever owns the TV to walk over and read a panel out loud.
 *
 * Sent over fetch, not the WebSocket, on purpose: the failure most worth
 * reporting IS the socket failing, and a report that travels on the broken
 * channel is no report at all.
 *
 * Rate limited hard. A TV that cannot reach the backend will try repeatedly,
 * and a diagnostic that floods the log is worse than none.
 */

import { config, hasBackend } from './config.js';
import { state } from './state.js';
import { on } from './bus.js';
import { log } from './log.js';

const MIN_GAP_MS = 30000;
let lastSentAt = 0;

/** Everything needed to explain a connection problem, and nothing else. */
function snapshot(reason) {
  let socket = 'unknown';
  try {
    socket = state.cloud.status === 'online' ? 'open' : state.cloud.status;
  } catch (e) { /* state not ready */ }

  return {
    surface: config.surface,
    tvId: config.tvId,
    view: state.view,
    socket: socket,
    cloud: state.cloud.status,
    latencyMs: state.cloud.latencyMs === null ? -1 : state.cloud.latencyMs,
    offsetMs: state.cloud.offsetMs,
    build: config.commit || config.buildTime,
    reason: reason,
    error: state.cloud.lastError || '',
    screen: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
    // Identifies the Chromium build inside the viewer, which settles a whole
    // class of "is this supported in MOAP" questions definitively.
    engine: String(navigator.userAgent || '').slice(0, 120)
  };
}

export function report(reason, force) {
  if (!hasBackend()) return;

  const now = Date.now();
  if (!force && now - lastSentAt < MIN_GAP_MS) return;
  lastSentAt = now;

  const body = JSON.stringify(snapshot(reason));

  // keepalive lets the report survive the page being torn down, which is
  // exactly when a "the screen went away" reason would be sent.
  try {
    fetch(config.backendUrl + '/api/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      cache: 'no-store',
      credentials: 'omit',
      keepalive: true
    }).catch(function () { /* diagnostics must never surface as an error */ });
  } catch (e) {
    log.debug('[diag] could not report');
  }
}

export function initDiag() {
  if (!hasBackend()) return;

  // The moments worth knowing about.
  on('cloud:lost', function (why) { report('lost:' + (why || 'unknown')); });
  on('cloud:connected', function () { report('connected'); });

  // One report shortly after boot, so a screen that never manages to open a
  // socket at all still says so. Forced past the rate limit because it is the
  // single most useful report and only happens once.
  setTimeout(function () { report('boot', true); }, 6000);
}
