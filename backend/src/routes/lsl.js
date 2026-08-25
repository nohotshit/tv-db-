'use strict';
/**
 * Second Life bridge endpoints.
 *
 * This is the only part of the API the in-world scripts talk to. Everything
 * here is shaped around what LSL can actually do:
 *
 *   - responses stay well under 2048 bytes, because that is where LSL truncates
 *     an http_response body
 *   - keys are short for the same reason
 *   - nothing requires the object to hold a connection open, because it cannot
 *   - every route tolerates being called twice, because llHTTPRequest retries
 *     are a normal part of life on a laggy sim
 */

const express = require('express');
const tvState = require('../services/tvState');
const tokens = require('../services/tokens');
const lslBridge = require('../services/lslBridge');
const devicesRepo = require('../db/repos/devices');
const wss = require('../realtime/wss');
const { verifyObject } = require('../middleware/lslAuth');
const v = require('../middleware/validate');
const config = require('../config');
const log = require('../util/log');

const router = express.Router();

/**
 * Registration and heartbeat.
 *
 * Called on script start, on rez, on region change, and every few minutes as a
 * heartbeat. The callback url is the object llRequestSecureURL endpoint, which
 * changes on every one of those events - that is why this is a routine call and
 * not a one-off setup step.
 */
router.post('/lsl/register', verifyObject, async function (req, res) {
  const body = req.body || {};
  const tvId = req.sl.tvId;

  // Reuse the existing secret when we already know this object, so a routine
  // re-registration (rez, script reset, region restart) does not invalidate a
  // secret the object is still using.
  const known = lslBridge.endpointOf(tvId);
  const deviceSecret =
    (known && known.secret) ||
    (req.sl.device && req.sl.device.device_secret) ||
    tokens.newDeviceSecret();

  await devicesRepo.register({
    tvId: tvId,
    ownerKey: req.sl.ownerKey || null,
    ownerName: req.sl.ownerName || '',
    name: v.str(body.name || req.sl.objectName, 64) || 'Smart TV',
    region: req.sl.region,
    callbackUrl: v.str(body.url, 300),
    deviceSecret: deviceSecret,
    permissionMode: v.oneOf(body.mode, ['owner', 'group', 'everyone', 'host'], 'owner'),
    groupKey: v.str(body.group, 64) || null
  });

  lslBridge.registerEndpoint(tvId, v.str(body.url, 300), deviceSecret);

  const tv = await tvState.hydrate(tvId);
  tv.ownerKey = req.sl.ownerKey || tv.ownerKey;
  tv.ownerName = req.sl.ownerName || tv.ownerName;
  tv.region = req.sl.region || tv.region;
  if (body.name) tv.name = v.str(body.name, 64);
  if (body.mode) tv.permissionMode = v.oneOf(body.mode, ['owner', 'group', 'everyone', 'host'], tv.permissionMode);

  log.info('[lsl] registered', tvId, 'in', tv.region);

  // Short response: the object needs the secret once, plus current state.
  res.json({
    ok: 1,
    sec: deviceSecret,
    st: tvState.lslSnapshot(tv)
  });
});

/**
 * Poll.
 *
 * The fallback path for when a push failed - a region restart, a script reset,
 * a sim that was not accepting inbound connections for a moment. The object
 * calls this on a slow timer and collects whatever queued up.
 *
 * Deliberately slow on the object side: llHTTPRequest is throttled around 25
 * requests per 20 seconds per owner per region, and a TV that burns that
 * budget polling has none left for anything useful.
 */
router.post('/lsl/poll', verifyObject, async function (req, res) {
  const tvId = req.sl.tvId;
  const tv = await tvState.hydrate(tvId);

  const queued = lslBridge.drainQueue(tvId);

  res.json({
    ok: 1,
    st: tvState.lslSnapshot(tv),
    q: queued.slice(0, 5)          // the rest waits for the next poll
  });
});

/**
 * Presence report.
 *
 * The object sends the avatars it detects on the parcel, with a flag for
 * whether each shares the object group. That group flag is the reason this
 * matters: group membership exists only inside Second Life, so this is the
 * only way the backend can ever learn it, and it is what group permission mode
 * is checked against.
 */
router.post('/lsl/presence', verifyObject, async function (req, res) {
  const tv = await tvState.hydrate(req.sl.tvId);
  const raw = Array.isArray(req.body && req.body.a) ? req.body.a : [];

  const list = raw.slice(0, 40).map(function (entry) {
    // Compact wire format from LSL: "key|name|group"
    if (typeof entry === 'string') {
      const parts = entry.split('|');
      return { key: parts[0], name: parts[1] || 'Resident', inGroup: parts[2] === '1' };
    }
    return { key: v.str(entry.k, 64), name: v.str(entry.n, 64), inGroup: !!entry.g };
  }).filter(function (e) { return !!e.key; });

  tvState.replaceDetected(tv, list);
  wss.broadcastViewers(tv);

  res.json({ ok: 1, n: tv.viewers.size });
});

