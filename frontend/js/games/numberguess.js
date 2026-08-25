/**
 * Number Guessing. One player or many, taking turns.
 *
 * The secret number lives in server state and is stripped from every snapshot
 * sent to clients - `newState` marks it with a leading underscore and the
 * backend redacts those keys before broadcasting. Without that, anyone could
 * open the browser console and read the answer.
 */

import { h, clear } from '../core/dom.js';

export const numberGuess = {
  id: 'numberguess',
  name: 'Number Guessing',
  icon: '\u{1F3AF}',
  description: 'One to eight players. Higher or lower.',
  seats: 8,

  newState: function (opts) {
    const max = (opts && opts.max) || 100;
    return {
      _secret: 1 + Math.floor(Math.random() * max),
      max: max,
      guesses: [],
      turn: 0,
      winner: null,
      range: { low: 1, high: max }
    };
  },

  move: function (state, move, seat) {
    if (state.winner !== null) return { error: 'Someone already got it.' };
    const guess = Math.round(Number(move.guess));
    if (!isFinite(guess) || guess < 1 || guess > state.max) {
      return { error: 'Guess a whole number between 1 and ' + state.max + '.' };
    }

    // No secret on the client copy, so offline play scores locally only.
    const secret = state._secret;
    if (secret === undefined) return { error: 'This game needs the cloud to keep the secret number.' };

    const verdict = guess === secret ? 'correct' : (guess < secret ? 'higher' : 'lower');
    const guesses = state.guesses.concat([{ seat: seat, guess: guess, verdict: verdict }]).slice(-20);

    const range = Object.assign({}, state.range);
    if (verdict === 'higher') range.low = Math.max(range.low, guess + 1);
    if (verdict === 'lower') range.high = Math.min(range.high, guess - 1);

    return {
      state: Object.assign({}, state, {
        guesses: guesses,
        range: range,
        winner: verdict === 'correct' ? seat : null,
        turn: verdict === 'correct' ? state.turn : (state.turn + 1) % Math.max(1, state.seatCount || 1)
      })
    };
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;
    const input = h('input.input', {
      type: 'number', min: '1', max: String(s.max), placeholder: '1 - ' + s.max,
      style: { width: '8rem', textAlign: 'center' }
    });

    const guess = function () {
      if (!input.value) return;
      ctx.send({ guess: Number(input.value) });
      input.value = '';
    };

    el.appendChild(h('div.game-stage', [
      h('div.game-status', s.winner !== null
        ? ctx.seatName(s.winner) + ' got it. The number was ' + (s.answer || 'found') + '.'
        : 'Somewhere between ' + s.range.low + ' and ' + s.range.high + '.'),
      h('div.row', [
        input,
        h('button.btn.btn-primary.focusable', { onclick: guess }, 'Guess')
      ]),
      h('div.list', { style: { width: '22rem', maxWidth: '100%' } },
        s.guesses.slice().reverse().slice(0, 8).map(function (g) {
          return h('div.list-row', [
            h('div.lr-main', [
              h('div.lr-title', ctx.seatName(g.seat) + ' guessed ' + g.guess),
              h('div.lr-sub', g.verdict === 'correct' ? 'Correct' : 'Try ' + g.verdict)
            ])
          ]);
        })),
      s.winner !== null
        ? h('button.btn.focusable', { onclick: function () { ctx.restart(); } }, 'New number')
        : null
    ]));
  }
};
