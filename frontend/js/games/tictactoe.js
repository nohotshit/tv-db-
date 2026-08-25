/** Tic-Tac-Toe. Two players, alternating, first to a line of three. */

import { h, clear } from '../core/dom.js';

const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

export const ticTacToe = {
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  icon: '\u274C',
  description: 'Two players. Three in a row wins.',
  seats: 2,

  newState: function () {
    return { board: ['','','','','','','','',''], turn: 0, winner: null, line: null, draw: false };
  },

  move: function (state, move, seat) {
    const i = Number(move.cell);
    if (state.winner !== null || state.draw) return { error: 'The game is over.' };
    if (seat !== state.turn) return { error: 'Not your turn.' };
    if (!(i >= 0 && i < 9)) return { error: 'Invalid square.' };
    if (state.board[i]) return { error: 'That square is taken.' };

    const board = state.board.slice();
    board[i] = seat === 0 ? 'X' : 'O';

    let winner = null, line = null;
    for (let k = 0; k < LINES.length; k++) {
      const [a,b,c] = LINES[k];
      if (board[a] && board[a] === board[b] && board[b] === board[c]) {
        winner = seat; line = LINES[k]; break;
      }
    }
    const draw = !winner && board.every(function (v) { return !!v; });

    return { state: { board: board, turn: winner === null && !draw ? 1 - seat : state.turn, winner: winner, line: line, draw: draw } };
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;

    const board = h('div.board-ttt', s.board.map(function (v, i) {
      const won = s.line && s.line.indexOf(i) >= 0;
      return h('div.cell.focusable', {
        class: 'cell focusable' + (v === 'X' ? ' p-x' : v === 'O' ? ' p-o' : '') + (won ? ' is-win' : ''),
        onclick: function () { ctx.send({ cell: i }); }
      }, v);
    }));

    el.appendChild(h('div.game-stage', [
      h('div.game-status', status(s, ctx)),
      board,
      h('div.scoreline', [
        h('div.col', [ h('span.s-name', ctx.seatName(0) + ' (X)'), h('span.s-val.accent', 'X') ]),
        h('div.col', [ h('span.s-name', ctx.seatName(1) + ' (O)'), h('span.s-val', 'O') ])
      ])
    ]));
  }
};

function status(s, ctx) {
  if (s.winner !== null) return ctx.seatName(s.winner) + ' wins.';
  if (s.draw) return 'A draw.';
  return ctx.seat === s.turn ? 'Your move.' : 'Waiting for ' + ctx.seatName(s.turn) + '.';
}
