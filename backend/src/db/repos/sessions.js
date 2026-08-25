'use strict';
/**
 * Playback sessions.
 *
 * One row per TV, rewritten in place. `position_at` is the server clock at the
 * moment `position_ms` was true; every viewer extrapolates forward from that
 * pair rather than trusting its own clock, which is what makes the half second
 * tolerance achievable across machines.
 */

const { query } = require('../pool');

async function get(tvId) {
  const res = await query('SELECT * FROM tv_sessions WHERE tv_id = $1', [tvId]);
  return res && res.rows[0] ? res.rows[0] : null;
}

async function save(tvId, s) {
  const res = await query(
    `INSERT INTO tv_sessions
       (tv_id, host_key, host_name, current_media, current_source, playback_state,
        position_ms, position_at, queue, queue_index, queue_locked, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8 / 1000.0), $9,$10,$11, now())
     ON CONFLICT (tv_id) DO UPDATE
        SET host_key       = EXCLUDED.host_key,
            host_name      = EXCLUDED.host_name,
            current_media  = EXCLUDED.current_media,
            current_source = EXCLUDED.current_source,
            playback_state = EXCLUDED.playback_state,
            position_ms    = EXCLUDED.position_ms,
            position_at    = EXCLUDED.position_at,
            queue          = EXCLUDED.queue,
            queue_index    = EXCLUDED.queue_index,
            queue_locked   = EXCLUDED.queue_locked,
            updated_at     = now()
      RETURNING *`,
    [
      tvId,
      s.hostKey || null,
      s.hostName || '',
      JSON.stringify(s.media || {}),
      s.source || '',
      s.playback || 'idle',
      Math.max(0, Math.round(s.positionMs || 0)),
      s.positionAt || Date.now(),
      JSON.stringify(s.queue || []),
      typeof s.queueIndex === 'number' ? s.queueIndex : -1,
      !!s.queueLocked
    ]
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

module.exports = { get, save };
