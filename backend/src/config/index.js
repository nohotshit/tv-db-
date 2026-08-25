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

function origin(value) {
  if (!value) return '';
  const s = String(value).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
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
