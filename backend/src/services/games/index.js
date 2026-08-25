'use strict';
/**
 * Authoritative game rules.
 *
 * The frontend has its own copy of these rules, used for offline hot-seat play
 * and for drawing the board. This copy is the one that DECIDES. A client sends
 * a move, never a state; the server runs the rules and broadcasts the result.
 * That is what stops a player from declaring themselves the winner, and it is
 * also what lets the server keep secrets - the number guessing answer and
 * unrevealed Rock Paper Scissors picks never leave this process.
 *
 * Keys beginning with an underscore are stripped from every broadcast by
 * tvState.redactGame.
 *
 * Adding a game: write a module with { id, seats, newState, move }, add it to
 * the map at the bottom, and mirror it in frontend/js/games/.
 */

const ticTacToe = require('./tictactoe');
const connectFour = require('./connectfour');
const rps = require('./rps');
const trivia = require('./trivia');
const numberGuess = require('./numberguess');
const reaction = require('./reaction');

const REGISTRY = {
  tictactoe: ticTacToe,
  connectfour: connectFour,
  rps: rps,
  trivia: trivia,
  numberguess: numberGuess,
  reaction: reaction
};

function byId(id) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id) ? REGISTRY[id] : null;
}

function list() {
  return Object.keys(REGISTRY).map(function (id) {
    return { id: id, seats: REGISTRY[id].seats };
  });
}

/** Start a session, seating the player who asked for it first. */
function start(tv, gameId, user) {
  const def = byId(gameId);
  if (!def) return { ok: false, error: 'Unknown game.' };

  tv.game = {
    game: gameId,
    seats: seatArray(def.seats, user),
    state: def.newState()
  };
  return { ok: true, session: tv.game };
}

function seatArray(count, user) {
  const seats = new Array(count).fill(null);
  if (user && user.key) seats[0] = { key: user.key, name: user.name || 'Player 1' };
  return seats;
}

/** Find the caller seat, taking a free one if they do not have one yet. */
function seatOf(session, user) {
  if (!user || !user.key) return 0;
  const existing = session.seats.findIndex(function (s) { return s && s.key === user.key; });
  if (existing >= 0) return existing;
  const free = session.seats.findIndex(function (s) { return !s; });
  if (free < 0) return -1;
  session.seats[free] = { key: user.key, name: user.name || 'Player ' + (free + 1) };
  return free;
}

function move(tv, user, payload) {
  if (!tv.game) return { ok: false, error: 'No game is running.' };
  const def = byId(tv.game.game);
  if (!def) return { ok: false, error: 'Unknown game.' };

  const seat = seatOf(tv.game, user);
  if (seat < 0) return { ok: false, error: 'This game is full.' };

  const result = def.move(tv.game.state, payload || {}, seat);
  if (result.error) return { ok: false, error: result.error };

  tv.game.state = result.state;
  return { ok: true, session: tv.game };
}

function restart(tv) {
  if (!tv.game) return { ok: false, error: 'No game is running.' };
  const def = byId(tv.game.game);
  tv.game.state = def.newState();
  return { ok: true, session: tv.game };
}

function leave(tv, user) {
  if (!tv.game) return { ok: true };
  tv.game.seats = tv.game.seats.map(function (s) {
    return s && user && s.key === user.key ? null : s;
  });
  if (tv.game.seats.every(function (s) { return !s; })) tv.game = null;
  return { ok: true, session: tv.game };
}

module.exports = { byId, list, start, move, restart, leave, seatOf };
