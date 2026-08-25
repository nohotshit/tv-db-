'use strict';
/**
 * Number Guessing rules. Authoritative copy.
 *
 * `_secret` is stripped from every broadcast by tvState.redactGame. This is
 * the reason the game exists on the server at all: with the answer in client
 * state, anyone could read it out of the page.
 */

module.exports = {
  id: 'numberguess',
  seats: 8,

  newState: function (opts) {
    const max = (opts && opts.max) || 100;
    return {
      _secret: 1 + Math.floor(Math.random() * max),
      max: max,
      guesses: [],
      turn: 0,
      winner: null,
      answer: null,
      range: { low: 1, high: max }
    };
  },

  move: function (state, move, seat) {
    if (state.winner !== null) return { error: 'Someone already got it.' };

    const guess = Math.round(Number(move.guess));
    if (!isFinite(guess) || guess < 1 || guess > state.max) {
      return { error: 'Guess a whole number between 1 and ' + state.max + '.' };
    }

    const verdict = guess === state._secret ? 'correct'
      : (guess < state._secret ? 'higher' : 'lower');

    const guesses = state.guesses.concat([{ seat: seat, guess: guess, verdict: verdict }]).slice(-20);

    const range = Object.assign({}, state.range);
    if (verdict === 'higher') range.low = Math.max(range.low, guess + 1);
    if (verdict === 'lower') range.high = Math.min(range.high, guess - 1);

    return {
      state: Object.assign({}, state, {
        guesses: guesses,
        range: range,
        winner: verdict === 'correct' ? seat : null,
        // The answer is only published once it has been found.
        answer: verdict === 'correct' ? state._secret : null
      })
    };
  }
};
