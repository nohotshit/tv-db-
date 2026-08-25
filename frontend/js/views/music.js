/**
 * Music.
 *
 * This is the one media section that runs entirely inside our own page, which
 * makes it the one section where every control in requirement 8 genuinely
 * works: play, pause, stop, next, previous, volume, mute, search, genres,
 * playlists, favorites, recently played.
 *
 * It plays audio through an HTML5 <audio> element, so:
 *   - volume and mute are real (unlike on external sites, where the viewer
 *     media slider is the only volume control that exists)
 *   - position is readable and seekable, so the sync engine can hold every
 *     viewer inside the tolerance window
 *
 * Sources are stream urls - the same Icecast and Shoutcast streams Second Life
 * parcels have always used - plus anything the owner adds. The station list is
 * data, not code: edit assets/stations.json or add stations in the UI.
 */

import { h, clear } from '../core/dom.js';
import { state, patch, subscribe, canControl } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { keyboard } from '../components/keyboard.js';
import { registerPlayer, unregisterPlayer, command } from '../core/sync.js';
import { addFavorite, removeFavorite, isFavorite, addHistory } from '../core/userdata.js';
import { formatDuration } from '../core/clock.js';
import * as storage from '../core/storage.js';
import { emit } from '../core/bus.js';
import { log } from '../core/log.js';

let audio = null;
let unsub = null;
let refs = null;
let stations = [];
let filter = { genre: 'all', query: '' };

export const music = {
  id: 'music',
  title: 'Music',

  mount: async function (container) {
    stations = await loadStations();

    const search = h('input.input.grow', { type: 'text', placeholder: 'Search stations' });
    search.addEventListener('input', function () {
      filter.query = search.value.trim().toLowerCase();
      drawList();
    });

    const listBox = h('div.list');
    const genreRow = h('div.row.wrap');
    const transport = h('div.transport');

    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u{1F3B5} ', h('span.accent', 'Music') ]),
        h('span.view-sub', 'Plays inside the TV, so it stays in sync'),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: addStationPrompt }, '+ Add station'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.view-body', [
        h('div.section', [ h('div.row', [ search ]), genreRow ]),
        h('div.section', [ h('h3', 'Stations'), listBox ])
      ]),
      h('div.view-foot', [ transport ])
    ]);

    container.appendChild(view);
    setScope(view);

    refs = { listBox: listBox, genreRow: genreRow, transport: transport, search: search };

    mountAudio();
    drawGenres();
    drawList();
    drawTransport();

    unsub = subscribe(['media', 'volume', 'muted', 'favorites', 'queue'], function () {
      drawTransport();
      drawList();
    });
  },

  unmount: function () {
    if (unsub) unsub();
    unregisterPlayer(adapter);
    // The <audio> element is intentionally NOT destroyed: leaving the music
    // section should not stop the music, exactly like a real TV.
    unsub = null;
    refs = null;
  }
};

/* -------------------------------------------------------------------------
   Audio element and sync adapter
   ------------------------------------------------------------------------- */

const adapter = {
  getPositionMs: function () { return audio ? audio.currentTime * 1000 : 0; },
  getDurationMs: function () {
    return audio && isFinite(audio.duration) ? audio.duration * 1000 : 0;
  },
  seekMs: function (ms) {
    if (!audio) return;
    // A live stream has no seekable range worth talking about; seeking one
    // just triggers a rebuffer, so skip it.
    if (!adapter.isSeekable()) return;
    try { audio.currentTime = ms / 1000; } catch (e) { /* not ready yet */ }
  },
  play: function () { if (audio) audio.play().catch(function () { /* autoplay blocked */ }); },
  pause: function () { if (audio) audio.pause(); },
  setRate: function (r) { if (audio) audio.playbackRate = r; },
  isLive: function () { return !audio || !isFinite(audio.duration) || audio.duration === Infinity; },
  isSeekable: function () {
    return !!audio && isFinite(audio.duration) && audio.duration > 0;
  }
};