/**
 * Pair a HUD.
 *
 * Called when an avatar touches the TV wearing the HUD. The object knows who
 * touched it - that is the one identity Second Life gives us for free - and
 * asks for a token. The token goes into the HUD MOAP url, which is how a
 * personal, identified web surface becomes possible at all.
 */
router.post('/lsl/pair', verifyObject, async function (req, res) {
  const body = req.body || {};
  const key = v.str(body.k, 64);
  const name = v.str(body.n, 64);

  if (!/^[0-9a-f-]{36}$/i.test(key)) return v.bad(res, 'Avatar key required.');

  const tv = await tvState.hydrate(req.sl.tvId);
  tvState.touchViewer(tv, { key: key, name: name, surface: 'inworld', inGroup: !!body.g });

  const token = tokens.issue({ key: key, name: name, tvId: req.sl.tvId });

  res.json({
    ok: 1,
    t: token,
    ttl: Math.round(config.tokenTtlMs / 1000)
  });
});

/**
 * A local button press or dialog choice made at the object.
 *
 * These are the controls that must keep working when a viewer has no HUD, or
 * when the web interface is not on screen because an external site is. The
 * object reports what the avatar chose, the backend applies it with the same
 * permission rules as everything else, and every connected screen follows.
 */
router.post('/lsl/command', verifyObject, async function (req, res) {
  const body = req.body || {};
  const tv = await tvState.hydrate(req.sl.tvId);

  const user = body.k ? { key: v.str(body.k, 64), name: v.str(body.n, 64) } : null;
  const action = v.str(body.c, 24);

  if (action === 'nav') {
    const safe = wss.safeUrl(body.url);
    if (!safe) return v.bad(res, 'Address rejected.');
    if (!tvState.canControl(tv, user && user.key)) return res.status(403).json({ error: 'no-control' });
    tvState.setExternal(tv, safe, { title: v.str(body.ttl, 200), source: v.str(body.src, 24) });
    wss.broadcastSnapshot(tv);
    return res.json({ ok: 1 });
  }

  if (action === 'home') {
    if (!tvState.canControl(tv, user && user.key)) return res.status(403).json({ error: 'no-control' });
    tvState.returnToApp(tv);
    wss.broadcastSnapshot(tv);
    return res.json({ ok: 1 });
  }

  if (action === 'host') {
    if (!user) return v.bad(res, 'Avatar key required.');
    const result = tvState.setHost(tv, user, v.str(body.a, 16));
    if (!result.ok) return res.status(403).json({ error: result.error });
    wss.broadcastViewers(tv);
    wss.broadcastSnapshot(tv);
    return res.json({ ok: 1 });
  }

  if (action === 'mode') {
    // Only the owner changes permission mode, and the object already checked
    // that. We check again anyway - the object header could be spoofed by
    // anyone who has the shared secret, and defence in depth is cheap here.
    if (!user || !tv.ownerKey || user.key !== tv.ownerKey) {
      return res.status(403).json({ error: 'owner-only' });
    }
    tv.permissionMode = v.oneOf(body.v, ['owner', 'group', 'everyone', 'host'], tv.permissionMode);
    tv.dirty = true;
    await devicesRepo.setPermissionMode(tv.tvId, tv.permissionMode);
    wss.broadcastSnapshot(tv);
    return res.json({ ok: 1, mode: tv.permissionMode });
  }

  // Playback verbs share the ordinary command path.
  const result = tvState.applyCommand(tv, user, {
    action: v.oneOf(action, ['play', 'pause', 'stop', 'seek', 'select', 'state'], 'state'),
    positionMs: v.int(body.pos, 0, 24 * 3600 * 1000, 0) * 1000,
    media: body.url ? { title: v.str(body.ttl, 200), url: body.url, source: v.str(body.src, 24) } : null
  });

  if (!result.ok) return res.status(403).json({ error: result.error });

  wss.broadcast(tv.tvId, 'sync', Object.assign({ action: action }, tvState.snapshot(tv)));
  res.json({ ok: 1, st: tvState.lslSnapshot(tv) });
});

/** Chat typed at the object, relayed to the web surfaces. */
router.post('/lsl/message', verifyObject, async function (req, res) {
  const tv = await tvState.hydrate(req.sl.tvId);
  const body = req.body || {};
  const text = v.str(body.txt, config.messageMax);
  if (!text) return v.bad(res, 'Message text is required.');

  const entry = {
    from: { key: v.str(body.k, 64), name: v.str(body.n, 64) || 'Resident' },
    to: body.to ? { key: v.str(body.to, 64), name: '' } : null,
    text: text,
    at: Date.now()
  };
  tv.messages.push(entry);
  if (tv.messages.length > 100) tv.messages.shift();

  wss.broadcast(tv.tvId, 'message', entry);
  res.json({ ok: 1 });
});

module.exports = router;
