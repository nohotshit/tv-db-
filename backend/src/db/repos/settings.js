'use strict';
/**
 * Per-user preferences.
 *
 * The three columns that get their own field - timezone, time format, date
 * format - are the ones requirement 19 and 20 name explicitly. Everything else
 * lives in a JSONB blob so new preferences never need a migration.
 */

const { query } = require('../pool');

const TIME_FORMATS = ['12', '24'];
const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

async function get(userId) {
  const res = await query('SELECT * FROM settings WHERE user_id = $1', [userId]);
  if (!res || !res.rows[0]) return null;
  const row = res.rows[0];
  return Object.assign({}, row.preferences || {}, {
    timezone: row.timezone,
    timeFormat: row.time_format,
    dateFormat: row.date_format
  });
}

async function save(userId, settings) {
  const s = settings || {};
  const timezone = typeof s.timezone === 'string' ? s.timezone.slice(0, 64) : 'America/New_York';
  const timeFormat = TIME_FORMATS.indexOf(s.timeFormat) >= 0 ? s.timeFormat : '12';
  const dateFormat = DATE_FORMATS.indexOf(s.dateFormat) >= 0 ? s.dateFormat : 'MM/DD/YYYY';

  // Everything except the three promoted columns goes into preferences.
  const prefs = Object.assign({}, s);
  delete prefs.timezone; delete prefs.timeFormat; delete prefs.dateFormat;

  const res = await query(
    `INSERT INTO settings (user_id, timezone, time_format, date_format, preferences)
          VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE
            SET timezone    = EXCLUDED.timezone,
                time_format = EXCLUDED.time_format,
                date_format = EXCLUDED.date_format,
                preferences = EXCLUDED.preferences,
                updated_at  = now()
      RETURNING *`,
    [userId, timezone, timeFormat, dateFormat, JSON.stringify(prefs)]
  );
  return !!res;
}

module.exports = { get, save, TIME_FORMATS, DATE_FORMATS };
