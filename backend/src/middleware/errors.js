'use strict';
/**
 * Error handling.
 *
 * Nothing internal leaks to a client: a stack trace tells an attacker about
 * your dependency versions and file layout. The full error goes to the log,
 * a short honest sentence goes to the caller.
 */

const log = require('../util/log');
const config = require('../config');

function notFound(req, res) {
  res.status(404).json({ error: 'No such endpoint.' });
}

function handler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request was too large.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request body was not valid JSON.' });
  }

  log.error('[http]', req.method, req.path, '-', err && err.message);
  if (err && err.stack && !config.isProduction) log.debug(err.stack);

  res.status(500).json({ error: 'Something went wrong on the server.' });
}

module.exports = { notFound, handler };
