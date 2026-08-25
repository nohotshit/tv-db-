/**
 * Home screen.
 *
 * The dashboard from requirement 5: every app as a tile, plus the live facts a
 * viewer needs at a glance - what is playing, who is here, who is in control,
 * and whether the TV is talking to the cloud.
 */

import { h, clear } from '../core/dom.js';
import { state, subscribe, canControl } from '../core/state.js';
import { APPS } from '../core/apps.js';
import { go } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { formatTime, formatDate, formatWeekday, currentAbbrev, onTick } from '../core/clock.js';

let unsubscribe = null;
let untick = null;
let refs = null;

export const home = {
  id: 'home',
  title: 'Home',

  mount: function (container) {
    const grid = h('div.tile-grid', APPS.map(makeTile));

    const info = h('div.row.wrap', { style: { gap: '0.8rem', marginTop: '1.1rem' } }, [
      infoCard('Now playing', 'nowPlaying', '\u2014'),
      infoCard('Controller', 'controller', '\u2014'),
      infoCard('Viewers', 'viewers', '0'),
      infoCard('TV status', 'status', '\u2014')
    ]);

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ 'Good ', h('span.accent', greeting()), ' \u2014 what are we watching?' ]),
        h('span.grow'),
        h('div.col', { style: { gap: 0, textAlign: 'right' } }, [
          h('div', { id: 'home-day', style: { fontSize: '0.82rem' } }),
          h('div.faint', { id: 'home-date', style: { fontSize: '0.72rem' } })
        ])
      ]),
      h('div.view-body', [ grid, info ])
    ]);

    container.appendChild(view);
    setScope(view);

    refs = {
      nowPlaying: view.querySelector('[data-info="nowPlaying"]'),
      controller: view.querySelector('[data-info="controller"]'),
      viewers: view.querySelector('[data-info="viewers"]'),
      status: view.querySelector('[data-info="status"]'),
      day: view.querySelector('#home-day'),
      date: view.querySelector('#home-date'),
      grid: grid
    };

    unsubscribe = subscribe(['media', 'viewers', 'host', 'cloud', 'tv', 'me'], render);
    untick = onTick(renderDate);
    render();
    renderDate(new Date());
  },

  unmount: function () {
    if (unsubscribe) unsubscribe();
    if (untick) untick();
    unsubscribe = untick = refs = null;
  }
};

function makeTile(app) {
  const locked = !canControl() && app.mode !== 'app';
  return h('div.tile.focusable', {
    dataset: { app: app.id },
    class: 'tile focusable' + (locked ? ' is-locked' : ''),
    onclick: function () { go(app.id); }
  }, [
    h('div.tile-icon', app.icon),
    h('div.tile-label', app.label),
    h('div.tile-hint', locked ? 'View only' : app.hint)
  ]);
}

function infoCard(label, key, initial) {
  return h('div.list-row', { style: { minWidth: '11rem' } }, [
    h('div.lr-main', [
      h('div.lr-sub', label),
      h('div.lr-title', { dataset: { info: key } }, initial)
    ])
  ]);
}

function greeting() {
  const hour = Number(formatTime(new Date(), { format: '24', seconds: false }).slice(0, 2));
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function renderDate(now) {
  if (!refs) return;
  refs.day.textContent = formatWeekday(now);
  refs.date.textContent = formatDate(now) + ' \u00B7 ' + currentAbbrev(now);
}

function render() {
  if (!refs) return;
  const m = state.media;

  refs.nowPlaying.textContent = m.title || (m.url ? m.url : 'Nothing playing');

  if (state.host) {
    refs.controller.textContent = state.host.name +
      (state.host.key === state.me.key ? ' (you)' : '');
  } else if (state.tv.permissionMode === 'everyone') {
    refs.controller.textContent = 'Anyone present';
  } else if (state.tv.permissionMode === 'group') {
    refs.controller.textContent = 'Group members';
  } else {
    refs.controller.textContent = 'Owner only';
  }

  refs.viewers.textContent = state.viewers.length === 1
    ? '1 person here'
    : state.viewers.length + ' people here';

  const c = state.cloud.status;
  if (!state.tv.powered) refs.status.textContent = 'Standby';
  else if (c === 'online') refs.status.textContent = 'Ready \u00B7 cloud connected';
  else if (c === 'connecting') refs.status.textContent = 'Connecting to cloud';
  else refs.status.textContent = 'Local mode \u00B7 cloud unavailable';

  // Tiles can lock and unlock as control changes hands.
  Array.prototype.forEach.call(refs.grid.children, function (tile) {
    const id = tile.dataset.app;
    const app = APPS.filter(function (a) { return a.id === id; })[0];
    if (!app) return;
    const locked = !canControl() && app.mode !== 'app';
    tile.classList.toggle('is-locked', locked);
    const hint = tile.querySelector('.tile-hint');
    if (hint) hint.textContent = locked ? 'View only' : app.hint;
  });
}
