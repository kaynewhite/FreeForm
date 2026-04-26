require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);

const { pool } = require("./db");
const { router: authRouter, requireAuth } = require("./auth");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 5000;
const IS_PROD = process.env.NODE_ENV === "production";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (IS_PROD ? null : crypto.randomBytes(32).toString("hex"));
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

app.use(
  session({
    store: new PgSession({ pool, tableName: "session" }),
    name: "fm.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);

if (!IS_PROD) {
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    next();
  });
}

app.use("/api/auth", authRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/home", requireAuth, async (_req, res) => {
  res.json({ message: "Welcome back, traveler." });
});

const PUBLIC_DIR = path.join(__dirname, "..", "client");
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
