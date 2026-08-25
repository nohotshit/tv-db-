'use strict';
/**
 * Identity for REST calls.
 *
 * `requireUser` is used by the routes that touch personal data - favorites,
 * history, settings. The identity comes from a signed HUD token, never from a
 * user id in the path or body, so one viewer cannot read another favorites by
 * changing a number in a url.
 *
 * `optionalUser` attaches the identity when present and carries on when it is
 * not, which is how the shared TV screen reads public TV state.
 */

const tokens = require('../services/tokens');
const usersRepo = require('../db/repos/users');

function readToken(req) {
  const header = req.get('authorization') || '';
  if (header.slice(0, 7).toLowerCase() === 'bearer ') return header.slice(7).trim();
  return '';
}

function optionalUser(req, res, next) {
  const token = readToken(req);
  if (token) {
    const claims = tokens.verify(token);
    if (claims) req.user = { key: claims.key, name: claims.name, tvId: claims.tvId };
  }
  next();
}

function requireUser(req, res, next) {
  const token = readToken(req);
  const claims = token ? tokens.verify(token) : null;
  if (!claims) {
    return res.status(401).json({
      error: 'This needs a linked HUD. The shared TV screen cannot tell who is using it, so it has no personal data of its own.'
    });
  }
  req.user = { key: claims.key, name: claims.name, tvId: claims.tvId };
  next();
}

/** Resolve the database row for req.user, creating it on first sight. */
async function withUserRow(req, res, next) {
  if (!req.user) return next();
  const row = await usersRepo.upsert(req.user.key, req.user.name);
  if (!row) {
    return res.status(503).json({
      error: 'The database is unavailable, so saved data cannot be read or written right now. Local favorites and history still work.',
      degraded: true
    });
  }
  req.userRow = row;
  next();
}

module.exports = { optionalUser, requireUser, withUserRow };
