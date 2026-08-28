/**
 * Musical Impact Smart TV - application entry point.
 *
 * Boot order matters, and it is deliberately failure-tolerant at every step:
 * branding, then local preferences, then the shell, then the cloud. Only the
 * last of those can fail, and when it does the TV carries on with local
 * controls, the clock, settings, the idle screen and local games, exactly as
 * requirement 36 asks.
 */

import { $ } from './core/dom.js';
import { config } from './core/config.js';
import { state, patch, canControl } from './core/state.js';
import { loadBranding } from './core/branding.js';
import { loadSettingsLocal, loadSettingsCloud, loadUserData, applySettingsToDocument } from './core/userdata.js';
import { connect } from './core/socket.js';
import { log, setLevel } from './core/log.js';
import { on, emit } from './core/bus.js';
import * as router from './core/router.js';

import { initStatusbar } from './components/statusbar.js';
import { initToasts } from './components/toast.js';
import { initModals } from './components/modal.js';
import { initDebug } from './components/debug.js';
import { bootProgress, finishBoot, initIdle, noteActivity } from './components/screens.js';
import { setScope } from './components/nav.js';

import { home } from './views/home.js';
import { movies } from './views/movies.js';
import { youtube } from './views/youtube.js';
import { music } from './views/music.js';
import { twitch } from './views/twitch.js';
import { kick } from './views/kick.js';
import { browser } from './views/browser.js';
import { messages } from './views/messages.js';
import { games } from './views/games.js';
import { clockView } from './views/clockview.js';
import { settings } from './views/settings.js';

async function start() {
  window.addEventListener('error', function (ev) {
    log.error('[window]', ev.message);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    log.error('[promise]', ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason));
  });

  bootProgress(10, 'Loading branding...');
  await loadBranding();

  bootProgress(28, 'Reading preferences...');
  loadSettingsLocal();
  if (config.debug) { patch({ settings: { debug: true } }); setLevel('debug'); }
  applySettingsToDocument();

  bootProgress(46, 'Preparing interface...');
  patch({
    tv: { id: config.tvId || 'local-tv' },
    me: { key: config.userKey, name: config.userName || '' }
  });

  registerViews();
  initToasts();
  initModals();
  initStatusbar();
  initDebug();
  initIdle();
  wireRemote();
  wireViewSync();

  bootProgress(64, config.backendUrl ? 'Connecting to cloud...' : 'Cloud not configured');
  connect();
  loadUserData();
  loadSettingsCloud();

  bootProgress(88, 'Almost there...');
  await settle();

  bootProgress(100, 'Ready');
  setTimeout(function () {
    finishBoot();
    router.go(startView(), {}, false);
    setScope($('#viewport'));
  }, 320);
}

function registerViews() {
  router.init($('#viewport'));
  // `music` is deliberately absent: the Music tile was removed. The module
  // is still imported, because the HUD volume, mute, next and previous
  // buttons drive the audio element it owns.
  [home, movies, youtube, twitch, kick, browser, messages, games, clockView, settings]
    .forEach(router.register);
}

/** Where to open after boot. */
function startView() {
  if (config.startView && router.known(config.startView)) return config.startView;
  const pref = state.settings.defaultSource;
  if (pref && pref !== 'last' && router.known(pref)) return pref;
  return 'home';
}

/**
 * Give the socket a brief moment to land so the first screen is already
 * populated. Capped, because the boot screen must never hang waiting for a
 * backend that is asleep - Render free instances take the better part of a
 * minute to wake, and the TV should be usable long before that.
 */
function settle() {
  return new Promise(function (resolve) {
    if (!config.backendUrl) return resolve();
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(); } };
    on('cloud:connected', finish);
    on('cloud:lost', finish);
    setTimeout(finish, 1800);
  });
}

/* -------------------------------------------------------------------------
   Remote command handling
   -------------------------------------------------------------------------
   Commands reach this page from three directions, and they all converge on
   the same bus event so the behaviour is identical whichever was used:
     - the HUD page, over the backend
     - LSL, which relays button presses through the backend
     - a physical keyboard, during development
   ------------------------------------------------------------------------- */

/**
 * Keep every screen on the same section.
 *
 * The prim carries one url, but each viewer runs their own copy of the page,
 * so navigation is local unless it is deliberately shared. Without this the
 * screen only looks shared: one person opening Games leaves everyone else
 * looking at Home.
 *
 * `applyingRemote` suppresses the echo. Navigation caused by a remote message
 * must not be re-broadcast, or two screens will bounce a view back and forth
 * at each other forever.
 */
let applyingRemote = false;

function wireViewSync() {
  on('view:changed', async function (info) {
    if (applyingRemote) return;
    if (!canControl()) return;          // viewers browse locally; that is fine
    const socket = await import('./core/socket.js');
    if (!socket.isConnected()) return;
    socket.send('view', { tvId: state.tv.id, view: info.id, params: info.params });
  });

  on('view:remote', function (p) {
    if (!p || !p.view) return;
    if (p.view === state.view) return;
    applyingRemote = true;
    try {
      router.go(p.view, p.params || {}, false);
    } finally {
      applyingRemote = false;
    }
  });

  // A snapshot carries the authoritative view too, so a screen that just
  // loaded lands where the room already is instead of on Home.
  on('sync:snapshot', function (snap) {
    if (!snap || !snap.view || snap.view === state.view) return;
    applyingRemote = true;
    try {
      router.go(snap.view, snap.viewParams || {}, false);
    } finally {
      applyingRemote = false;
    }
  });
}

function wireRemote() {
  on('remote:key', function (key) {
    noteActivity();
    if (key === 'back') router.back();
    else if (key === 'home') router.go('home');
  });

  on('remote:app', function (appId) {
    noteActivity();
    if (router.known(appId)) router.go(appId);
  });

  on('remote:media', async function (cmd) {
    noteActivity();
    const sync = await import('./core/sync.js');
    const musicMod = await import('./views/music.js');

    if (cmd === 'playpause') {
      if (state.media.playback === 'playing') sync.command('pause');
      else sync.command('play');
    } else if (cmd === 'stop') sync.command('stop');
    else if (cmd === 'next') musicMod.next();
    else if (cmd === 'prev') musicMod.previous();
    else if (cmd === 'volup') musicMod.setVolume(state.volume + 5);
    else if (cmd === 'voldown') musicMod.setVolume(state.volume - 5);
    else if (cmd === 'mute') musicMod.toggleMute();
    else if (cmd === 'resync') sync.resync();
    else if (cmd === 'power') togglePower();
  });

  on('cloud:lost', function () {
    emit('notice', {
      level: 'warn',
      title: 'Cloud synchronisation unavailable',
      message: 'Local TV controls remain available.',
      timeoutMs: 6000
    });
  });

  on('cloud:connected', function () {
    if (state.cloud.since) {
      emit('notice', { level: 'ok', title: 'Cloud reconnected', message: 'Synchronisation resumed.' });
    }
  });
}

function togglePower() {
  const next = !state.tv.powered;
  patch({ tv: { powered: next } });
  if (!next) {
    import('./components/screens.js').then(function (m) { m.sleep(); });
  } else {
    import('./components/screens.js').then(function (m) { m.wake(); });
  }
}

start();
