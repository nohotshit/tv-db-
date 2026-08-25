/**
 * Trivia. Multiple choice, any number of players, one point per correct
 * answer, fastest correct answer breaks ties.
 *
 * The question bank is data, not code: `assets/trivia.json` is loaded at
 * start, so adding questions never touches this file. The handful of fallback
 * questions below exist only so the game still runs if that file is missing.
 */

import { h, clear } from '../core/dom.js';

const FALLBACK = [
  { q: 'Which planet has the shortest day in our solar system?', a: ['Jupiter', 'Mercury', 'Earth', 'Mars'], c: 0 },
  { q: 'Roughly what fraction of the human body is water?', a: ['About one fifth', 'About one third', 'About two thirds', 'Almost all of it'], c: 2 },
  { q: 'Sound travels fastest through which of these?', a: ['Steel', 'Air', 'Water', 'A vacuum'], c: 0 },
  { q: 'How many strings does a standard violin have?', a: ['Four', 'Five', 'Six', 'Seven'], c: 0 },
  { q: 'Which of these is a prime number?', a: ['91', '87', '97', '99'], c: 2 },
  { q: 'What does the SL in Second Life terminology usually stand for?', a: ['Server Load', 'Second Life', 'Sim Latency', 'Script Limit'], c: 1 },
  { q: 'Which unit measures electrical resistance?', a: ['Volt', 'Ohm', 'Watt', 'Ampere'], c: 1 },
  { q: 'An octave in Western music spans how many semitones?', a: ['Seven', 'Ten', 'Twelve', 'Fifteen'], c: 2 }
];

export const trivia = {
  id: 'trivia',
  name: 'Trivia',
  icon: '\u2753',
  description: 'Multiple choice. Everyone can play.',
  seats: 8,
  questionBank: FALLBACK,

  newState: function (opts) {
    const bank = (opts && opts.bank) || FALLBACK;
    const order = shuffle(bank.map(function (_, i) { return i; })).slice(0, (opts && opts.rounds) || 8);
    return {
      order: order, index: 0, bank: bank,
      answers: {}, scores: {}, revealed: false, finished: false
    };
  },

  move: function (state, move, seat) {
    if (state.finished) return { error: 'The round is over.' };

    if (move.next) {
      const index = state.index + 1;
      if (index >= state.order.length) {
        return { state: Object.assign({}, state, { finished: true, revealed: true }) };
      }
      return { state: Object.assign({}, state, { index: index, answers: {}, revealed: false }) };
    }

    const pick = Number(move.answer);
    if (state.revealed) return { error: 'That question is already scored.' };
    if (state.answers[seat] !== undefined) return { error: 'You already answered.' };

    const answers = Object.assign({}, state.answers);
    answers[seat] = pick;

    const question = state.bank[state.order[state.index]];
    const scores = Object.assign({}, state.scores);
    if (pick === question.c) scores[seat] = (scores[seat] || 0) + 1;

    return { state: Object.assign({}, state, { answers: answers, scores: scores }) };
  },

  reveal: function (state) {
    return Object.assign({}, state, { revealed: true });
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;

    if (s.finished) {
      el.appendChild(h('div.game-stage', [
        h('div.game-status', 'Final scores'),
        h('div.list', Object.keys(s.scores).sort(function (a, b) { return s.scores[b] - s.scores[a]; })
          .map(function (seat) {
            return h('div.list-row', [
              h('div.lr-main', [ h('div.lr-title', ctx.seatName(Number(seat))) ]),
              h('span.badge.b-accent', String(s.scores[seat]) + ' pts')
            ]);
          })),
        h('button.btn.btn-primary.focusable', { onclick: function () { ctx.restart(); } }, 'Play again')
      ]));
      return;
    }

    const question = s.bank[s.order[s.index]];
    const mine = s.answers[ctx.seat];

    el.appendChild(h('div.game-stage', [
      h('div.game-status', 'Question ' + (s.index + 1) + ' of ' + s.order.length),
      h('div.trivia-q', question.q),
      h('div.trivia-answers', question.a.map(function (text, i) {
        let cls = 'btn focusable';
        if (s.revealed && i === question.c) cls += ' is-right';
        else if (s.revealed && mine === i) cls += ' is-wrong';
        else if (mine === i) cls += ' btn-primary';
        return h('button', {
          class: cls,
          onclick: function () { ctx.send({ answer: i }); }
        }, String.fromCharCode(65 + i) + '.  ' + text);
      })),
      h('div.faint', mine === undefined ? 'Pick an answer' : 'Answer locked in'),
      ctx.isHost
        ? h('button.btn.focusable', { onclick: function () { ctx.send({ next: true }); } }, 'Next question')
        : null
    ]));
  }
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
