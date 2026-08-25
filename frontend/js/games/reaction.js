/**
 * Reaction. Wait for the pad to turn green, then hit it. Fastest wins.
 *
 * The go signal is scheduled by whoever holds the game session - the backend
 * when it is reachable, the local page when it is not - and the delay is
 * random so nobody can learn the timing. Pressing early is a foul and scores
 * nothing, which is what stops mashing.
 *
 * A note on what these times mean in Second Life: they include the viewer
 * render pipeline and, in cloud mode, one network round trip. They are a fair
 * comparison between players on the same TV, not a laboratory measurement.
 */

import { h, clear } from '../core/dom.js';

export const reaction = {
  id: 'reaction',
  name: 'Reaction Test',
  icon: '\u26A1',
  description: 'One to eight players. Fastest hand wins.',
  seats: 8,

  newState: function () {
    return {
      phase: 'idle',            // idle | armed | go | done
      goAt: 0,                  // server timestamp the pad turns green
      results: {},              // seat -> ms, or 'foul'
      round: 1
    };
  },

  move: function (state, move, seat) {
    if (move.arm) {
      if (state.phase === 'armed' || state.phase === 'go') return { error: 'A round is already running.' };
      return {
        state: Object.assign({}, state, {
          phase: 'armed',
          // 1.5 to 5.5 seconds, so counting it out does not help.
          goAt: (move.now || Date.now()) + 1500 + Math.floor(Math.random() * 4000),
          results: {}
        })
      };
    }

    if (move.hit) {
      if (state.phase === 'idle' || state.phase === 'done') return { error: 'Nothing to react to yet.' };
      if (state.results[seat] !== undefined) return { error: 'You already went.' };

      const now = move.now || Date.now();
      const results = Object.assign({}, state.results);
      results[seat] = now < state.goAt ? 'foul' : now - state.goAt;

      return { state: Object.assign({}, state, { results: results }) };
    }

    if (move.finish) {
      return { state: Object.assign({}, state, { phase: 'done' }) };
    }

    return { error: 'Unknown action.' };
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;
    const mine = s.results[ctx.seat];

    const live = s.phase === 'go' || (s.phase === 'armed' && ctx.serverNow() >= s.goAt);
    let padClass = 'reaction-pad';
    let padText = 'Press Start';
    if (s.phase === 'armed' && !live) { padClass += ' is-armed'; padText = 'Wait for green'; }
    if (live) { padClass += ' is-go'; padText = 'HIT IT'; }
    if (mine === 'foul') { padClass += ' is-foul'; padText = 'Too early'; }
    if (typeof mine === 'number') padText = mine + ' ms';

    el.appendChild(h('div.game-stage', [
      h('div.game-status', s.phase === 'idle'
        ? 'Everyone ready? Start the round.'
        : 'Round ' + s.round),
      h('div', {
        class: padClass + ' focusable',
        onclick: function () {
          if (s.phase === 'idle' || s.phase === 'done') ctx.send({ arm: true, now: ctx.serverNow() });
          else ctx.send({ hit: true, now: ctx.serverNow() });
        }
      }, padText),
      h('div.list', { style: { width: '20rem', maxWidth: '100%' } },
        Object.keys(s.results)
          .sort(function (a, b) {
            const x = s.results[a], y = s.results[b];
            if (x === 'foul') return 1;
            if (y === 'foul') return -1;
            return x - y;
          })
          .map(function (seat, rank) {
            const v = s.results[seat];
            return h('div.list-row', [
              h('div.lr-main', [
                h('div.lr-title', (rank + 1) + '. ' + ctx.seatName(Number(seat))),
                h('div.lr-sub', v === 'foul' ? 'Jumped the gun' : v + ' ms')
              ])
            ]);
          })),
      h('div.why', 'Times include your viewer render delay, so treat them as a comparison between players rather than an absolute score.')
    ]));
  }
};
