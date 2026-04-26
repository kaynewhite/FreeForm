const express = require("express");
const { query } = require("./db");
const { RACES, rollRace, withRaceMeta } = require("./races");

const router = express.Router();

const NAME_RE = /^[A-Za-z][A-Za-z0-9_'\- ]{2,23}$/;
const VALID_GENDERS = new Set(["male", "female"]);

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

const CHAR_COLS = `id, name, race, gender,
  mana_cap, max_hp, hp, level, xp,
  control, efficiency, cast_speed, resistance, stamina_cap,
  created_at`;

router.get("/me", requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT ${CHAR_COLS}
       FROM characters
       WHERE account_id = $1 AND died_at IS NULL
       LIMIT 1`,
      [req.session.userId]
    );
    res.json({ character: withRaceMeta(r.rows[0] || null) });
  } catch (e) {
    console.error("[chars] me error", e);
    res.status(500).json({ error: "Server error." });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const name = (req.body?.name || "").trim().replace(/\s+/g, " ");
  const gender = (req.body?.gender || "").toLowerCase();

  if (!NAME_RE.test(name)) {
    return res.status(400).json({
      error: "Name must be 3-24 chars, start with a letter, and use only letters, numbers, spaces, _, ' or -.",
    });
  }
  if (!VALID_GENDERS.has(gender)) {
    return res.status(400).json({ error: "Choose Male or Female." });
  }

  try {
    const existing = await query(
      `SELECT id FROM characters WHERE account_id = $1 AND died_at IS NULL LIMIT 1`,
      [req.session.userId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: "You already have a living vessel." });
    }

    const race = rollRace();
    const stats = {
      mana_cap: 500,
      max_hp: 1000,
      hp: 1000,
      level: 1,
      xp: 0,
      control: 10,
      efficiency: 0,
      cast_speed: 100,
      resistance: 0,
      stamina_cap: 100,
    };
    RACES[race].apply(stats);

    const r = await query(
      `INSERT INTO characters
        (account_id, name, race, gender,
         mana_cap, max_hp, hp, level, xp,
         control, efficiency, cast_speed, resistance, stamina_cap)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${CHAR_COLS}`,
      [
        req.session.userId, name, race, gender,
        stats.mana_cap, stats.max_hp, stats.hp, stats.level, stats.xp,
        stats.control, stats.efficiency, stats.cast_speed, stats.resistance, stats.stamina_cap,
      ]
    );

    res.status(201).json({ character: withRaceMeta(r.rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      if (e.constraint === "unique_living_char_name") {
        return res.status(409).json({ error: "Another living vessel already bears that name." });
      }
      if (e.constraint === "one_living_char_per_account") {
        return res.status(409).json({ error: "You already have a living vessel." });
      }
    }
    console.error("[chars] create error", e);
    res.status(500).json({ error: "Server error during forging." });
  }
});

// Dev-only: kill the current character so we can test permadeath flow.
router.post("/me/die", requireAuth, async (req, res) => {
  try {
    const r = await query(
      `UPDATE characters
       SET died_at = NOW(), hp = 0
       WHERE account_id = $1 AND died_at IS NULL
       RETURNING id, name, race`,
      [req.session.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "No living vessel." });
    res.json({ ok: true, slain: r.rows[0] });
  } catch (e) {
    console.error("[chars] die error", e);
    res.status(500).json({ error: "Server error." });
  }
});

module.exports = router;
