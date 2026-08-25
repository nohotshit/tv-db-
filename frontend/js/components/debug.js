/**
 * Developer overlay - requirement 34.
 *
 * Disabled by default. Turned on in Settings, Display, Debug mode, or by
 * loading the page with ?debug=1, which is how the LSL scripts enable it when
 * the owner picks Debug from the object menu.
 *
 * Everything shown here is already in memory. Nothing is collected or sent
 * anywhere for it.
 */

import { $, h, clear } from '../core/dom.js';
import { state, subscribe } from '../core/state.js';
import { config } from '../core/config.js';
import { recent } from '../core/log.js';
import { on } from '../core/bus.js';
import { isConnected } from '../core/socket.js';

let el = null;
let timer = null;
let unsub = null;

export function initDebug() {
  el = $('#debug');
  on('debug:toggle', function (enabled) { setEnabled(enabled); });
  setEnabled(!!(config.debug || state.settings.debug));
}

function setEnabled(enabled) {
  if (!el) return;
  el.classList.toggle('hidden', !enabled);

  if (enabled) {
    if (!unsub) unsub = subscribe(render);
    if (!timer) timer = setInterval(render, 1000);
    render();
  } else {
    if (unsub) { unsub(); unsub = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }
}

function row(k, v) {
  return h('div.d-row', [ h('span.d-key', k), h('span.d-val', String(v)) ]);
}

function render() {
  if (!el || el.classList.contains('hidden')) return;
  clear(el);

  const m = state.media;
  const c = state.cloud;

  el.appendChild(h('h4', 'Debug'));
  el.appendChild(h('div', [
    row('TV id', state.tv.id || '(unpaired)'),
    row('Region', state.tv.region || '\u2014'),
    row('Surface', config.surface),
    row('Me', state.me.name || '(anonymous screen)'),
    row('Role', state.me.role),
    row('Permission', state.tv.permissionMode),
    row('Host', state.host ? state.host.name : 'none')
  ]));

  el.appendChild(h('h4', { style: { marginTop: '0.5rem' } }, 'Media'));
  el.appendChild(h('div', [
    row('Title', m.title || '\u2014'),
    row('Url', m.url || '\u2014'),
    row('Source', m.source || '\u2014'),
    row('Playback', m.playback),
    row('Position', Math.round(m.positionMs / 1000) + ' s'),
    row('Live', m.isLive ? 'yes' : 'no'),
    row('On prim', m.external ? 'external site' : 'TV app')
  ]));

  el.appendChild(h('h4', { style: { marginTop: '0.5rem' } }, 'Sync'));
  el.appendChild(h('div', [
    row('Enabled', state.settings.syncEnabled ? 'yes' : 'no'),
    row('Tolerance', state.settings.syncToleranceS + ' s'),
    row('Drift', state.sync.driftS.toFixed(2) + ' s'),
    row('Corrections', state.sync.corrections),
    row('Last command', state.sync.lastCommand || '\u2014')
  ]));

  el.appendChild(h('h4', { style: { marginTop: '0.5rem' } }, 'Connection'));
  el.appendChild(h('div', [
    row('Backend', config.backendUrl || 'not configured'),
    row('WebSocket', isConnected() ? 'open' : c.status),
    row('Latency', c.latencyMs === null ? '\u2014' : c.latencyMs + ' ms'),
    row('Clock offset', c.offsetMs + ' ms'),
    row('Viewers', state.viewers.length),
    row('Last error', c.lastError || 'none'),
    row('Build', config.buildTime)
  ]));

  const logs = recent(12);
  const box = h('div.d-log');
  box.appendChild(h('div.d-key', 'Recent log'));
  logs.forEach(function (entry) {
    box.appendChild(h('div', { class: 'lvl-' + entry.lvl }, entry.msg));
  });
  el.appendChild(box);
}
