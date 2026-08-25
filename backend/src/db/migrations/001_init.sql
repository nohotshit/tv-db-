-- ---------------------------------------------------------------------------
-- Musical Impact Smart TV - initial schema
-- ---------------------------------------------------------------------------
-- Only what genuinely needs to survive a restart is stored. Presence, live
-- sync ticks and in-flight game moves stay in memory on the backend; writing
-- them here would mean a database round trip on every play button press for
-- no benefit.
--
-- No avatar positions, no chat transcripts, no analytics. A television has no
-- reason to keep any of that.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  -- The avatar UUID reported by the object in the X-SecondLife headers. This
  -- is a public in-world identifier, not an account credential.
  sl_key        UUID NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per physical TV object in world.
CREATE TABLE IF NOT EXISTS tv_devices (
  tv_id           TEXT PRIMARY KEY,             -- object key
  owner_key       UUID,
  owner_name      TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL DEFAULT 'Smart TV',
  region          TEXT NOT NULL DEFAULT '',
  -- llRequestSecureURL endpoint. Ephemeral: it changes on rez, script reset
  -- and region restart, so the object re-registers and this is overwritten.
  callback_url    TEXT NOT NULL DEFAULT '',
  callback_seen   TIMESTAMPTZ,
  -- Per-device HMAC secret, rotated by the owner from the object menu.
  device_secret   TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT 'owner'
                  CHECK (permission_mode IN ('owner','group','everyone','host')),
  group_key       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current playback state, one row per TV. Rewritten in place, not appended.
CREATE TABLE IF NOT EXISTS tv_sessions (
  session_id     BIGSERIAL PRIMARY KEY,
  tv_id          TEXT NOT NULL REFERENCES tv_devices(tv_id) ON DELETE CASCADE,
  host_key       UUID,
  host_name      TEXT NOT NULL DEFAULT '',
  current_media  JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_source TEXT NOT NULL DEFAULT '',
  playback_state TEXT NOT NULL DEFAULT 'idle'
                 CHECK (playback_state IN ('idle','playing','paused','stopped','buffering')),
  position_ms    BIGINT NOT NULL DEFAULT 0,
  -- Server clock at the moment position_ms was true. Every viewer extrapolates
  -- from this, which is what makes half-second synchronisation possible.
  position_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  queue          JSONB NOT NULL DEFAULT '[]'::jsonb,
  queue_index    INTEGER NOT NULL DEFAULT -1,
  queue_locked   BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tv_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

CREATE TABLE IF NOT EXISTS history (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  url       TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'web',
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone    TEXT NOT NULL DEFAULT 'America/New_York',
  time_format TEXT NOT NULL DEFAULT '12' CHECK (time_format IN ('12','24')),
  date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY'
              CHECK (date_format IN ('MM/DD/YYYY','DD/MM/YYYY','YYYY-MM-DD')),
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Multiplayer game state. Persisted so a match survives a backend restart or
-- a Render cold start, which on the free tier happens often.
CREATE TABLE IF NOT EXISTS game_states (
  id         BIGSERIAL PRIMARY KEY,
  tv_id      TEXT NOT NULL REFERENCES tv_devices(tv_id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  seats      JSONB NOT NULL DEFAULT '[]'::jsonb,
  state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tv_id)
);

-- ---- indexes --------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_history_user_time ON history (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_user    ON favorites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_tv       ON tv_sessions (tv_id);
CREATE INDEX IF NOT EXISTS idx_devices_seen      ON tv_devices (callback_seen DESC);

-- ---- history trimming -----------------------------------------------------
-- Recent history is a convenience, not an archive. Keep the newest rows per
-- user and drop the rest, so the table cannot grow without bound.
CREATE OR REPLACE FUNCTION trim_history() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM history
   WHERE user_id = NEW.user_id
     AND id NOT IN (
       SELECT id FROM history
        WHERE user_id = NEW.user_id
        ORDER BY viewed_at DESC
        LIMIT 60
     );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_history ON history;
CREATE TRIGGER trg_trim_history
  AFTER INSERT ON history
  FOR EACH ROW EXECUTE FUNCTION trim_history();
