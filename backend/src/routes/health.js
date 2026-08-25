'use strict';
/**
 * Health.
 *
 * Render polls /api/health for its health check. It reports degraded
 * subsystems honestly rather than returning 200 no matter what: the TV UI
 * shows this, and a green light that lies is worse than a red one.
 *
 * It still returns 200 when the database is down, because the service is
 * genuinely still useful without it - sync, presence and games all work.
 */

const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const tvState = require('../services/tvState');

const router = express.Router();
const startedAt = Date.now();

router.get('/health', async function (req, res) {
  const dbEnabled = db.enabled();
  const dbOk = dbEnabled ? await db.ping() : false;

  res.json({
    ok: true,
    service: 'musical-impact-smarttv',
    version: require('../../package.json').version,
    env: config.env,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    serverTime: Date.now(),
    subsystems: {
      api: 'ok',
      realtime: 'ok',
      database: !dbEnabled ? 'not-configured' : (dbOk ? 'ok' : 'unavailable')
    },
    activeTvs: tvState.all().length,
    // Honest note rather than a silent partial failure.
    notes: !dbEnabled
      ? ['No DATABASE_URL. Favorites, history and saved settings will not persist.']
      : (!dbOk ? ['Database unreachable. The TV keeps working; saved data is unavailable.'] : [])
  });
});

module.exports = router;
