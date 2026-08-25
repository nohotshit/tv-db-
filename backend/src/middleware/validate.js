'use strict';
/**
 * Input validation.
 *
 * Hand written rather than pulled from a package: the shapes are small, and a
 * dependency that parses untrusted input is a dependency worth not having.
 *
 * Everything crossing this boundary is untrusted - including anything that
 * claims to be from the TV screen, and including anything the frontend sent.
 */

function str(value, max, fallback) {
  if (typeof value !== 'string') return fallback === undefined ? '' : fallback;
  return value.slice(0, max || 200).trim();
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return !!fallback;
}

function int(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

/** http(s) only, real host, sane length. Mirrors the WebSocket check. */
function httpUrl(value) {
  let u;
  try {
    u = new URL(String(value || ''));
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.hostname.indexOf('.') < 0) return null;
  if (u.href.length > 1000) return null;
  return u.href;
}

/** Express helper: 400 with a clear reason instead of a stack trace. */
function bad(res, message) {
  return res.status(400).json({ error: message });
}

module.exports = { str, bool, int, oneOf, httpUrl, bad };
