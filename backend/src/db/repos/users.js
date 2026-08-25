'use strict';
/**
 * Users.
 *
 * A "user" here is an avatar UUID and a display name, both of which the object
 * already knows and which are public in-world identifiers. No passwords, no
 * email, no account data - none of that is reachable from a script and none of
 * it is wanted.
 */

const { query } = require('../pool');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKey(v) {
  return typeof v === 'string' && UUID.test(v);
}

/** Find or create by avatar key, refreshing last_seen. */
async function upsert(slKey, displayName) {
  if (!isKey(slKey)) return null;
  const res = await query(
    `INSERT INTO users (sl_key, display_name)
          VALUES ($1, $2)
     ON CONFLICT (sl_key) DO UPDATE
            SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
                last_seen    = now()
      RETURNING id, sl_key, display_name, created_at, last_seen`,
    [slKey, displayName || '']
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

async function byKey(slKey) {
  if (!isKey(slKey)) return null;
  const res = await query('SELECT * FROM users WHERE sl_key = $1', [slKey]);
  return res && res.rows[0] ? res.rows[0] : null;
}

module.exports = { upsert, byKey, isKey };
