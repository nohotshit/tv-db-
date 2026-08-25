'use strict';
/** Levelled console logging. Structured enough to read in Render log search. */

const config = require('../config');

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };
const min = RANK[config.logLevel] || RANK.info;

function emit(level, args) {
  if (RANK[level] < min) return;
  const line = '[' + new Date().toISOString() + '] ' + level.toUpperCase() + ' ';
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn.apply(console, [line].concat(Array.prototype.slice.call(args)));
}

module.exports = {
  debug: function () { emit('debug', arguments); },
  info:  function () { emit('info', arguments); },
  warn:  function () { emit('warn', arguments); },
  error: function () { emit('error', arguments); }
};
