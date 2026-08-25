/**
 * Clock, timezones and date formatting.
 *
 * Timezones are IANA identifiers driven through Intl.DateTimeFormat, never
 * fixed UTC offsets. That is the whole point: EST and EDT are the same zone
 * (America/New_York) at different times of year, and hardcoding -5 or -4 would
 * be wrong for half the year. Intl asks the platform tzdata which rule applies
 * to the instant being formatted, so DST transitions are correct for free.
 *
 * Arizona and Hawaii are listed separately because they do not observe DST.
 */

import { state } from './state.js';

export const ZONES = [
  { id: 'America/New_York',    label: 'Eastern',        abbrev: 'EST / EDT' },
  { id: 'America/Chicago',     label: 'Central',        abbrev: 'CST / CDT' },
  { id: 'America/Denver',      label: 'Mountain',       abbrev: 'MST / MDT' },
  { id: 'America/Phoenix',     label: 'Arizona',        abbrev: 'MST, no DST' },
  { id: 'America/Los_Angeles', label: 'Pacific / SLT',  abbrev: 'PST / PDT' },
  { id: 'America/Anchorage',   label: 'Alaska',         abbrev: 'AKST / AKDT' },
  { id: 'Pacific/Honolulu',    label: 'Hawaii',         abbrev: 'HST, no DST' },
  { id: 'UTC',                 label: 'Coordinated UT', abbrev: 'UTC' },
  { id: 'America/Sao_Paulo',   label: 'Brazil',         abbrev: 'BRT' },
  { id: 'Europe/London',       label: 'United Kingdom', abbrev: 'GMT / BST' },
  { id: 'Europe/Paris',        label: 'Central Europe', abbrev: 'CET / CEST' },
  { id: 'Asia/Tokyo',          label: 'Japan',          abbrev: 'JST' },
  { id: 'Australia/Sydney',    label: 'Sydney',         abbrev: 'AEST / AEDT' }
];

const cache = Object.create(null);

function fmt(key, options) {
  if (!cache[key]) {
    try {
      cache[key] = new Intl.DateTimeFormat('en-US', options);
    } catch (e) {
      // Unknown zone on an old CEF tzdata build. Fall back to UTC rather than
      // silently showing local machine time, which would be misleading.
      const safe = Object.assign({}, options, { timeZone: 'UTC' });
      cache[key] = new Intl.DateTimeFormat('en-US', safe);
    }
  }
  return cache[key];
}

function tz() {
  return state.settings.timezone || 'UTC';
}

/** "8:45 PM" or "20:45", honouring the seconds preference. */
export function formatTime(date, opts) {
  const d = date || new Date();
  const s = state.settings;
  const use12 = (opts && opts.format ? opts.format : s.timeFormat) === '12';
  const seconds = opts && 'seconds' in opts ? opts.seconds : s.showSeconds;
  const zone = (opts && opts.timezone) || tz();

  const key = 'T' + zone + use12 + seconds;
  const out = fmt(key, {
    timeZone: zone,
    hour: use12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: use12
  }).format(d);

  // Some ICU builds insert a narrow no-break space before the meridiem, which
  // breaks our tabular alignment. Normalise it.
  return out.replace(/\u202f/g, ' ');
}

/** Date in the order the user picked. */
export function formatDate(date, opts) {
  const d = date || new Date();
  const zone = (opts && opts.timezone) || tz();
  const style = (opts && opts.format) || state.settings.dateFormat;

  const parts = fmt('D' + zone, {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);

  const get = function (t) {
    const p = parts.filter(function (x) { return x.type === t; })[0];
    return p ? p.value : '';
  };
  const Y = get('year'), M = get('month'), D = get('day');

  if (style === 'DD/MM/YYYY') return D + '/' + M + '/' + Y;
  if (style === 'YYYY-MM-DD') return Y + '-' + M + '-' + D;
  return M + '/' + D + '/' + Y;
}

/** "Monday" in the selected zone. */
export function formatWeekday(date, opts) {
  const zone = (opts && opts.timezone) || tz();
  return fmt('W' + zone, { timeZone: zone, weekday: 'long' }).format(date || new Date());
}

/**
 * The abbreviation actually in force right now - EST in January, EDT in July -
 * rather than a label we guessed at design time.
 */
export function currentAbbrev(date, zone) {
  const z = zone || tz();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: z, timeZoneName: 'short', hour: 'numeric'
    }).formatToParts(date || new Date());
    const p = parts.filter(function (x) { return x.type === 'timeZoneName'; })[0];
    return p ? p.value : z;
  } catch (e) {
    return z;
  }
}

/** Minutes east of UTC for an instant in a zone. */
export function offsetMinutes(date, zone) {
  const d = date || new Date();
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone || tz(),
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = Object.create(null);
    f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    const hour = p.hour === '24' ? 0 : Number(p.hour);
    const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                           hour, Number(p.minute), Number(p.second));
    return Math.round((asUTC - d.getTime()) / 60000);
  } catch (e) {
    return 0;
  }
}

/** True when the selected zone is currently observing daylight saving time. */
export function isDST(date, zone) {
  const z = zone || tz();
  const d = date || new Date();
  const y = d.getUTCFullYear();
  const jan = offsetMinutes(new Date(Date.UTC(y, 0, 1)), z);
  const jul = offsetMinutes(new Date(Date.UTC(y, 6, 1)), z);
  if (jan === jul) return false;                 // zone has no DST at all
  return offsetMinutes(d, z) === Math.max(jan, jul);
}

/** mm:ss or h:mm:ss for media positions. */
export function formatDuration(ms) {
  if (!isFinite(ms) || ms < 0) return '--:--';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

/** "3m ago", for history and message lists. */
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 45000) return 'just now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

/**
 * One shared, wall-clock-aligned tick for the whole app.
 *
 * A TV that runs for days must not accumulate a stack of drifting setIntervals,
 * and Second Life performance guidance applies just as much to the browser
 * side: one timer, many subscribers.
 */
let tickHandlers = [];
let tickTimer = null;

export function onTick(fn) {
  tickHandlers.push(fn);
  if (!tickTimer) scheduleTick();
  return function () {
    const i = tickHandlers.indexOf(fn);
    if (i >= 0) tickHandlers.splice(i, 1);
  };
}

function scheduleTick() {
  const delay = 1000 - (Date.now() % 1000);
  tickTimer = setTimeout(function () {
    const now = new Date();
    tickHandlers.slice().forEach(function (fn) {
      try { fn(now); } catch (e) { /* one broken widget must not stop the clock */ }
    });
    scheduleTick();
  }, delay);
}
