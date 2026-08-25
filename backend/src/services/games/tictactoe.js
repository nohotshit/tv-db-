'use strict';
/** Tic-Tac-Toe rules. Authoritative copy; mirrors frontend/js/games/tictactoe.js */

const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

module.exports = {
  id: 'tictactoe',
  seats: 2,

  newState: function () {
    return { board: ['','','','','','','','',''], turn: 0, winner: null, line: null, draw: false };
  },

  move: function (state, move, seat) {
    const i = Number(move.cell);
    if (state.winner !== null || state.draw) return { error: 'The game is over.' };
    if (seat !== state.turn) return { error: 'Not your turn.' };
    if (!Number.isInteger(i) || i < 0 || i > 8) return { error: 'Invalid square.' };
    if (state.board[i]) return { error: 'That square is taken.' };

    const board = state.board.slice();
    board[i] = seat === 0 ? 'X' : 'O';

    let winner = null, line = null;
    for (let k = 0; k < LINES.length; k++) {
      const a = LINES[k][0], b = LINES[k][1], c = LINES[k][2];
      if (board[a] && board[a] === board[b] && board[b] === board[c]) {
        winner = seat; line = LINES[k]; break;
      }
    }
    const draw = winner === null && board.every(function (v) { return !!v; });

    return {
      state: {
        board: board,
        turn: winner === null && !draw ? 1 - seat : state.turn,
        winner: winner, line: line, draw: draw
      }
    };
  }
};
