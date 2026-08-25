/**
 * Ring-buffer logger.
 *
 * Debug mode reads this buffer; nothing is ever sent off-device. Kept small
 * because a TV left running for days must not grow without bound.
 */

const MAX = 120;
const buffer = [];
let level = 'info';

const RANK = { debug: 10, info: 20, warn: 30, error: 40 };

export function setLevel(next) {
  if (RANK[next]) level = next;
}

function push(lvl, args) {
  if (RANK[lvl] < RANK[level]) return;
  const entry = {
    t: Date.now(),
    lvl: lvl,
    msg: args.map(stringify).join(' ')
  };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  if (window.console && console[lvl === 'debug' ? 'log' : lvl]) {
    console[lvl === 'debug' ? 'log' : lvl].apply(console, args);
  }
}

function stringify(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

export const log = {
  debug: function () { push('debug', Array.prototype.slice.call(arguments)); },
  info:  function () { push('info',  Array.prototype.slice.call(arguments)); },
  warn:  function () { push('warn',  Array.prototype.slice.call(arguments)); },
  error: function () { push('error', Array.prototype.slice.call(arguments)); }
};

/** Newest first, for the debug overlay. */
export function recent(n) {
  return buffer.slice(-(n || 30)).reverse();
}

export function clearLog() {
  buffer.length = 0;
}
