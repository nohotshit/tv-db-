/**
 * localStorage wrapper.
 *
 * CEF inside the viewer sometimes runs with storage disabled or a full quota,
 * and a throwing setItem must never break playback. Everything degrades to an
 * in-memory map for the current session.
 */

import { log } from './log.js';

const PREFIX = 'mismarttv.';
const memory = Object.create(null);
let usable = true;

try {
  const probe = PREFIX + 'probe';
  window.localStorage.setItem(probe, '1');
  window.localStorage.removeItem(probe);
} catch (e) {
  usable = false;
  log.warn('[storage] localStorage unavailable, using memory only');
}

export function get(key, fallback) {
  const k = PREFIX + key;
  try {
    const raw = usable ? window.localStorage.getItem(k) : memory[k];
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function set(key, value) {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (usable) window.localStorage.setItem(k, raw);
    else memory[k] = raw;
  } catch (e) {
    memory[k] = raw;
    log.warn('[storage] write failed for', key);
  }
}

export function remove(key) {
  const k = PREFIX + key;
  try { if (usable) window.localStorage.removeItem(k); } catch (e) { /* ignore */ }
  delete memory[k];
}
