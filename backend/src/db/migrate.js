'use strict';
/**
 * Migration runner.
 *
 * Applies every .sql file in migrations/ in name order, once, tracked in a
 * schema_migrations table. Safe to run on every deploy.
 *
 *   npm run migrate
 *
 * If DATABASE_URL is not set it exits successfully and says so, because the
 * project is designed to run without a database at all.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { pool } = require('./pool');
const log = require('../util/log');

async function run() {
  if (!config.hasDatabase) {
    log.warn('[migrate] DATABASE_URL not set; nothing to do.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.sql'); }).sort();

  const done = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.rows.map(function (r) { return r.name; }));

  for (const file of files) {
    if (applied.has(file)) {
      log.debug('[migrate] already applied:', file);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.info('[migrate] applied', file);
    } catch (err) {
      await client.query('ROLLBACK');
      log.error('[migrate] FAILED on', file, '-', err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  log.info('[migrate] up to date.');
}

if (require.main === module) {
  run()
    .then(function () { return pool.end(); })
    .then(function () { process.exit(0); })
    .catch(function (err) {
      log.error('[migrate]', err.message);
      process.exit(1);
    });
}

module.exports = { run };
