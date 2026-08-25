'use strict';
/**
 * TV devices.
 *
 * The callback url is the interesting column. LSL HTTP-in urls are ephemeral:
 * they are lost on script reset, on rez, and whenever the region restarts. The
 * object re-registers on every one of those events, and this row is overwritten.
 * A stale url is expected, not exceptional, so the bridge treats a failed push
 * as "queue it and wait for the object to come back", never as an error.
 */

const { query } = require('../pool');

async function register(device) {
  const res = await query(
    `INSERT INTO tv_devices (tv_id, owner_key, owner_name, name, region, callback_url, callback_seen, device_secret, permission_mode, group_key)
          VALUES ($1,$2,$3,$4,$5,$6, now(), $7, $8, $9)
     ON CONFLICT (tv_id) DO UPDATE
            SET owner_key       = COALESCE(EXCLUDED.owner_key, tv_devices.owner_key),
                owner_name      = COALESCE(NULLIF(EXCLUDED.owner_name, ''), tv_devices.owner_name),
                name            = COALESCE(NULLIF(EXCLUDED.name, ''), tv_devices.name),
                region          = EXCLUDED.region,
                callback_url    = EXCLUDED.callback_url,
                callback_seen   = now(),
                device_secret   = COALESCE(NULLIF(EXCLUDED.device_secret, ''), tv_devices.device_secret),
                permission_mode = COALESCE(EXCLUDED.permission_mode, tv_devices.permission_mode),
                group_key       = COALESCE(EXCLUDED.group_key, tv_devices.group_key),
                updated_at      = now()
      RETURNING *`,
    [device.tvId, device.ownerKey || null, device.ownerName || '', device.name || 'Smart TV',
     device.region || '', device.callbackUrl || '', device.deviceSecret || '',
     device.permissionMode || 'owner', device.groupKey || null]
  );
  return res && res.rows[0] ? res.rows[0] : null;
}

async function get(tvId) {
  const res = await query('SELECT * FROM tv_devices WHERE tv_id = $1', [tvId]);
  return res && res.rows[0] ? res.rows[0] : null;
}

async function setPermissionMode(tvId, mode) {
  await query(
    'UPDATE tv_devices SET permission_mode = $2, updated_at = now() WHERE tv_id = $1',
    [tvId, mode]
  );
}

async function clearCallback(tvId) {
  await query("UPDATE tv_devices SET callback_url = '' WHERE tv_id = $1", [tvId]);
}

module.exports = { register, get, setPermissionMode, clearCallback };
