'use strict';
/**
 * Session tokens and request signing.
 *
 * Two separate trust paths, deliberately:
 *
 *  1. HUD tokens. When an avatar touches the TV, the object asks this backend
 *     for a token. The token is a signed statement of "this avatar key, on
 *     this TV, until this time". It goes into the HUD MOAP url. A browser can
 *     read it - it is in the url - so it grants nothing beyond acting as that
 *     avatar on that TV, and it expires.
 *
 *  2. Object signatures. Every request from LSL carries an HMAC over the body
 *     and a timestamp, using the shared secret. That is what stops anyone who
 *     learns a TV id from driving someone else TV, and it is checked before
 *     any state is touched.
 *
 * Both use timing-safe comparison. Neither ever stores a secret in the
 * repository - see .env.example.
 */

const crypto = require('crypto');
const config = require('../config');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(data, secret) {
  return b64url(crypto.createHmac('sha256', secret || config.sessionSecret).update(data).digest());
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Issue a HUD session token. */
function issue(claims) {
  const payload = {
    k: claims.key,                       // avatar uuid
    n: (claims.name || '').slice(0, 64),
    tv: claims.tvId,
    exp: Date.now() + config.tokenTtlMs
  };
  const body = b64url(JSON.stringify(payload));
  return body + '.' + sign(body);
}

/** Verify a HUD token. Returns claims, or null. */
function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!safeEqual(parts[1], sign(parts[0]))) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!claims || typeof claims.exp !== 'number' || claims.exp < Date.now()) return null;
  return { key: claims.k, name: claims.n, tvId: claims.tv, expiresAt: claims.exp };
}

/* -------------------------------------------------------------------------
   LSL request signing
   -------------------------------------------------------------------------
   The object computes:  hex_hmac_sha256(secret, timestamp + "\n" + body)
   and sends it in X-MI-Signature with the timestamp in X-MI-Timestamp.

   LSL has no HMAC primitive, so the scripts derive it from llSHA256String
   using the standard two-pass construction. That is why the message shape is
   kept this simple: it has to be assembled with string concatenation in a
   language with no binary types.
   ------------------------------------------------------------------------- */

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

function signLsl(timestamp, body, secret) {
  return crypto.createHmac('sha256', secret || config.lslSecret)
    .update(String(timestamp) + '\n' + String(body || ''))
    .digest('hex');
}

/**
 * Verify a request that claims to come from an in-world object.
 * Returns { ok } or { ok:false, reason }.
 */
function verifyLsl(headers, rawBody, deviceSecret) {
  if (config.allowUnsignedLsl) return { ok: true, unsigned: true };

  const sig = headers['x-mi-signature'];
  const ts = Number(headers['x-mi-timestamp']);

  if (!sig || !ts) return { ok: false, reason: 'missing-signature' };

  // A replay window, not a clock sync requirement. Region clocks are close
  // enough to real time for five minutes to be generous.
  const skew = Math.abs(Date.now() - ts);
  if (skew > SIGNATURE_WINDOW_MS) return { ok: false, reason: 'stale-timestamp' };

  const expected = signLsl(ts, rawBody, deviceSecret);
  if (!safeEqual(sig.toLowerCase(), expected)) return { ok: false, reason: 'bad-signature' };

  return { ok: true };
}

/** Sign a push we are sending TO an object, so it can verify us in return. */
function signOutbound(body, deviceSecret) {
  const ts = Date.now();
  return { timestamp: ts, signature: signLsl(ts, body, deviceSecret) };
}

/** A fresh per-device secret, handed to the object once at pairing. */
function newDeviceSecret() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  issue, verify, signLsl, verifyLsl, signOutbound, newDeviceSecret, safeEqual
};
