/**
 * Remote HUD page.
 *
 * This is the personal surface. The TV screen shows the same page to every
 * avatar in range and cannot tell who is looking at it or who clicked it, so
 * anything that needs to know WHO is doing something has to happen here: the
 * HUD is attached to exactly one avatar, and the LSL script builds its media
 * url with that avatar key and a short-lived token.
 *
 * Every button sends a command to the backend, which validates it against the
 * TV permission mode and relays it to the object and to every connected
 * screen. When the backend is unreachable the HUD says so and the in-world
 * script keeps its own local button path working.
 */

import { $, $$, h, clear } from './core/dom.js';
import { config, hasIdentity } from './core/config.js';
import { state, patch, subscribe } from './core/state.js';
import { loadBranding } from './core/branding.js';
import { loadSettingsLocal, loadUserData, removeFavorite, addFavorite } from './core/userdata.js';
import { connect, send, isConnected } from './core/socket.js';
import { on, emit } from './core/bus.js';
import { initToasts } from './components/toast.js';
import { initModals } from './components/modal.js';
import { setScope } from './components/nav.js';
import { hostOf } from './core/moap.js';
import { log } from './core/log.js';

async function start() {
  await loadBranding();
  loadSettingsLocal();
  initToasts();
  initModals();

  patch({
    tv: { id: config.tvId || 'local-tv' },
    me: { key: config.userKey, name: config.userName || '' }
  });

  $('#hud-name').textContent = config.userName || 'Not linked';
  $('#hud-tv').textContent = config.tvId ? 'TV ' + config.tvId.slice(0, 8) : 'no TV paired';

  if (!hasIdentity()) {
    emit('notice', {
      level: 'warn',
      title: 'HUD not linked',
      message: 'Touch the TV with this HUD worn to pair them.',
      timeoutMs: 9000
    });
  }

  wireButtons();
  connect();
  loadUserData();

  subscribe(['cloud', 'host', 'me', 'favorites', 'media'], render);
  on('cloud:connected', render);
  on('cloud:lost', render);
  render();
  setScope($('#hud'));
}

function wireButtons() {
  // Media transport and system commands.
  $$('[data-cmd]').forEach(function (btn) {
    btn.classList.add('focusable');
    btn.addEventListener('click', function () {
      const cmd = btn.getAttribute('data-cmd');
      dispatch(cmd);
    });
  });

  // App launchers.
  $$('[data-app]').forEach(function (btn) {
    btn.classList.add('focusable');
    btn.addEventListener('click', function () {
      relay('remote', { kind: 'app', value: btn.getAttribute('data-app') });
    });
  });

  $('#hud-claim').addEventListener('click', claimControl);

  $('#hud-fav-add').addEventListener('click', function () {
    if (!state.media.url) {
      emit('notice', { level: 'warn', title: 'Nothing to save', message: 'Open something on the TV first.' });
      return;
    }
    addFavorite({
      title: state.media.title || hostOf(state.media.url),
      url: state.media.url,
      source: state.media.source || 'web'
    });
    emit('notice', { level: 'ok', title: 'Saved', message: 'Added to your favorites.' });
  });
}

const NAV_KEYS = ['up', 'down', 'left', 'right', 'select', 'back', 'home'];
const MEDIA_CMDS = ['power', 'playpause', 'stop', 'next', 'prev', 'volup', 'voldown', 'mute', 'resync'];

function dispatch(cmd) {
  if (NAV_KEYS.indexOf(cmd) >= 0) relay('remote', { kind: 'key', value: cmd });
  else if (MEDIA_CMDS.indexOf(cmd) >= 0) relay('remote', { kind: 'media', value: cmd });
  else log.warn('[hud] unknown command', cmd);
}

/**
 * Send a command to the backend, which fans it out to the TV screens and to
 * the in-world object.
 */
function relay(type, payload) {
  if (!isConnected()) {
    emit('notice', {
      level: 'warn',
      title: 'Cloud unavailable',
      message: 'The HUD reaches the TV through the cloud. The object menu still works while it is down.'
    });
    return;
  }
  send(type, Object.assign({ tvId: state.tv.id, user: { key: config.userKey, name: config.userName } }, payload));
}

function claimControl() {
  if (!hasIdentity()) {
    emit('notice', { level: 'warn', title: 'Not linked', message: 'Touch the TV while wearing this HUD.' });
    return;
  }
  relay('host', { action: state.me.role === 'host' ? 'release' : 'claim' });
}

function render() {
  const dot = $('#hud-cloud-dot');
  const status = $('#hud-status');
  const role = $('#hud-role');
  const claim = $('#hud-claim');

  const c = state.cloud.status;
  dot.className = 'dot' + (c === 'online' ? ' is-ok' : c === 'connecting' ? ' is-connecting' : '');
  status.textContent = c === 'online'
    ? 'linked \u00B7 ' + (state.cloud.latencyMs === null ? '' : state.cloud.latencyMs + ' ms')
    : c === 'connecting' ? 'connecting' : 'local mode \u00B7 cloud unreachable';

  const r = state.me.role;
  role.textContent = r === 'owner' ? 'Owner' : r === 'host' ? 'Host' : 'Viewer';
  role.className = 'badge' + (r === 'viewer' ? '' : ' b-host');

  claim.textContent = r === 'host' ? 'Release control' : 'Request control';
  claim.classList.toggle('hidden', state.tv.permissionMode === 'everyone' || r === 'owner');

  // Volume buttons only do something real when the TV itself is the player.
  const volNote = $('#hud-vol-note');
  const external = !!state.media.external;
  volNote.classList.toggle('hidden', !external);
  ['volup', 'voldown', 'mute'].forEach(function (cmd) {
    const btn = document.querySelector('[data-cmd="' + cmd + '"]');
    if (btn) btn.classList.toggle('is-disabled', external);
  });

  drawFavorites();
}

function drawFavorites() {
  const list = $('#hud-favs');
  clear(list);

  if (!state.favorites.length) {
    list.appendChild(h('div.empty', { style: { padding: '1rem 0' } }, [
      h('div.empty-icon', '\u2606'),
      h('div', { style: { fontSize: '0.72rem' } }, 'No favorites yet')
    ]));
    return;
  }

  state.favorites.forEach(function (f) {
    list.appendChild(h('div.list-row.focusable', {
      onclick: function () { relay('remote', { kind: 'open', value: f.url, title: f.title, source: f.source }); }
    }, [
      h('div.lr-main', [
        h('div.lr-title.ellipsis', f.title),
        h('div.lr-sub.ellipsis', hostOf(f.url))
      ]),
      h('div.lr-actions', [
        h('button.btn.btn-sm.btn-ghost', {
          onclick: function (ev) { ev.stopPropagation(); removeFavorite(f.id); }
        }, '\u00D7')
      ])
    ]));
  });
}

start();
