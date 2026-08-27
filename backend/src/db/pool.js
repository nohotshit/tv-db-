'use strict';
/**
 * Postgres pool.
 *
 * The whole database layer is optional. If DATABASE_URL is absent, or the
 * database is unreachable, `query()` returns null and every caller treats that
 * as "no stored data" rather than an error. A television must not stop working
 * because a database is down - requirement 36 applies to the backend too.
 */

const { Pool } = require('pg');
const config = require('../config');
const log = require('../util/log');

let pool = null;
let healthy = false;

if (config.hasDatabase) {
  pool = new Pool({
    connectionString: config.databaseUrl,
    // Render managed Postgres terminates TLS with its own certificate chain.
    ssl: config.isProduction ? { rejectUnauthorized: false } : false,

    // Pin every connection to our own schema, in the startup packet rather
    // than with a SET afterwards, so there is no window where a query could
    // run against the wrong search_path.
    //
    // Note there is deliberately NO `,public` fallback. If the schema is
    // missing, queries fail loudly - which is what we want. A fallback would
    // quietly create our tables in `public` and scribble over whatever else
    // shares this database.
    options: '-c search_path=' + config.dbSchema,

    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 6000
  });

  pool.on('error', function (err) {
    healthy = false;
    log.error('[db] idle client error:', err.message);
  });
}

/** Returns { rows } on success, or null when the database is unavailable. */
async function query(text, params) {
  if (!pool) return null;
  try {
    const res = await pool.query(text, params);
    healthy = true;
    return res;
  } catch (err) {
    healthy = false;
    log.error('[db] query failed:', err.message);
    return null;
  }
}

async function ping() {
  if (!pool) return false;
  const res = await query('SELECT 1 AS ok');
  return !!(res && res.rows && res.rows.length);
}

function isHealthy() {
  return !pool ? false : healthy;
}

function enabled() {
  return !!pool;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { query, ping, isHealthy, enabled, close, pool };
