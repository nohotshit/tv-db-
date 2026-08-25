'use strict';
/** Favorites: websites, channels and stations a viewer chose to keep. */

const { query } = require('../pool');

async function list(userId) {
  const res = await query(
    `SELECT id, title, url, source, created_at
       FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
  return res ? res.rows : null;
}

async function add(userId, fav) {
  const res = await query(
    `INSERT INTO favorites (user_id, title, url, source)
          VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, url) DO UPDATE SET title = EXCLUDED.title
      RETURNING id, title, url, source, created_at`,
    [userId, fav.title, fav.url, fav.source || 'web']
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

async function remove(userId, id) {
  const res = await query('DELETE FROM favorites WHERE user_id = $1 AND id = $2', [userId, id]);
  return !!res;
}

module.exports = { list, add, remove };
