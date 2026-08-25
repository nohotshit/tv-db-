'use strict';
/**
 * Reaction Test rules. Authoritative copy.
 *
 * The go moment is decided here and stored as a server timestamp. Clients
 * convert it through their own measured clock offset, which is why the clock
 * handshake in the WebSocket layer matters for more than playback.
 *
 * `_armedBy` is stripped from broadcasts; nothing else is secret, because the
 * whole point is that everyone sees the same green at the same instant.
 */

module.exports = {
  id: 'reaction',
  seats: 8,

  newState: function () {
    return { phase: 'idle', goAt: 0, results: {}, round: 1 };
  },

  move: function (state, move, seat) {
    if (move.arm) {
      if (state.phase === 'armed' || state.phase === 'go') {
        return { error: 'A round is already running.' };
      }
      const now = Date.now();
      return {
        state: {
          phase: 'armed',
          // 1.5 to 5.5 seconds. Random so counting it out does not help.
          goAt: now + 1500 + Math.floor(Math.random() * 4000),
          results: {},
          round: state.round + (state.phase === 'done' ? 1 : 0),
          _armedBy: seat
        }
      };
    }

    if (move.hit) {
      if (state.phase !== 'armed') return { error: 'Nothing to react to yet.' };
      if (state.results[seat] !== undefined) return { error: 'You already went.' };

      // The server clock decides, not the one the client sent. A client that
      // claims it pressed the button an hour ago gets a foul, not a record.
      const now = Date.now();
      const results = Object.assign({}, state.results);
      results[seat] = now < state.goAt ? 'foul' : now - state.goAt;

      return { state: Object.assign({}, state, { results: results }) };
    }

    if (move.finish) {
      return { state: Object.assign({}, state, { phase: 'done' }) };
    }

    return { error: 'Unknown action.' };
  }
};
