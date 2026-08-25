'use strict';
/**
 * Express application.
 *
 * Order matters: security headers, then CORS, then body parsing (capturing the
 * raw body so LSL signatures can be verified over exactly the bytes that were
 * sent), then rate limits, then routes.
 */

const express = require('express');
const { corsMiddleware, helmetMiddleware, apiLimiter, lslLimiter } = require('./middleware/security');
const errors = require('./middleware/errors');
const log = require('./util/log');

const healthRoutes = require('./routes/health');
const tvRoutes = require('./routes/tv');
const userdataRoutes = require('./routes/userdata');
const lslRoutes = require('./routes/lsl');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);              // Render terminates TLS in front of us

app.use(helmetMiddleware);
app.use(corsMiddleware);

/**
 * Body parsing.
 *
 * `verify` keeps the exact raw bytes. An HMAC computed over a re-serialised
 * object would not match what LSL signed - key order and whitespace differ -
 * so the raw string is what gets verified.
 *
 * The limit is small on purpose. Nothing this API accepts is large, and an
 * unbounded body is an easy way to exhaust a free tier instance.
 */
app.use(express.json({
  limit: '64kb',
  verify: function (req, res, buf) { req.rawBody = buf.toString('utf8'); }
}));

app.use('/api', apiLimiter, healthRoutes);
app.use('/api', apiLimiter, tvRoutes);
app.use('/api', apiLimiter, userdataRoutes);

// The Second Life bridge has its own limiter and its own authentication.
app.use('/api', lslLimiter, lslRoutes);

// A friendly root, so someone opening the backend url in a browser sees
// something meaningful rather than a 404.
app.get('/', function (req, res) {
  res.type('text/plain').send(
    'Musical Impact Smart TV backend.\n' +
    'API:       /api/health\n' +
    'Realtime:  wss://<this host>/rt\n' +
    'The TV interface is the separate frontend service.\n'
  );
});

app.use(errors.notFound);
app.use(errors.handler);

module.exports = app;
