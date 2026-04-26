const express = require("express");
const bcrypt = require("bcrypt");
const { query } = require("./db");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const BCRYPT_ROUNDS = 12;

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

function validateRegister({ email, username, password }) {
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return "Please enter a valid email address.";
  }
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "Username must be 3-32 characters: letters, numbers, underscore.";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return "Password must be 8-200 characters.";
  }
  return null;
}

router.post("/register", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const username = (req.body?.username || "").trim();
  const password = req.body?.password || "";

  const err = validateRegister({ email, username, password });
  if (err) return res.status(400).json({ error: err });

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, username, role, created_at`,
      [email, username, hash]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    return res.status(201).json({ user });
  } catch (e) {
    if (e.code === "23505") {
      const field = e.constraint && e.constraint.includes("email") ? "email" : "username";
      return res.status(409).json({ error: `That ${field} is already taken.` });
    }
    console.error("[auth] register error", e);
    return res.status(500).json({ error: "Server error during registration." });
  }
});

router.post("/login", async (req, res) => {
  const identifier = ((req.body?.identifier ?? req.body?.email ?? req.body?.username) || "")
    .trim()
    .toLowerCase();
  const password = req.body?.password || "";

  if (!identifier || !password) {
    return res.status(400).json({ error: "Enter your email/username and password." });
  }

  try {
    const result = await query(
      `SELECT id, email, username, password_hash, role
       FROM users
       WHERE email = $1 OR LOWER(username) = $1
       LIMIT 1`,
      [identifier]
    );
    const user = result.rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    return res.json({
      user: { id: user.id, email: user.email, username: user.username, role: user.role },
    });
  } catch (e) {
    console.error("[auth] login error", e);
    return res.status(500).json({ error: "Server error during login." });
  }
});

router.post("/logout", (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) {
      console.error("[auth] logout error", err);
      return res.status(500).json({ error: "Could not log out." });
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", async (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const result = await query(
    `SELECT id, email, username, role, created_at, last_login_at
     FROM users WHERE id = $1`,
    [req.session.userId]
  );
  res.json({ user: result.rows[0] || null });
});

module.exports = { router, requireAuth };
