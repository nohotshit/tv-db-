'use strict';
/**
 * Rock Paper Scissors rules. Authoritative copy.
 *
 * The reason this game genuinely needs the server: both picks are held here
 * until the round is complete. tvState.redactGame replaces unrevealed picks
 * with the string "hidden" before any broadcast, so an opponent cannot read
 * the choice out of a WebSocket frame.
 */

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

module.exports = {
  id: 'rps',
  seats: 2,

  newState: function () {
    return { picks: [null, null], revealed: false, scores: [0, 0], round: 1, lastResult: null, winner: null };
  },

  move: function (state, move, seat) {
    if (move.next) {
      if (!state.revealed) return { error: 'The round is not finished.' };
      if (state.winner !== null) return { error: 'The match is over.' };
      return {
        state: Object.assign({}, state, {
          picks: [null, null], revealed: false, round: state.round + 1, lastResult: null
        })
      };
    }

    const pick = String(move.pick || '');
    if (state.winner !== null) return { error: 'The match is over.' };
    if (!Object.prototype.hasOwnProperty.call(BEATS, pick)) return { error: 'Invalid choice.' };
    if (state.revealed) return { error: 'Round already scored.' };
    if (state.picks[seat]) return { error: 'You already chose.' };

    const picks = state.picks.slice();
    picks[seat] = pick;

    if (!picks[0] || !picks[1]) {
      return { state: Object.assign({}, state, { picks: picks }) };
    }

    const scores = state.scores.slice();
    let result;
    if (picks[0] === picks[1]) result = 'draw';
    else if (BEATS[picks[0]] === picks[1]) { result = 0; scores[0]++; }
    else { result = 1; scores[1]++; }

    const winner = scores[0] >= 3 ? 0 : scores[1] >= 3 ? 1 : null;

    return {
      state: {
        picks: picks, revealed: true, scores: scores,
        round: state.round, lastResult: result, winner: winner
      }
    };
  }
};
