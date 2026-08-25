'use strict';
/**
 * Authenticate a request that claims to come from an in-world object.
 *
 * Second Life adds headers to every llHTTPRequest that a script cannot forge
 * from inside the sandbox - X-SecondLife-Object-Key, X-SecondLife-Owner-Key,
 * X-SecondLife-Region and others. They are useful context, but they are only
 * trustworthy if the request genuinely came from Second Life, and a third
 * party can set any header they like. So they are treated as claims, and the
 * HMAC signature is what actually authenticates.
 *
 * The first request from a brand new object is the exception: it has no shared
 * device secret yet. That pairing request is signed with the global
 * LSL_SHARED_SECRET from the environment, which the owner puts in the TV
 * notecard, and a per-device secret is issued in the response.
 */

const tokens = require('../services/tokens');
const devicesRepo = require('../db/repos/devices');
const lslBridge = require('../services/lslBridge');
const config = require('../config');
const log = require('../util/log');

async function verifyObject(req, res, next) {
  const rawBody = req.rawBody || '';
  const claimedTvId = req.get('x-secondlife-object-key') || (req.body && req.body.tvId) || '';

  if (!claimedTvId) {
    return res.status(400).json({ error: 'Object key missing.' });
  }

  // Prefer the per-device secret; fall back to the global one for pairing.
  //
  // The in-memory registry is checked FIRST and is authoritative for the
  // current process. Without it, a deployment running with no database would
  // issue a device secret at registration and then reject every subsequent
  // request signed with it, because there would be nowhere to remember it.
  let deviceSecret = '';
  const endpoint = lslBridge.endpointOf(claimedTvId);
  if (endpoint && endpoint.secret) deviceSecret = endpoint.secret;

  const device = await devicesRepo.get(claimedTvId);
  if (!deviceSecret && device && device.device_secret) deviceSecret = device.device_secret;

  let result = tokens.verifyLsl(req.headers, rawBody, deviceSecret || config.lslSecret);

  // A device whose secret has been rotated in world can still pair again with
  // the global secret rather than becoming permanently locked out.
  if (!result.ok && deviceSecret) {
    result = tokens.verifyLsl(req.headers, rawBody, config.lslSecret);
  }

  if (!result.ok) {
    log.warn('[lsl] rejected request from', claimedTvId, '-', result.reason);
    return res.status(401).json({ error: 'Signature check failed: ' + result.reason });
  }

  req.sl = {
    tvId: claimedTvId,
    ownerKey: req.get('x-secondlife-owner-key') || '',
    ownerName: req.get('x-secondlife-owner-name') || '',
    objectName: req.get('x-secondlife-object-name') || '',
    region: (req.get('x-secondlife-region') || '').split('(')[0].trim(),
    unsigned: !!result.unsigned,
    device: device
  };
  next();
}

module.exports = { verifyObject };
