/** Connect Four. Two players, 7 columns by 6 rows, four in a line wins. */

import { h, clear } from '../core/dom.js';

const COLS = 7;
const ROWS = 6;

export const connectFour = {
  id: 'connectfour',
  name: 'Connect Four',
  icon: '\u{1F534}',
  description: 'Two players. Four in a line, any direction.',
  seats: 2,

  newState: function () {
    return { board: new Array(COLS * ROWS).fill(0), turn: 0, winner: null, line: null, draw: false };
  },

  move: function (state, move, seat) {
    const col = Number(move.col);
    if (state.winner !== null || state.draw) return { error: 'The game is over.' };
    if (seat !== state.turn) return { error: 'Not your turn.' };
    if (!(col >= 0 && col < COLS)) return { error: 'Invalid column.' };

    const board = state.board.slice();
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r * COLS + col]) { row = r; break; }
    }
    if (row < 0) return { error: 'That column is full.' };

    const piece = seat + 1;
    board[row * COLS + col] = piece;

    const line = findLine(board, row, col, piece);
    const draw = !line && board.every(function (v) { return v !== 0; });

    return {
      state: {
        board: board,
        turn: line || draw ? state.turn : 1 - seat,
        winner: line ? seat : null,
        line: line,
        draw: draw
      }
    };
  },

  render: function (el, ctx) {
    clear(el);
    const s = ctx.state;

    const cols = h('div.c4-cols', []);
    for (let c = 0; c < COLS; c++) {
      (function (col) {
        cols.appendChild(h('button.btn.focusable', {
          onclick: function () { ctx.send({ col: col }); }
        }, '\u25BC'));
      })(c);
    }

    const grid = h('div.board-c4', s.board.map(function (v, i) {
      const won = s.line && s.line.indexOf(i) >= 0;
      return h('div.slot', {
        class: 'slot' + (v ? ' p-' + v : '') + (won ? ' is-win' : '')
      });
    }));

    el.appendChild(h('div.game-stage', [
      h('div.game-status', status(s, ctx)),
      cols,
      grid
    ]));
  }
};

function findLine(board, row, col, piece) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let d = 0; d < dirs.length; d++) {
    const [dr, dc] = dirs[d];
    const cells = [row * COLS + col];

    for (let sign = -1; sign <= 1; sign += 2) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === piece) {
        cells.push(r * COLS + c);
        r += dr * sign; c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function status(s, ctx) {
  if (s.winner !== null) return ctx.seatName(s.winner) + ' wins.';
  if (s.draw) return 'The board is full. A draw.';
  return ctx.seat === s.turn ? 'Your move. Pick a column.' : 'Waiting for ' + ctx.seatName(s.turn) + '.';
}
