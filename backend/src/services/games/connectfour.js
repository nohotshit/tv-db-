'use strict';
/** Connect Four rules. Authoritative copy. */

const COLS = 7;
const ROWS = 6;

function findLine(board, row, col, piece) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let d = 0; d < dirs.length; d++) {
    const dr = dirs[d][0], dc = dirs[d][1];
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

module.exports = {
  id: 'connectfour',
  seats: 2,

  newState: function () {
    return { board: new Array(COLS * ROWS).fill(0), turn: 0, winner: null, line: null, draw: false };
  },

  move: function (state, move, seat) {
    const col = Number(move.col);
    if (state.winner !== null || state.draw) return { error: 'The game is over.' };
    if (seat !== state.turn) return { error: 'Not your turn.' };
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return { error: 'Invalid column.' };

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
        line: line, draw: draw
      }
    };
  }
};
