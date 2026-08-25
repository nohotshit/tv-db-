'use strict';
/**
 * CORS, headers and rate limiting.
 *
 * CORS matters more than usual here. The frontend is served from a different
 * Render service than the API, so every browser call is cross-origin. The
 * allow list is explicit: the deployed frontend, anything named in
 * EXTRA_CORS_ORIGINS, and localhost during development. A wildcard would let
 * any page on the internet drive somebody TV.
 *
 * Second Life itself is NOT an origin. Requests from LSL are server-to-server
 * and carry no Origin header at all - they are authenticated by HMAC instead,
 * in middleware/lslAuth.js.
 */

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const log = require('../util/log');

const DEV_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:3000'
];

function allowedOrigins() {
  const list = [];
  if (config.frontendUrl) list.push(config.frontendUrl);
  config.extraOrigins.forEach(function (o) { list.push(o); });
  if (!config.isProduction) DEV_ORIGINS.forEach(function (o) { list.push(o); });
  return list;
}

const corsMiddleware = cors({
  origin: function (origin, callback) {
    // No Origin: a server-to-server call, or the viewer embedded browser on a
    // direct navigation. Allowed; those paths are authenticated separately.
    if (!origin) return callback(null, true);

    if (allowedOrigins().indexOf(origin) >= 0) return callback(null, true);

    log.warn('[cors] rejected origin', origin);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-TV-Id', 'X-MI-Signature', 'X-MI-Timestamp'],
  credentials: false,
  maxAge: 600
});

const helmetMiddleware = helmet({
  // The API serves JSON, never HTML, so a restrictive CSP here costs nothing.
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: config.isProduction ? undefined : false
});

/** General API limit. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' }
});

/**
 * Tighter limit on the Second Life bridge.
 *
 * llHTTPRequest is itself throttled at roughly 25 requests per 20 seconds per
 * owner per region, so a well behaved object will never come close to this.
 * Anything that does is either a script bug or somebody else.
 */
const lslLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Object is sending too fast.' }
});

module.exports = { corsMiddleware, helmetMiddleware, apiLimiter, lslLimiter, allowedOrigins };
