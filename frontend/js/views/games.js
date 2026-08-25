/**
 * Games section.
 *
 * Two modes, chosen by whether the cloud is reachable:
 *
 *   cloud  - the backend owns the game state, validates every move against its
 *            own copy of the rules, and broadcasts the result. Seats are held
 *            by identified avatars. Hidden information (the number-guess
 *            secret, unrevealed RPS picks) never leaves the server.
 *
 *   local  - hot-seat on one screen. Everything still works, but seats are
 *            just "player 1" and "player 2" taking turns at the same TV, and
 *            games that depend on hidden information say so.
 *
 * Adding a game is one file plus one line in games/registry.js.
 */

import { h, clear } from '../core/dom.js';
import { state, patch, subscribe } from '../core/state.js';
import { go, back } from '../core/router.js';
import { setScope } from '../components/nav.js';
import { GAMES, gameById } from '../games/registry.js';
import { send, isConnected, serverNow } from '../core/socket.js';
import { config } from '../core/config.js';
import { on, emit } from '../core/bus.js';
import { log } from '../core/log.js';

let unsub = null;
let offGame = null;
let stage = null;
let active = null;        // game definition
let localState = null;    // used only in local mode
let localSeat = 0;        // hot-seat pointer

export const games = {
  id: 'games',
  title: 'Games',

  mount: function (container, params) {
    const view = h('div.view', [
      h('div.view-head', [
        h('h2.view-title', [ '\u{1F3AE} ', h('span.accent', 'Games') ]),
        h('span.view-sub', isConnected() ? 'Multiplayer through the cloud' : 'Local play, cloud unavailable'),
        h('span.grow'),
        h('button.btn.btn-sm.focusable', { onclick: leaveGame }, 'Game list'),
        h('button.btn.btn-sm.focusable', { onclick: function () { back(); } }, 'Back'),
        h('button.btn.btn-sm.focusable', { onclick: function () { go('home'); } }, 'Home')
      ]),
      h('div.view-body', [ h('div', { id: 'game-stage' }) ])
    ]);

    container.appendChild(view);
    setScope(view);
    stage = view.querySelector('#game-stage');

    offGame = on('game:update', function () { draw(); });
    unsub = subscribe(['games', 'viewers', 'cloud'], draw);

    if (params && params.game) startGame(params.game);
    else draw();
  },

  unmount: function () {
    if (unsub) unsub();
    if (offGame) offGame();
    unsub = offGame = stage = null;
  }
};

/* -------------------------------------------------------------------------
   Session control
   ------------------------------------------------------------------------- */

function startGame(id) {
  const def = gameById(id);
  if (!def) return;
  active = def;

  if (isConnected()) {
    send('game', { tvId: state.tv.id, action: 'start', game: id });
  } else {
    localState = def.newState();
    localSeat = 0;
    emit('notice', {
      level: 'warn',
      title: 'Local game',
      message: 'The cloud is unavailable, so this runs as hot-seat on this screen only.'
    });
  }
  draw();
}

function leaveGame() {
  if (isConnected() && active) {
    send('game', { tvId: state.tv.id, action: 'leave', game: active.id });
  }
  active = null;
  localState = null;
  patch({ games: { active: null, session: null } });
  draw();
}

function restart() {
  if (!active) return;
  if (isConnected()) send('game', { tvId: state.tv.id, action: 'restart', game: active.id });
  else { localState = active.newState(); localSeat = 0; }
  draw();
}

/**
 * Send a move. In cloud mode the server validates it; we do not apply it
 * locally first, because a rejected move that had already been drawn would
 * flicker. In local mode we run the same rules here.
 */
function sendMove(move) {
  if (!active) return;

  if (isConnected()) {
    send('game', { tvId: state.tv.id, action: 'move', game: active.id, move: move });
    return;
  }

  const result = active.move(localState, move, localSeat);
  if (result.error) {
    emit('notice', { level: 'warn', title: 'Not allowed', message: result.error });
    return;
  }
  localState = result.state;
  // Hot-seat: pass the screen to whoever is next, when the game tracks turns.
  if (typeof localState.turn === 'number') localSeat = localState.turn;
  draw();
}

/* -------------------------------------------------------------------------
   Rendering
   ------------------------------------------------------------------------- */

function draw() {
  if (!stage) return;
  clear(stage);

  if (!active) { drawList(); return; }

  const session = state.games.session;
  const gameState = isConnected() && session ? session.state : localState;

  if (!gameState) {
    stage.appendChild(h('div.empty', [
      h('div.empty-icon', '\u{1F3AE}'),
      h('div', 'Starting ' + active.name + '\u2026')
    ]));
    return;
  }

  const seat = isConnected() && session ? seatOf(session) : localSeat;

  active.render(stage, {
    state: gameState,
    seat: seat,
    isHost: !state.host || state.host.key === config.userKey,
    seatName: function (i) { return seatName(session, i); },
    serverNow: serverNow,
    send: sendMove,
    restart: restart
  });

  stage.appendChild(h('div.row', { style: { marginTop: '1rem', justifyContent: 'center' } }, [
    h('button.btn.btn-sm.focusable', { onclick: restart }, 'Restart'),
    h('button.btn.btn-sm.focusable', { onclick: leaveGame }, 'Leave'),
    isConnected()
      ? h('span.badge.b-ok', 'Cloud game')
      : h('span.badge.b-warn', 'Local hot-seat')
  ]));
}

function drawList() {
  stage.appendChild(h('div.tile-grid', GAMES.map(function (g) {
    return h('div.tile.focusable', {
      onclick: function () { startGame(g.id); }
    }, [
      h('div.tile-icon', g.icon),
      h('div.tile-label', g.name),
      h('div.tile-hint', g.description)
    ]);
  })));

  if (!isConnected()) {
    stage.appendChild(h('div.why', { style: { marginTop: '1rem', display: 'block' } },
      'The cloud is unavailable. Games still run, but as hot-seat on this screen: everyone takes turns at the same TV, and games that hide information from a player cannot do so locally.'));
  }
}

function seatOf(session) {
  if (!session || !session.seats) return 0;
  const i = session.seats.findIndex(function (s) { return s && s.key === config.userKey; });
  return i < 0 ? 0 : i;
}

function seatName(session, i) {
  if (isConnected() && session && session.seats && session.seats[i]) {
    const s = session.seats[i];
    return s.key === config.userKey ? 'You' : (s.name || 'Player ' + (i + 1));
  }
  return 'Player ' + (i + 1);
}
