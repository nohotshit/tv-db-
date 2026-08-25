'use strict';
/**
 * Favorites, history and settings.
 *
 * All three need to know WHO is asking, so all three require a linked HUD. The
 * shared TV screen cannot use them - it genuinely has no idea who is looking
 * at it - and the error message says exactly that rather than a bare 401.
 *
 * The user id always comes from the verified token. There is no route here
 * that takes a user id as a parameter, so there is nothing to enumerate.
 */

const express = require('express');
const favoritesRepo = require('../db/repos/favorites');
const historyRepo = require('../db/repos/history');
const settingsRepo = require('../db/repos/settings');
const { requireUser, withUserRow } = require('../middleware/auth');
const v = require('../middleware/validate');

const router = express.Router();
const guard = [requireUser, withUserRow];

/* ---- favorites ---------------------------------------------------------- */

router.get('/favorites', guard, async function (req, res) {
  const rows = await favoritesRepo.list(req.userRow.id);
  if (rows === null) return degraded(res);
  res.json({ favorites: rows.map(toFavorite) });
});

router.post('/favorites', guard, async function (req, res) {
  const url = v.httpUrl(req.body && req.body.url);
  if (!url) return v.bad(res, 'A valid http or https address is required.');

  const row = await favoritesRepo.add(req.userRow.id, {
    title: v.str(req.body.title, 200) || url,
    url: url,
    source: v.str(req.body.source, 24) || 'web'
  });
  if (!row) return degraded(res);
  res.status(201).json({ favorite: toFavorite(row) });
});

router.delete('/favorites/:id', guard, async function (req, res) {
  const id = v.int(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!id) return v.bad(res, 'Invalid id.');
  const ok = await favoritesRepo.remove(req.userRow.id, id);
  if (!ok) return degraded(res);
  res.status(204).end();
});

/* ---- history ------------------------------------------------------------ */

router.get('/history', guard, async function (req, res) {
  const rows = await historyRepo.list(req.userRow.id, 60);
  if (rows === null) return degraded(res);
  res.json({ history: rows.map(toHistory) });
});

router.post('/history', guard, async function (req, res) {
  const url = v.httpUrl(req.body && req.body.url);
  if (!url) return v.bad(res, 'A valid http or https address is required.');

  const row = await historyRepo.add(req.userRow.id, {
    title: v.str(req.body.title, 200) || url,
    url: url,
    source: v.str(req.body.source, 24) || 'web'
  });
  if (!row) return degraded(res);
  res.status(201).json({ item: toHistory(row) });
});

router.delete('/history', guard, async function (req, res) {
  const ok = await historyRepo.clear(req.userRow.id);
  if (!ok) return degraded(res);
  res.status(204).end();
});

/* ---- settings ----------------------------------------------------------- */

router.get('/settings', guard, async function (req, res) {
  const settings = await settingsRepo.get(req.userRow.id);
  res.json({ settings: settings || {} });
});

router.put('/settings', guard, async function (req, res) {
  const incoming = req.body && req.body.settings ? req.body.settings : req.body;
  if (!incoming || typeof incoming !== 'object') return v.bad(res, 'Settings object required.');

  // Only known keys are stored. An unbounded blob from a client is not a
  // preferences object, it is free storage for whoever wants it.
  const allowed = [
    'timezone', 'timeFormat', 'showSeconds', 'dateFormat', 'theme', 'uiScale',
    'brightness', 'idleEnabled', 'idleTimeoutS', 'autoplay', 'resume',
    'defaultSource', 'browserHome', 'moviesUrl', 'syncEnabled', 'syncToleranceS',
    'messagingEnabled', 'detectionRangeM', 'notifications', 'debug'
  ];
  const clean = {};
  allowed.forEach(function (k) {
    if (incoming[k] !== undefined) clean[k] = incoming[k];
  });

  const ok = await settingsRepo.save(req.userRow.id, clean);
  if (!ok) return degraded(res);
  res.json({ settings: clean });
});

/* ---- helpers ------------------------------------------------------------ */

function degraded(res) {
  return res.status(503).json({
    error: 'Saved data is unavailable right now. Local favorites, history and settings still work on this screen.',
    degraded: true
  });
}

function toFavorite(row) {
  return {
    id: String(row.id), title: row.title, url: row.url,
    source: row.source, createdAt: new Date(row.created_at).getTime()
  };
}

function toHistory(row) {
  return {
    id: String(row.id), title: row.title, url: row.url,
    source: row.source, timestamp: new Date(row.viewed_at).getTime()
  };
}

module.exports = router;
