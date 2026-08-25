'use strict';
/**
 * Trivia rules. Authoritative copy.
 *
 * The question bank lives in data/trivia.json so questions can be added
 * without touching code. Correct answers stay on the server until a question
 * is revealed.
 */

const fs = require('fs');
const path = require('path');

let BANK = null;

function bank() {
  if (BANK) return BANK;
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'trivia.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    BANK = Array.isArray(json.questions) ? json.questions : [];
  } catch (e) {
    BANK = [];
  }
  return BANK;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

module.exports = {
  id: 'trivia',
  seats: 8,

  newState: function (opts) {
    const questions = bank();
    const rounds = Math.min((opts && opts.rounds) || 8, questions.length || 8);
    const order = shuffle(questions.map(function (_, i) { return i; })).slice(0, rounds);
    const state = {
      _bank: questions,
      order: order,
      index: 0,
      question: null,
      answers: {},
      scores: {},
      revealed: false,
      correct: null,
      finished: questions.length === 0
    };
    state.question = questionAt(state, 0);
    return state;
  },

  move: function (state, move, seat) {
    if (state.finished) return { error: 'The round is over.' };

    if (move.next) {
      const index = state.index + 1;
      if (index >= state.order.length) {
        return { state: Object.assign({}, state, { finished: true, revealed: true }) };
      }
      return {
        state: Object.assign({}, state, {
          index: index,
          question: questionAt(state, index),
          answers: {}, revealed: false, correct: null
        })
      };
    }

    const pick = Number(move.answer);
    if (state.revealed) return { error: 'That question is already scored.' };
    if (state.answers[seat] !== undefined) return { error: 'You already answered.' };
    if (!Number.isInteger(pick) || pick < 0 || pick > 3) return { error: 'Invalid answer.' };

    const q = state._bank[state.order[state.index]];
    const answers = Object.assign({}, state.answers);
    answers[seat] = pick;

    const scores = Object.assign({}, state.scores);
    if (q && pick === q.c) scores[seat] = (scores[seat] || 0) + 1;

    // Reveal once everyone seated has answered.
    const seated = move._seatCount || 0;
    const revealed = seated > 0 && Object.keys(answers).length >= seated;

    return {
      state: Object.assign({}, state, {
        answers: answers,
        scores: scores,
        revealed: revealed,
        correct: revealed && q ? q.c : null
      })
    };
  }
};

/** The question WITHOUT its correct-answer index, which stays server side. */
function questionAt(state, index) {
  const q = state._bank[state.order[index]];
  return q ? { q: q.q, a: q.a } : null;
}
