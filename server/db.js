const { Pool } = require("pg");

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("No database URL found — set NEON_DATABASE_URL or DATABASE_URL");
}

const isNeon = !!process.env.NEON_DATABASE_URL;

const pool = new Pool({
  connectionString,
  max: 10,
  // Neon requires SSL; Replit's built-in Postgres does not
  ssl: isNeon ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("[db] unexpected error on idle client", err);
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
