const { query } = require("./db");

// Bootstrap core schema (users, characters, session). Idempotent — safe to run
// on every boot. Mirrors the table definitions described in replit.md.
async function ensureCoreSchema() {
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

  // Persist last-known position so a player re-enters the realm where they
  // logged off. Added in the realtime slice — older rows just get defaults.
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS pos_x DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS pos_y DOUBLE PRECISION NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS shard  TEXT             NOT NULL DEFAULT 'default'`);
  await query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS facing TEXT             NOT NULL DEFAULT 'down'`);

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

  // session table for connect-pg-simple
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
  await query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire)
  `);
}

module.exports = { ensureCoreSchema };
