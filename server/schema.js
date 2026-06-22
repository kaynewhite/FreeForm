const { query } = require("./db");

// Bootstrap core schema (users, characters, session). Idempotent — safe to run
// on every boot. Uses ADD COLUMN IF NOT EXISTS throughout so it handles both
// fresh databases and existing ones with stale schemas (e.g. a Neon DB that
// was used with an earlier version of this project).
async function ensureCoreSchema() {
  // ── users ──────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL      PRIMARY KEY,
      email          TEXT        NOT NULL UNIQUE,
      password_hash  TEXT        NOT NULL,
      role           TEXT        NOT NULL DEFAULT 'player',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at  TIMESTAMPTZ
    )
  `);
  // Migrate older schemas that may be missing columns
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email         TEXT        NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT        NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role          TEXT        NOT NULL DEFAULT 'player'`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);
  // If this DB was previously used with Clerk auth it may have a NOT NULL clerk_id
  // column. Make it nullable so our password-based inserts work.
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'clerk_id'
      ) THEN
        ALTER TABLE users ALTER COLUMN clerk_id DROP NOT NULL;
      END IF;
    END$$;
  `);

  // ── characters ─────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS characters (
      id           SERIAL      PRIMARY KEY,
      account_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT        NOT NULL,
      race         TEXT,
      gender       TEXT,
      mana_cap     INTEGER     NOT NULL,
      max_hp       INTEGER     NOT NULL,
      hp           INTEGER     NOT NULL,
      level        INTEGER     NOT NULL DEFAULT 1,
      xp           INTEGER     NOT NULL DEFAULT 0,
      control      INTEGER     NOT NULL DEFAULT 10,
      efficiency   INTEGER     NOT NULL DEFAULT 0,
      cast_speed   INTEGER     NOT NULL DEFAULT 100,
      resistance   INTEGER     NOT NULL DEFAULT 0,
      stamina_cap  INTEGER     NOT NULL DEFAULT 100,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      died_at      TIMESTAMPTZ
    )
  `);
  // Position columns added in the realtime slice
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS pos_x    DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS pos_y    DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS shard    TEXT             NOT NULL DEFAULT 'default'`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS facing   TEXT             NOT NULL DEFAULT 'down'`);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS unique_living_char_name
      ON characters (LOWER(name))
      WHERE died_at IS NULL
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_living_char_per_account
      ON characters (account_id)
      WHERE died_at IS NULL
  `);

  // ── session (connect-pg-simple) ────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS session (
      sid    VARCHAR      NOT NULL COLLATE "default",
      sess   JSON         NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
      ) THEN
        ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
      END IF;
    END$$;
  `);
  await query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire)`);
}

module.exports = { ensureCoreSchema };
