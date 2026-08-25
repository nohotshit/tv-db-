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
   The object sends X-MI-Timestamp and X-MI-Signature on every request. The
   signature scheme is documented on signLsl below: it is a two-pass SHA-256
   construction rather than HMAC, because HMAC cannot be computed in LSL.

   The message shape stays deliberately simple - ASCII only, string
   concatenation, no binary - because it has to be assembled in a language
   with no byte type.
   ------------------------------------------------------------------------- */

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Sign a Second Life bridge request.
 *
 *     inner     = sha256(secret + ":" + timestamp + ":" + body)
 *     signature = sha256(secret + ":" + inner)
 *
 * WHY NOT HMAC-SHA256: because LSL cannot compute it. HMAC needs the key XORed
 * byte-wise with the ipad/opad constants and the inner digest concatenated as
 * raw bytes. LSL offers llSHA256String, which hashes the UTF-8 bytes of a
 * STRING - there is no byte array type, no XOR across a string, and any digest
 * byte above 0x7F would be re-encoded as two UTF-8 bytes and change the hash.
 * Specifying HMAC here would be specifying something unimplementable in world.
 *
 * This two-pass construction is what LSL can actually produce, and it avoids
 * the length-extension weakness a naive sha256(secret + message) would carry:
 * the outer input is a fixed length and cannot be extended without the secret.
 * Every hashed value is ASCII, so both sides agree byte for byte.
 */
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function signLsl(timestamp, body, secret) {
  const key = secret || config.lslSecret;
  const inner = sha256(key + ':' + String(timestamp) + ':' + String(body || ''));
  return sha256(key + ':' + inner);
}

/**
 * Verify a request that claims to come from an in-world object.
 * Returns { ok } or { ok:false, reason }.
 */
function verifyLsl(headers, rawBody, deviceSecret) {
  if (config.allowUnsignedLsl) return { ok: true, unsigned: true };

  const sig = headers['x-mi-signature'];
  const rawTs = headers['x-mi-timestamp'];
  const ts = Number(rawTs);

  if (!sig || !ts) return { ok: false, reason: 'missing-signature' };

  // The wire timestamp is UNIX SECONDS, not milliseconds, because LSL integers
  // are 32 bit: llGetUnixTime() * 1000 overflows well past the signed maximum,
  // so an object physically cannot produce a millisecond stamp. Millisecond
  // values are still accepted so anything else talking to this endpoint works.
  const tsMs = ts < 1e11 ? ts * 1000 : ts;

  // A replay window, not a clock sync requirement. Region clocks are close
  // enough to real time for five minutes to be generous.
  const skew = Math.abs(Date.now() - tsMs);
  if (skew > SIGNATURE_WINDOW_MS) return { ok: false, reason: 'stale-timestamp' };

  // Sign over the timestamp string exactly as it arrived: the object hashed
  // the characters it sent, and re-serialising the number could differ.
  const expected = signLsl(String(rawTs), rawBody, deviceSecret);
  if (!safeEqual(sig.toLowerCase(), expected)) return { ok: false, reason: 'bad-signature' };

  return { ok: true };
}

/** Sign a push we are sending TO an object, so it can verify us in return. */
function signOutbound(body, deviceSecret) {
  // Seconds, matching what the object can verify with llGetUnixTime().
  const ts = Math.floor(Date.now() / 1000);
  return { timestamp: ts, signature: signLsl(String(ts), body, deviceSecret) };
}

/** A fresh per-device secret, handed to the object once at pairing. */
function newDeviceSecret() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  issue, verify, signLsl, verifyLsl, signOutbound, newDeviceSecret, safeEqual
};
