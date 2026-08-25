'use strict';
/**
 * Recent history.
 *
 * Title, url, source, timestamp. Nothing else - requirement 17 is explicit
 * that unnecessary personal information is not to be collected, and a trigger
 * in the schema trims each user to the newest sixty rows so this never becomes
 * a long term record of anyone viewing habits.
 */

const { query } = require('../pool');

async function list(userId, limit) {
  const res = await query(
    `SELECT id, title, url, source, viewed_at
       FROM history WHERE user_id = $1
      ORDER BY viewed_at DESC LIMIT $2`,
    [userId, Math.min(Number(limit) || 60, 60)]
  );
  return res ? res.rows : null;
}

async function add(userId, item) {
  // Collapse an immediate repeat of the same url rather than stacking it.
  await query('DELETE FROM history WHERE user_id = $1 AND url = $2', [userId, item.url]);
  const res = await query(
    `INSERT INTO history (user_id, title, url, source)
          VALUES ($1,$2,$3,$4)
      RETURNING id, title, url, source, viewed_at`,
    [userId, item.title, item.url, item.source || 'web']
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

async function clear(userId) {
  const res = await query('DELETE FROM history WHERE user_id = $1', [userId]);
  return !!res;
}

module.exports = { list, add, clear };
