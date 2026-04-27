const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const store = require("./store");

const router = express.Router();

const MAPS_DIR = path.join(store.DATA_DIR, "maps");
fs.mkdirSync(MAPS_DIR, { recursive: true });

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SAFE_FILE_RE = /^[A-Za-z0-9._-]+\.(tmx|tsx|png|jpg|jpeg)$/i;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function safeMapDir(name) {
  if (!NAME_RE.test(name)) return null;
  const dir = path.resolve(MAPS_DIR, name);
  if (dir !== path.join(MAPS_DIR, name)) return null;
  if (!dir.startsWith(MAPS_DIR + path.sep)) return null;
  return dir;
}

function safeFileName(name) {
  if (!SAFE_FILE_RE.test(name)) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 64 },
  fileFilter: (_req, file, cb) => {
    if (!safeFileName(file.originalname)) {
      return cb(new Error(`Filename rejected: ${file.originalname}. Only .tmx, .tsx, .png, .jpg files are allowed.`));
    }
    cb(null, true);
  },
});

// List every uploaded map with its files.
router.get("/", (_req, res) => {
  const out = [];
  for (const name of fs.readdirSync(MAPS_DIR)) {
    if (name.startsWith(".")) continue;
    const dir = path.join(MAPS_DIR, name);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const s = fs.statSync(path.join(dir, f));
        return {
          name: f,
          size: s.size,
          ext: path.extname(f).slice(1).toLowerCase(),
          updatedAt: s.mtime.toISOString(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push({ name, files });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ maps: out });
});

// Upload one or more files into a named map directory. Existing files of the
// same name are overwritten — that's how you replace a tileset image.
router.post("/upload", upload.array("files", 64), (req, res) => {
  const name = (req.body?.name || "").trim();
  const dir = safeMapDir(name);
  if (!dir) {
    return res.status(400).json({
      error: "Map name must be 1-64 characters, letters/numbers/underscore/dash only.",
    });
  }
  if (!req.files?.length) {
    return res.status(400).json({ error: "No files uploaded." });
  }

  // Validate all filenames first — don't write anything if any are bad.
  for (const f of req.files) {
    if (!safeFileName(f.originalname)) {
      return res.status(400).json({ error: `Invalid filename: ${f.originalname}` });
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const f of req.files) {
    const dest = path.join(dir, f.originalname);
    if (!dest.startsWith(dir + path.sep)) {
      return res.status(400).json({ error: `Refused unsafe path: ${f.originalname}` });
    }
    fs.writeFileSync(dest, f.buffer);
    written.push(f.originalname);
  }
  res.json({ ok: true, name, written });
});

// Delete a single file from a map directory. (Map-level delete handled below.)
router.delete("/:name/file/:file", (req, res) => {
  const dir = safeMapDir(req.params.name);
  const file = safeFileName(req.params.file);
  if (!dir || !file) return res.status(400).json({ error: "Invalid name or filename." });
  const full = path.join(dir, file);
  if (!full.startsWith(dir + path.sep) || !fs.existsSync(full)) {
    return res.status(404).json({ error: "Not found" });
  }
  fs.unlinkSync(full);
  res.json({ ok: true });
});

// Wipe an entire map directory.
router.delete("/:name", (req, res) => {
  const dir = safeMapDir(req.params.name);
  if (!dir) return res.status(400).json({ error: "Invalid map name" });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: "Map not found" });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// Serve a single map asset. The viewer pulls TMX/TSX text and tileset images
// through this endpoint so admin map data never has to be exposed publicly.
router.get("/file/:name/:file", (req, res) => {
  const dir = safeMapDir(req.params.name);
  const file = safeFileName(req.params.file);
  if (!dir || !file) return res.status(400).json({ error: "Invalid name or filename." });
  const full = path.join(dir, file);
  if (!full.startsWith(dir + path.sep) || !fs.existsSync(full)) {
    return res.status(404).json({ error: "Not found" });
  }
  // TMX / TSX should be served as text/xml so DOMParser is happy in the browser.
  const ext = path.extname(file).toLowerCase();
  if (ext === ".tmx" || ext === ".tsx") res.type("application/xml");
  res.sendFile(full);
});

// Multer error handler — turn its thrown errors into clean 400 JSON.
router.use((err, _req, res, _next) => {
  if (err) {
    return res.status(400).json({ error: err.message || "Upload failed" });
  }
  res.status(500).json({ error: "Server error" });
});

module.exports = { router };
