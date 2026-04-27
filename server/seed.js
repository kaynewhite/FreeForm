const bcrypt = require("bcrypt");
const { query } = require("./db");

// Admin account that should always exist. Configurable via env vars in case
// the admin ever wants to rotate credentials, but defaults to the owner's
// account so a fresh database always boots with a working admin login.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "kaynematsuzuki@gmail.com")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "carmona073024";
const BCRYPT_ROUNDS = 12;

async function seedAdmin() {
  const existing = await query(
    `SELECT id, role FROM users WHERE email = $1 LIMIT 1`,
    [ADMIN_EMAIL]
  );

  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`,
      [ADMIN_EMAIL, hash]
    );
    console.log(`[seed] created admin user ${ADMIN_EMAIL}`);
    return;
  }

  // User exists — make sure the role is admin. Don't touch the password
  // (the admin may have changed it).
  if (existing.rows[0].role !== "admin") {
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [existing.rows[0].id]);
    console.log(`[seed] promoted ${ADMIN_EMAIL} to admin`);
  } else {
    console.log(`[seed] admin user ${ADMIN_EMAIL} already present`);
  }
}

module.exports = { seedAdmin };
