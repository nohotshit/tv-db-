'use strict';
/**
 * Diagnostics.
 *
 * A screen reports its own condition here, over plain HTTP.
 *
 * WHY HTTP AND NOT THE WEBSOCKET
 *   Because the failures worth reporting are usually the WebSocket failing. A
 *   diagnostic that travels on the broken channel tells you nothing. fetch()
 *   is a separate transport and keeps working when the socket does not.
 *
 * WHY IT EXISTS
 *   Without it, every "it is behaving oddly" costs the owner a walk to the
 *   prim to read a panel and type out what it said. The screen can describe
 *   itself instead, and the answer lands in the service log.
 *
 * WHAT IT DELIBERATELY DOES NOT COLLECT
 *   No avatar positions, no chat, no browsing history, no viewer account data.
 *   Only what is needed to explain a connection problem: which surface, which
 *   TV, socket state, last error, build id, and the browser engine string -
 *   which finally tells us which Chromium the viewer is running.
 */

const express = require('express');
const v = require('../middleware/validate');
const log = require('../util/log');

const router = express.Router();

router.post('/diag', function (req, res) {
  const b = req.body || {};

  const line = [
    'surface=' + v.str(b.surface, 12),
    'tv=' + v.str(b.tvId, 40),
    'view=' + v.str(b.view, 24),
    'socket=' + v.str(b.socket, 16),
    'cloud=' + v.str(b.cloud, 16),
    'latency=' + v.int(b.latencyMs, 0, 600000, -1),
    'offset=' + v.int(b.offsetMs, -86400000, 86400000, 0),
    'build=' + v.str(b.build, 24),
    'reason=' + v.str(b.reason, 40),
    'err=' + (v.str(b.error, 120) || 'none'),
    'screen=' + v.str(b.screen, 16),
    'engine=' + v.str(b.engine, 120)
  ].join(' ');

  log.info('[diag]', line);
  res.json({ ok: 1 });
});

module.exports = router;
