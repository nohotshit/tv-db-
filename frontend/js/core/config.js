/**
 * Runtime configuration.
 *
 * Three layers, lowest priority first:
 *   1. built-in defaults below
 *   2. config.generated.js  (written by build-config.js from Render env vars)
 *   3. URL query parameters (written by the LSL scripts when they set the
 *      MOAP url, so an in-world TV can override without a redeploy)
 *
 * There are no secrets here. The only credential the frontend ever holds is a
 * short-lived session token handed out by the backend, and that arrives in the
 * query string from LSL, never from this file.
 */

const injected = window.__SMARTTV_CONFIG__ || {};
const params = new URLSearchParams(window.location.search);

function param(name, fallback) {
  const v = params.get(name);
  return (v === null || v === '') ? fallback : v;
}

function origin(value) {
  if (!value) return '';
  const s = String(value).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

const backendUrl = origin(param('api', injected.BACKEND_URL || ''));

export const config = {
  // ---- deployment ------------------------------------------------------
  backendUrl: backendUrl,
  wsUrl: backendUrl ? backendUrl.replace(/^http/i, 'ws') + '/rt' : '',
  buildTime: injected.BUILD_TIME || 'dev',
  commit: injected.COMMIT || '',

  // ---- identity, supplied by LSL in the MOAP url ------------------------
  // The shared TV screen normally has NO user identity - it is the same page
  // for every avatar in range. Only the HUD page carries `u`/`t`.
  tvId: param('tv', ''),
  userKey: param('u', ''),
  userName: param('n', ''),
  token: param('t', ''),
  surface: param('surface', 'tv'),      // 'tv' | 'hud'

  // ---- behaviour overrides from LSL ------------------------------------
  startView: param('view', ''),
  debug: param('debug', '0') === '1',
  logoUrl: param('logo', injected.LOGO_URL || ''),
  brandName: param('brand', injected.BRAND_NAME || ''),

  // ---- tunables --------------------------------------------------------
  SYNC_TOLERANCE_S: 0.5,          // below this, do nothing
  SYNC_DRIFT_HARD_S: 2.0,         // above this, hard seek instead of rate-nudge
  SYNC_RATE_NUDGE: 0.03,          // +/- 3% playback rate while catching up
  CLOCK_SAMPLES: 5,               // round trips used to estimate server offset
  WS_RETRY_MS: [1000, 2000, 4000, 8000, 15000, 30000],
  API_TIMEOUT_MS: 8000,
  IDLE_TIMEOUT_S: 300,
  HEARTBEAT_MS: 25000,

  // ---- app destinations (all overridable in Settings and from LSL) ------
  defaults: {
    moviesUrl: param('movies', 'https://flixbaba.tv/'),
    youtubeUrl: 'https://www.youtube.com/',
    twitchUrl: 'https://www.twitch.tv/',
    kickUrl: 'https://kick.com/',
    browserHome: param('home', 'https://duckduckgo.com/')
  }
};

/** True when we have somewhere to talk to. */
export function hasBackend() {
  return !!config.backendUrl;
}

/** True when this page can act on behalf of a specific avatar. */
export function hasIdentity() {
  return !!(config.userKey && config.token);
}
