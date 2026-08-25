'use strict';
/** Persisted multiplayer game state, so a match survives a cold start. */

const { query } = require('../pool');

async function get(tvId) {
  const res = await query('SELECT * FROM game_states WHERE tv_id = $1', [tvId]);
  return res && res.rows[0] ? res.rows[0] : null;
}

async function save(tvId, game, seats, state) {
  const res = await query(
    `INSERT INTO game_states (tv_id, game, seats, state)
          VALUES ($1,$2,$3,$4)
     ON CONFLICT (tv_id) DO UPDATE
            SET game = EXCLUDED.game, seats = EXCLUDED.seats,
                state = EXCLUDED.state, updated_at = now()
      RETURNING *`,
    [tvId, game, JSON.stringify(seats || []), JSON.stringify(state || {})]
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

async function clear(tvId) {
  await query('DELETE FROM game_states WHERE tv_id = $1', [tvId]);
}

module.exports = { get, save, clear };
