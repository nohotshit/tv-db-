'use strict';
/**
 * Entry point.
 *
 * One HTTP server carries both the REST API and the WebSocket upgrade, because
 * Render gives a service exactly one port. The periodic jobs are deliberately
 * few and slow - requirement 37 is about not wasting cycles, and it applies to
 * the server as much as to the scripts.
 */

const http = require('http');
const app = require('./app');
const wss = require('./realtime/wss');
const tvState = require('./services/tvState');
const db = require('./db/pool');
const migrate = require('./db/migrate');
const config = require('./config');
const log = require('./util/log');

const server = http.createServer(app);
// Kept on the server object so tests (and shutdown) can reach the socket set.
server.__wss = wss.attach(server);

/* ---- periodic work ------------------------------------------------------
   Two timers for the whole process:
     - flush dirty TV state to Postgres every 15 seconds
     - expire viewers who stopped reporting, every 30 seconds
   Anything more frequent would burn a free tier instance for no benefit.
   ------------------------------------------------------------------------ */

// unref: the listening socket is what keeps the process alive. These timers
// should never be the reason it refuses to exit, which also lets the test
// suite shut the server down cleanly.
const flushTimer = setInterval(function () {
  tvState.flush().catch(function (err) { log.warn('[flush]', err.message); });
}, 15000);
flushTimer.unref();

const presenceTimer = setInterval(function () {
  tvState.all().forEach(function (tv) {
    if (tvState.expireViewers(tv)) wss.broadcastViewers(tv);
  });
}, 30000);
presenceTimer.unref();

/**
 * Bring up the schema, then start serving.
 *
 * Migrations run HERE rather than in the build command, because the database
 * can be attached long after the first deploy - which is exactly what happens
 * when you point an existing Postgres at the service later. A build-time
 * migration would have run once, against nothing, and never again, leaving
 * the service to fail every query with "relation ... does not exist".
 *
 * It is deliberately non-fatal. A television whose database is unreachable
 * should still switch on: sync, presence, messaging and games are all in
 * memory, and only saved data is lost. Refusing to boot would turn a partial
 * outage into a total one.
 */
async function start() {
  if (config.hasDatabase) {
    try {
      await migrate.run();
    } catch (err) {
      log.error('[server] migrations failed:', err.message);
      log.warn('[server] continuing without stored data. Sync, presence and games still work.');
    }
  }

  server.listen(config.port, function () {
    log.info('[server] Musical Impact Smart TV backend listening on port', config.port);
    log.info('[server] environment:', config.env);
    log.info('[server] database:', config.hasDatabase ? 'configured' : 'NOT configured (memory only)');
    log.info('[server] frontend origin:', config.frontendUrl || '(none set)');
  });
}

start();

/* ---- shutdown -----------------------------------------------------------
   Render sends SIGTERM before replacing an instance. Flushing state first
   means a deploy does not lose whatever people were watching.
   ------------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('[server] received', signal, '- shutting down');

  clearInterval(flushTimer);
  clearInterval(presenceTimer);

  try {
    await tvState.flush();
  } catch (err) {
    log.warn('[server] final flush failed:', err.message);
  }

  server.close(function () {
    db.close().finally(function () { process.exit(0); });
  });

  // Do not hang forever on a stuck connection.
  setTimeout(function () { process.exit(0); }, 8000).unref();
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });

process.on('unhandledRejection', function (reason) {
  log.error('[server] unhandled rejection:', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', function (err) {
  // Log and keep serving. A television going dark because one request threw is
  // a worse outcome than running slightly wounded.
  log.error('[server] uncaught exception:', err.message);
  if (err.stack) log.debug(err.stack);
});

module.exports = server;
