'use strict';
/**
 * TV endpoints.
 *
 * These are the REST mirror of the realtime channel. The browser normally uses
 * the WebSocket; these exist for the object, for HUD cold starts, and for
 * anyone integrating later. Every mutating route re-checks permission through
 * tvState rather than trusting the caller.
 */

const express = require('express');
const tvState = require('../services/tvState');
const games = require('../services/games');
const lsl = require('../services/lslBridge');
const wss = require('../realtime/wss');
const { optionalUser, requireUser } = require('../middleware/auth');
const v = require('../middleware/validate');

const router = express.Router();

/** Every TV this process currently knows about. Ids only - no viewer data. */
router.get('/tv', function (req, res) {
  res.json({
    tvs: tvState.all().map(function (tv) {
      return {
        id: tv.tvId, name: tv.name, region: tv.region,
        viewers: tv.viewers.size, playing: tv.media.playback === 'playing'
      };
    })
  });
});

router.get('/tv/:id', optionalUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  res.json({
    tv: {
      id: tv.tvId, name: tv.name, region: tv.region,
      permissionMode: tv.permissionMode, viewers: tv.viewers.size
    }
  });
});

router.get('/tv/:id/state', optionalUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  res.json(tvState.snapshot(tv));
});

router.get('/tv/:id/users', optionalUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  res.json({ viewers: tvState.viewerList(tv), host: tv.host });
});

router.post('/tv/:id/sync', requireUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  const result = tvState.applyCommand(tv, req.user, req.body || {});
  if (!result.ok) return res.status(403).json({ error: result.error });

  const snap = tvState.snapshot(tv);
  wss.broadcast(tv.tvId, 'sync', Object.assign({ action: req.body.action }, snap));
  lsl.state(tv.tvId, tvState.lslSnapshot(tv));
  res.json(snap);
});

router.get('/tv/:id/messages', requireUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  // Session only. Messages are never written to the database.
  res.json({ messages: tv.messages.slice(-50) });
});

router.post('/tv/:id/messages', requireUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  const text = v.str(req.body && req.body.text, 400);
  if (!text) return v.bad(res, 'Message text is required.');

  const entry = {
    from: { key: req.user.key, name: req.user.name },
    to: req.body.to && req.body.to.key ? { key: v.str(req.body.to.key, 64), name: v.str(req.body.to.name, 64) } : null,
    text: text,
    at: Date.now()
  };
  tv.messages.push(entry);
  if (tv.messages.length > 100) tv.messages.shift();

  wss.broadcast(tv.tvId, 'message', entry);
  lsl.say(tv.tvId, entry);
  res.status(201).json({ message: entry });
});

router.get('/tv/:id/games', optionalUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  res.json({ available: games.list(), session: tvState.redactGame(tv.game) });
});

router.post('/tv/:id/games', requireUser, async function (req, res) {
  const tv = await tvState.hydrate(v.str(req.params.id, 64));
  const action = v.oneOf(req.body && req.body.action, ['start', 'move', 'restart', 'leave'], '');
  if (!action) return v.bad(res, 'Unknown game action.');

  let result;
  if (action === 'start') result = games.start(tv, v.str(req.body.game, 32), req.user);
  else if (action === 'move') result = games.move(tv, req.user, req.body.move);
  else if (action === 'restart') result = games.restart(tv);
  else result = games.leave(tv, req.user);

  if (!result.ok) return res.status(400).json({ error: result.error });

  const payload = { game: tv.game ? tv.game.game : null, session: tvState.redactGame(tv.game) };
  wss.broadcast(tv.tvId, 'game', payload);
  res.json(payload);
});

module.exports = router;
