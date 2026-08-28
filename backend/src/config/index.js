'use strict';
/**
 * Configuration.
 *
 * Every value comes from the environment. Nothing secret is ever hardcoded,
 * and the module refuses to start in production with placeholder secrets
 * rather than running insecurely and looking fine.
 */

require('dotenv').config();

const crypto = require('crypto');

/**
 * Normalise a service URL, completing a bare Render service slug.
 *
 * Render's `fromService ... property: host` hands back the SLUG, not a
 * hostname - "smarttv-frontend" rather than "smarttv-frontend.onrender.com".
 * Left alone, that lands in the CORS allow list as an origin no browser will
 * ever send, so every cross-origin request from the TV is refused with no
 * obvious cause.
 *
 * A host containing no dot cannot be a real hostname. localhost:3000 keeps its
 * port and is left alone, so development is unaffected.
 */
function origin(value) {
  if (!value) return '';
  let s = String(value).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;

  const m = /^(https?:\/\/)([^\/]+)(.*)$/i.exec(s);
  if (!m) return s;

  let host = m[2];
  if (host.indexOf('.') < 0 && host.indexOf(':') < 0) {
    host = host + '.onrender.com';
  }
  return m[1] + host + m[3];
}

function list(value) {
  return String(value || '')
    .split(',')
    .map(function (s) { return origin(s.trim()); })
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: isProduction,
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',

  databaseUrl: process.env.DATABASE_URL || '',
  hasDatabase: !!process.env.DATABASE_URL,

  // Postgres schema every table lives in.
  //
  // This exists so the TV can share a database with something else without the
  // two colliding. Table names like `users`, `settings`, `favorites` and
  // `history` are generic enough that another application on the same database
  // will plausibly want them too. Confining ours to a named schema means both
  // can have a `users` table and neither notices the other.
  //
  // Must be a plain identifier: it is interpolated into SQL, so it is
  // validated rather than escaped.
  dbSchema: (function () {
    const raw = (process.env.DB_SCHEMA || 'smarttv').trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(raw)) {
      throw new Error('DB_SCHEMA must be a lowercase identifier, got: ' + raw);
    }
    return raw;
  })(),

  frontendUrl: origin(process.env.FRONTEND_URL),
  extraOrigins: list(process.env.EXTRA_CORS_ORIGINS),

  sessionSecret: process.env.SESSION_SECRET || '',
  lslSecret: process.env.LSL_SHARED_SECRET || '',
  allowUnsignedLsl: process.env.ALLOW_UNSIGNED_LSL === '1',

  // ---- tunables ----
  tokenTtlMs: 12 * 60 * 60 * 1000,     // HUD session token lifetime
  presenceTtlMs: 90 * 1000,            // a viewer with no heartbeat drops off
  lslQueueMax: 20,                     // commands held for an object that is not answering
  lslBodyMax: 2000,                    // LSL http_response bodies are capped at 2048 bytes
  messageMax: 400,
  historyMax: 60,
  syncMinIntervalMs: 100               // ignore command floods from one controller
};

// Development gets a generated secret so the project runs out of the box.
// Production does not: a predictable signing key is worse than a crash.
if (!config.sessionSecret) {
  if (isProduction) {
    throw new Error('SESSION_SECRET is required in production. See .env.example.');
  }
  config.sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET not set; generated an ephemeral one for development.');
}

if (!config.lslSecret) {
  if (isProduction && !config.allowUnsignedLsl) {
    throw new Error('LSL_SHARED_SECRET is required in production. See .env.example.');
  }
  config.lslSecret = crypto.randomBytes(24).toString('hex');
  console.warn('[config] LSL_SHARED_SECRET not set; generated one for development. Put it in the TV notecard.');
}

if (!config.hasDatabase) {
  console.warn('[config] DATABASE_URL not set. Running in memory-only mode: sync, presence and games work, but favorites, history and saved settings will not persist.');
}

module.exports = config;