function mountAudio() {
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'mi-audio';
    audio.preload = 'none';
    audio.crossOrigin = 'anonymous';
    document.body.appendChild(audio);

    audio.addEventListener('playing', function () {
      patch({ media: { playback: 'playing' } });
    });
    audio.addEventListener('pause', function () {
      if (state.media.playback === 'playing') patch({ media: { playback: 'paused' } });
    });
    audio.addEventListener('waiting', function () {
      patch({ media: { playback: 'buffering' } });
    });
    audio.addEventListener('ended', function () { next(); });
    audio.addEventListener('error', function () {
      patch({ media: { playback: 'stopped' } });
      emit('notice', {
        level: 'error',
        title: 'Unable to connect to the media service',
        message: 'That stream did not respond. Try another station, or check the address.'
      });
      log.warn('[music] stream error for', state.media.url);
    });
  }
  applyVolume();
  registerPlayer(adapter);
}

function applyVolume() {
  if (!audio) return;
  audio.volume = Math.max(0, Math.min(1, state.volume / 100));
  audio.muted = !!state.muted;
}

/* -------------------------------------------------------------------------
   Playback control
   -------------------------------------------------------------------------
   Every one of these routes through sync.command(), so pressing Play here
   plays for everybody, not just the person who pressed it. The backend decides
   whether the press was allowed.
   ------------------------------------------------------------------------- */

export function playStation(station) {
  if (!canControl()) {
    emit('notice', { level: 'warn', title: 'Not in control', message: 'Ask the host to change the station.' });
    return;
  }
  patch({
    media: {
      title: station.name, url: station.url, source: 'music',
      isLive: true, external: false, playback: 'buffering', positionMs: 0
    }
  });
  if (audio) {
    audio.src = station.url;
    audio.load();
  }
  addHistory({ title: station.name, url: station.url, source: 'music' });
  command('select', {
    media: { title: station.name, url: station.url, source: 'music', isLive: true }
  });
  command('play');
}

export function togglePlay() {
  if (state.media.playback === 'playing') command('pause');
  else command('play');
}

export function stop() { command('stop'); }

export function next() {
  const list = visibleStations();
  if (!list.length) return;
  const i = list.findIndex(function (s) { return s.url === state.media.url; });
  playStation(list[(i + 1 + list.length) % list.length]);
}

export function previous() {
  const list = visibleStations();
  if (!list.length) return;
  const i = list.findIndex(function (s) { return s.url === state.media.url; });
  playStation(list[(i - 1 + list.length) % list.length]);
}

export function setVolume(v) {
  const vol = Math.max(0, Math.min(100, Math.round(v)));
  patch({ volume: vol, muted: vol === 0 ? state.muted : false });
  storage.set('volume', vol);
  applyVolume();
}

export function toggleMute() {
  patch({ muted: !state.muted });
  applyVolume();
}

/* -------------------------------------------------------------------------
   Station catalogue
   -------------------------------------------------------------------------
   Data, not code. `assets/stations.json` ships with a handful of genre slots
   and no urls filled in, because a stream address that is wrong is worse than
   one that is absent: the TV would appear broken. Add your own stations here
   or through the Add station button, and they persist per viewer.
   ------------------------------------------------------------------------- */

async function loadStations() {
  let bundled = [];
  try {
    const res = await fetch('assets/stations.json', { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      bundled = Array.isArray(json.stations) ? json.stations : [];
    }
  } catch (e) {
    log.warn('[music] stations.json unreadable');
  }
  const custom = storage.get('stations', []);
  return bundled.concat(custom).filter(function (s) { return s && s.url && s.name; });
}

function addStationPrompt() {
  const name = h('input.input', { type: 'text', placeholder: 'Station name' });
  const url = h('input.input.mono', { type: 'text', placeholder: 'https://stream.example.com/live' });
  const genre = h('input.input', { type: 'text', placeholder: 'Genre (optional)' });

  import('../components/modal.js').then(function (m) {
    m.openModal({
      title: 'Add a station',
      body: h('div.col', [
        h('div.field', [ h('label', 'Name'), name ]),
        h('div.field', [ h('label', 'Stream address'), url ]),
        h('div.field', [ h('label', 'Genre'), genre ]),
        h('div.why', 'Use a direct Icecast or Shoutcast stream address, the same kind Second Life parcel audio accepts.')
      ]),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Add', primary: true, onclick: function () {
            if (!name.value.trim() || !url.value.trim()) return;
            const custom = storage.get('stations', []);
            custom.push({
              name: name.value.trim(),
              url: url.value.trim(),
              genre: genre.value.trim() || 'Custom',
              custom: true
            });
            storage.set('stations', custom);
            loadStations().then(function (s) { stations = s; drawGenres(); drawList(); });
          }
        }
      ]
    });
  });
}

