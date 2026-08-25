/**
 * Game registry.
 *
 * Adding a game means writing one module and adding one line here. Nothing
 * else in the TV needs to change - that is the modularity requirement 24 asks
 * for.
 *
 * A game module exports:
 *   {
 *     id, name, icon, description,
 *     seats:      how many players take turns (1 for solo)
 *     newState(): fresh game state, plain JSON
 *     move(state, move, seat) -> { state, error }   pure, no side effects
 *     render(el, ctx)                               draws into el
 *   }
 *
 * AUTHORITY: when the backend is reachable, moves go to the server, the server
 * runs its own copy of the same rules, and the result is broadcast. The client
 * rules here are used for offline hot-seat play and for optimistic rendering.
 * The server never trusts the state a client sends - only the move.
 */

import { ticTacToe } from './tictactoe.js';
import { connectFour } from './connectfour.js';
import { rockPaperScissors } from './rps.js';
import { trivia } from './trivia.js';
import { numberGuess } from './numberguess.js';
import { reaction } from './reaction.js';

export const GAMES = [
  ticTacToe,
  connectFour,
  rockPaperScissors,
  trivia,
  numberGuess,
  reaction
];

export function gameById(id) {
  return GAMES.filter(function (g) { return g.id === id; })[0] || null;
}
