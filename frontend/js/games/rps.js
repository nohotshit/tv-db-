/**
 * Rock Paper Scissors. Two players, simultaneous choice.
 *
 * Both picks are hidden until both are in. The server holds the picks and only
 * reveals them once the round is complete, which is the whole reason this game
 * benefits from an authoritative backend - a client that could see the other
 * pick before choosing would have nothing left to play for.
 */

import { h, clear } from '../core/dom.js';

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const ICONS = { rock: '\u{1FAA8}', paper: '\u{1F4C4}', scissors: '\u2702' };

export const rockPaperScissors = {
  id: 'rps',
  name: 'Rock Paper Scissors',
  icon: '\u270A',
  description: 'Two players. Best of five.',
  seats: 2,

  newState: function () {
    return { picks: [null, null], revealed: false, scores: [0, 0], round: 1, lastResult: null, winner: null };
  },

  move: function (state, move, seat) {
    const pick = String(move.pick || '');
    if (state.winner !== null) return { error: 'The match is over.' };
    if (!BEATS[pick]) return { error: 'Invalid choice.' };
    if (state.revealed) return { error: 'Round already scored.' };
    if (state.picks[seat]) return { error: 'You already chose.' };

    const picks = state.picks.slice();
    picks[seat] = pick;

    if (!picks[0] || !picks[1]) {
      return { state: Object.assign({}, state, { picks: picks }) };
    }

    // Both in: score the round.
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
  },

  /** Called by the host to move past the reveal. */
  next: function (state) {
    if (state.winner !== null) return state;
    return Object.assign({}, state, {
      picks: [null, null], revealed: false, round: state.round + 1, lastResult: null
    });
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;
    const mine = s.picks[ctx.seat];

    const choices = h('div.rps-choices', Object.keys(BEATS).map(function (k) {
      return h('div.rps.focusable', {
        class: 'rps focusable' + (mine === k ? ' is-picked' : ''),
        onclick: function () { ctx.send({ pick: k }); }
      }, [ ICONS[k], h('div.rps-label', k) ]);
    }));

    el.appendChild(h('div.game-stage', [
      h('div.game-status', status(s, ctx)),
      s.revealed ? reveal(s, ctx) : choices,
      h('div.scoreline', [
        h('div.col', [ h('span.s-name', ctx.seatName(0)), h('span.s-val.accent', String(s.scores[0])) ]),
        h('div.col', [ h('span.s-name', 'Round'), h('span.s-val', String(s.round)) ]),
        h('div.col', [ h('span.s-name', ctx.seatName(1)), h('span.s-val', String(s.scores[1])) ])
      ]),
      s.revealed && s.winner === null
        ? h('button.btn.btn-primary.focusable', { onclick: function () { ctx.send({ next: true }); } }, 'Next round')
        : null
    ]));
  }
};

function reveal(s, ctx) {
  return h('div.rps-choices', [
    h('div.rps', [ ICONS[s.picks[0]], h('div.rps-label', ctx.seatName(0)) ]),
    h('div.rps', { style: { border: 'none', background: 'transparent', fontSize: '1rem' } }, 'vs'),
    h('div.rps', [ ICONS[s.picks[1]], h('div.rps-label', ctx.seatName(1)) ])
  ]);
}

function status(s, ctx) {
  if (s.winner !== null) return ctx.seatName(s.winner) + ' takes the match.';
  if (s.revealed) {
    if (s.lastResult === 'draw') return 'A draw. Nobody scores.';
    return ctx.seatName(s.lastResult) + ' wins the round.';
  }
  if (s.picks[ctx.seat]) return 'Locked in. Waiting for the other player.';
  return 'Choose. Both picks stay hidden until they are both in.';
}