function genres() {
  const set = Object.create(null);
  stations.forEach(function (s) { set[s.genre || 'Other'] = true; });
  return ['all'].concat(Object.keys(set).sort());
}

function visibleStations() {
  return stations.filter(function (s) {
    if (filter.genre !== 'all' && (s.genre || 'Other') !== filter.genre) return false;
    if (filter.query && s.name.toLowerCase().indexOf(filter.query) < 0) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------------- */

function drawGenres() {
  if (!refs) return;
  clear(refs.genreRow);
  genres().forEach(function (g) {
    refs.genreRow.appendChild(h('button.btn.btn-sm.focusable', {
      class: 'btn btn-sm focusable' + (filter.genre === g ? ' btn-primary' : ''),
      onclick: function () { filter.genre = g; drawGenres(); drawList(); }
    }, g === 'all' ? 'All genres' : g));
  });
}

function drawList() {
  if (!refs) return;
  clear(refs.listBox);
  const list = visibleStations();

  if (!list.length) {
    refs.listBox.appendChild(h('div.empty', [
      h('div.empty-icon', '\u{1F3B6}'),
      h('div', stations.length ? 'No stations match that search' : 'No stations configured yet'),
      h('div.faint', stations.length ? '' : 'Use Add station, or edit assets/stations.json')
    ]));
    return;
  }

  list.forEach(function (s) {
    const current = state.media.url === s.url;
    refs.listBox.appendChild(h('div.list-row.focusable', {
      class: 'list-row focusable' + (current ? ' is-current' : ''),
      onclick: function () { playStation(s); }
    }, [
      h('div.lr-main', [
        h('div.lr-title.ellipsis', s.name),
        h('div.lr-sub.ellipsis', (s.genre || 'Other') + (current ? ' \u00B7 now playing' : ''))
      ]),
      h('div.lr-actions', [
        isFavorite(s.url)
          ? h('button.btn.btn-sm.btn-ghost', {
              onclick: function (ev) {
                ev.stopPropagation();
                const fav = state.favorites.filter(function (f) { return f.url === s.url; })[0];
                if (fav) removeFavorite(fav.id);
              }
            }, '\u2605')
          : h('button.btn.btn-sm.btn-ghost', {
              onclick: function (ev) {
                ev.stopPropagation();
                addFavorite({ title: s.name, url: s.url, source: 'music' });
              }
            }, '\u2606')
      ])
    ]));
  });
}

function drawTransport() {
  if (!refs) return;
  clear(refs.transport);

  const m = state.media;
  const playing = m.playback === 'playing';
  const live = adapter.isLive();

  refs.transport.appendChild(h('div.row', [
    h('button.btn.btn-icon.focusable', { onclick: previous, title: 'Previous station' }, '\u23EE'),
    h('button.btn.btn-icon.btn-primary.focusable', { onclick: togglePlay, title: 'Play or pause' },
      playing ? '\u23F8' : '\u25B6'),
    h('button.btn.btn-icon.focusable', { onclick: stop, title: 'Stop' }, '\u23F9'),
    h('button.btn.btn-icon.focusable', { onclick: next, title: 'Next station' }, '\u23ED')
  ]));

  refs.transport.appendChild(h('div.t-now', [
    h('div.t-title.ellipsis', m.source === 'music' && m.title ? m.title : 'Nothing playing'),
    h('div.t-src', m.source === 'music'
      ? (live ? 'Live stream' : formatDuration(m.positionMs) + ' / ' + formatDuration(m.durationMs))
      : (m.title ? 'Another source is on screen' : 'Pick a station to begin')),
    h('div.progress', { class: 'progress' + (live ? ' is-live' : '') }, [ h('i') ])
  ]));

  refs.transport.appendChild(h('div.row', [
    h('button.btn.btn-icon.focusable', {
      onclick: toggleMute, title: state.muted ? 'Unmute' : 'Mute'
    }, state.muted ? '\u{1F507}' : '\u{1F50A}'),
    h('input.slider', {
      type: 'range', min: '0', max: '100', value: String(state.volume),
      style: { width: '7rem' },
      oninput: function (ev) { setVolume(Number(ev.target.value)); }
    }),
    h('span.t-time', String(state.muted ? 0 : state.volume))
  ]));
}
