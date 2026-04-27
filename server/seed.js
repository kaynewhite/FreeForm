const bcrypt = require("bcrypt");
const { query } = require("./db");

// Admin accounts that should always exist. The owner's account plus any
// co-admins they trust. Each entry is created with role=admin if missing,
// and promoted to admin if the email already exists with a different role.
// Passwords are NOT overwritten when the user already exists — admins can
// rotate their own passwords without the seeder undoing the change on boot.
const ADMINS = [
  { email: "kaynematsuzuki@gmail.com", password: "carmona073024" },
  { email: "shielamaehagupit@gmail.com", password: "xassandra" },
];
const BCRYPT_ROUNDS = 12;

async function seedOneAdmin({ email, password }) {
  const e = email.trim().toLowerCase();
  const existing = await query(
    `SELECT id, role FROM users WHERE email = $1 LIMIT 1`,
    [e]
  );

  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`,
      [e, hash]
    );
    console.log(`[seed] created admin user ${e}`);
    return;
  }

  if (existing.rows[0].role !== "admin") {
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [existing.rows[0].id]);
    console.log(`[seed] promoted ${e} to admin`);
  } else {
    console.log(`[seed] admin user ${e} already present`);
  }
}

async function seedAdmin() {
  for (const a of ADMINS) {
    await seedOneAdmin(a);
  }
}

module.exports = { seedAdmin };
