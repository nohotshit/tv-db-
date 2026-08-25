/**
 * Status bar.
 *
 * Shows exactly what requirement 5 asks for: time, date, timezone, current
 * media, connected viewers, host, and TV status. It is also the honest place
 * where cloud state is reported - if the backend is gone, the dot goes grey and
 * says so rather than pretending everything is fine.
 */

import { $ } from '../core/dom.js';
import { state, subscribe } from '../core/state.js';
import { formatTime, formatDate, currentAbbrev, onTick } from '../core/clock.js';

let els = null;

export function initStatusbar() {
  els = {
    clock: $('#sb-clock'),
    date: $('#sb-date'),
    mediaDot: $('#sb-media-dot'),
    mediaText: $('#sb-media-text'),
    viewers: $('#sb-viewers-text'),
    host: $('#sb-host-text'),
    cloudDot: $('#sb-cloud-dot'),
    cloudText: $('#sb-cloud-text')
  };

  onTick(renderClock);
  renderClock(new Date());

  subscribe(['media', 'viewers', 'host', 'cloud', 'settings'], render);
  render();
}

function renderClock(now) {
  if (!els) return;
  els.clock.textContent = formatTime(now);
  els.date.textContent = formatDate(now) + '  ' + currentAbbrev(now);
}

function render() {
  if (!els) return;
  const m = state.media;

  // ---- now playing ----
  let label = 'Nothing playing';
  let dotClass = 'dot';
  if (m.title || m.url) {
    label = m.title || shortUrl(m.url);
    if (m.playback === 'playing') dotClass = 'dot is-ok';
    else if (m.playback === 'paused') dotClass = 'dot is-warn';
    else if (m.playback === 'buffering') dotClass = 'dot is-connecting';
  }
  if (m.external) label = label + '  (on screen)';
  els.mediaText.textContent = truncate(label, 34);
  els.mediaDot.className = dotClass;

  // ---- viewers ----
  els.viewers.textContent = String(state.viewers.length);

  // ---- host ----
  if (state.host) {
    els.host.textContent = state.host.name || 'Host';
    els.host.className = 'badge b-host';
  } else {
    const mode = state.tv.permissionMode;
    els.host.textContent = mode === 'everyone' ? 'Open to all' : 'No host';
    els.host.className = 'badge';
  }

  // ---- cloud ----
  const c = state.cloud;
  const texts = {
    online: 'Cloud', connecting: 'Connecting', offline: 'Local only', degraded: 'Degraded'
  };
  const dots = {
    online: 'dot is-ok', connecting: 'dot is-connecting', offline: 'dot', degraded: 'dot is-warn'
  };
  els.cloudText.textContent = texts[c.status] || c.status;
  els.cloudDot.className = dots[c.status] || 'dot';
  if (c.status === 'online' && c.latencyMs !== null) {
    els.cloudText.title = 'Round trip ' + c.latencyMs + ' ms, clock offset ' + c.offsetMs + ' ms';
  }
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}

function shortUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return u || '';
  }
}
