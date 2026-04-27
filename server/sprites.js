const express = require("express");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const router = express.Router();

const SPRITE_ROOT = path.join(__dirname, "..", "client", "assets", "sprites", "admin", "base");
const ANIMATIONS = ["idle", "walking", "attack", "cast", "death"];
const SLICES_FILE = "sprite_slices.json";

// In-memory cache of the slice store, hydrated from data/sprite_slices.json
// on boot. Every mutation writes the file atomically before responding so the
// admin's edits survive any restart of the system.
let slices = store.load(SLICES_FILE, {});

function persist() {
  store.save(SLICES_FILE, slices);
}

// Kept for backwards compatibility with index.js boot order. Slice data is
// now file-backed (no DB schema needed).
async function ensureSchema() {
  /* no-op */
}

function parseFile(file, animation) {
  const stem = file.replace(/-spritesheet\.png$/, "");
  const parts = stem.split("-");
  if (parts[0] !== "admin") return null;

  const weapon = parts.length === 2 ? "no-weapon" : parts[1];
  const tail = parts[parts.length - 1];
  const animKey = animation === "walking" ? "walk" : animation;
  const dirPart = tail.startsWith(animKey) ? tail.slice(animKey.length) : "";

  // Death is always a single non-directional strip — one row of frames.
  if (animation === "death") return { file, weapon, direction: null, combined: false };
  if (dirPart === "UpLeftDownRight") return { file, weapon, direction: null, combined: true };
  if (["Up", "Down", "Left", "Right"].includes(dirPart)) {
    return { file, weapon, direction: dirPart.toLowerCase(), combined: false };
  }
  return null;
}

router.get("/manifest", (_req, res) => {
  const out = {};
  for (const anim of ANIMATIONS) {
    const animDir = path.join(SPRITE_ROOT, `${anim}-spritesheets`);
    out[anim] = {};
    if (!fs.existsSync(animDir)) continue;
    for (const variant of fs.readdirSync(animDir)) {
      const variantDir = path.join(animDir, variant);
      if (!fs.statSync(variantDir).isDirectory()) continue;
      const entries = [];
      for (const f of fs.readdirSync(variantDir)) {
        if (!f.endsWith(".png")) continue;
        const parsed = parseFile(f, anim);
        if (!parsed) continue;
        entries.push({
          ...parsed,
          url: `/assets/sprites/admin/base/${anim}-spritesheets/${variant}/${f}`,
        });
      }
      if (entries.length) out[anim][variant] = entries;
    }
  }
  res.json({ root: "/assets/sprites/admin/base", animations: out });
});

// Returns every saved slice keyed by URL (or "<url>#row=N" for combined sheets).
router.get("/slices", (_req, res) => {
  res.json(slices);
});

// Validate a slice payload. Returns either a normalized object or { error }.
// Supports two modes:
//   - uniform (default): every frame is at offset + i*(frameW + gapX)
//   - per-frame (perFrame=true): each frame has its own {x,y,w,h} rect.
//     This is opt-in per-spritesheet so most sheets stay clean.
function normalizeSlice(body) {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url.startsWith("/assets/sprites/admin/base/")) {
    return { error: "Invalid sprite URL" };
  }
  const intFields = ["frames", "frameW", "frameH", "offsetX", "offsetY", "gapX"];
  const v = {};
  for (const f of intFields) {
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(n)) {
      return { error: `Invalid ${f}` };
    }
    v[f] = n;
  }
  if (v.frames < 1 || v.frameW < 1 || v.frameH < 1) {
    return { error: "frames / frameW / frameH must be > 0" };
  }

  const perFrame = !!body.perFrame;
  let frameRects = null;
  if (perFrame) {
    if (!Array.isArray(body.frameRects) || body.frameRects.length !== v.frames) {
      return { error: "frameRects must be an array of length === frames" };
    }
    frameRects = [];
    for (let i = 0; i < v.frames; i++) {
      const r = body.frameRects[i] || {};
      const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
      if (![x, y, w, h].every((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 100000)) {
        return { error: `Invalid frameRects[${i}]` };
      }
      if (w < 1 || h < 1) return { error: `frameRects[${i}] must have w/h >= 1` };
      frameRects.push({ x, y, w, h });
    }
  }
  return { url, ...v, perFrame, frameRects };
}

router.put("/slice", (req, res) => {
  const n = normalizeSlice(req.body || {});
  if (n.error) return res.status(400).json({ error: n.error });

  slices[n.url] = {
    frames: n.frames,
    frameW: n.frameW,
    frameH: n.frameH,
    offsetX: n.offsetX,
    offsetY: n.offsetY,
    gapX: n.gapX,
    perFrame: n.perFrame,
    frameRects: n.frameRects,
    updatedAt: new Date().toISOString(),
    updatedBy: req.session?.userId || null,
  };

  try {
    persist();
    res.json({ ok: true });
  } catch (err) {
    console.error("[sprites] save failed:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.delete("/slice", (req, res) => {
  const url = (req.query.url || req.body?.url || "").toString().trim();
  if (!url.startsWith("/assets/sprites/admin/base/")) {
    return res.status(400).json({ error: "Invalid sprite URL" });
  }
  if (!(url in slices)) return res.json({ ok: true });
  delete slices[url];
  try {
    persist();
    res.json({ ok: true });
  } catch (err) {
    console.error("[sprites] delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = { router, ensureSchema };
