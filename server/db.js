const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => {
  console.error("[db] unexpected error on idle client", err);
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
