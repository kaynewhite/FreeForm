const express = require("express");
const fs = require("fs");
const path = require("path");
const { query } = require("./db");

const router = express.Router();

const SPRITE_ROOT = path.join(__dirname, "..", "client", "assets", "sprites", "admin", "base");
const ANIMATIONS = ["idle", "walking", "attack", "cast", "death"];

// Bootstrap the slice-config table. Idempotent — safe to run on every boot.
async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS sprite_slices (
      url         TEXT        PRIMARY KEY,
      frames      INTEGER     NOT NULL CHECK (frames     > 0),
      frame_w     INTEGER     NOT NULL CHECK (frame_w    > 0),
      frame_h     INTEGER     NOT NULL CHECK (frame_h    > 0),
      offset_x    INTEGER     NOT NULL DEFAULT 0 CHECK (offset_x >= 0),
      offset_y    INTEGER     NOT NULL DEFAULT 0 CHECK (offset_y >= 0),
      gap_x       INTEGER     NOT NULL DEFAULT 0 CHECK (gap_x    >= 0),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}

function parseFile(file, animation) {
  const stem = file.replace(/-spritesheet\.png$/, "");
  const parts = stem.split("-");
  if (parts[0] !== "admin") return null;

  const weapon = parts.length === 2 ? "no-weapon" : parts[1];
  const tail = parts[parts.length - 1];
  const animKey = animation === "walking" ? "walk" : animation;
  const dirPart = tail.startsWith(animKey) ? tail.slice(animKey.length) : "";

  if (animation === "death") return { file, weapon, direction: null, combined: false };
  if (dirPart === "UpLeftDownRight") return { file, weapon, direction: null, combined: true };
  if (["Up", "Down", "Left", "Right"].includes(dirPart)) {
    return { file, weapon, direction: dirPart.toLowerCase(), combined: false };
  }
  return null;
}

function rowToSlice(r) {
  return {
    frames: r.frames,
    frameW: r.frame_w,
    frameH: r.frame_h,
    offsetX: r.offset_x,
    offsetY: r.offset_y,
    gapX: r.gap_x,
    updatedAt: r.updated_at,
  };
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

// Return every saved slice as { url: { frames, frameW, frameH, offsetX, offsetY, gapX } }.
// Includes synthetic "<url>#row=N" keys for combined sheets where each row of
// directions has its own slice.
router.get("/slices", async (_req, res) => {
  try {
    const r = await query(`SELECT * FROM sprite_slices`);
    const out = {};
    for (const row of r.rows) out[row.url] = rowToSlice(row);
    res.json(out);
  } catch (err) {
    console.error("[sprites] load slices failed:", err);
    res.status(500).json({ error: "Load failed" });
  }
});

// Validate a slice payload. Returns either a normalized object or an error string.
function normalizeSlice(body) {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url.startsWith("/assets/sprites/admin/base/")) {
    return { error: "Invalid sprite URL" };
  }
  const fields = ["frames", "frameW", "frameH", "offsetX", "offsetY", "gapX"];
  const v = {};
  for (const f of fields) {
    const n = Number(body[f]);
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(n)) {
      return { error: `Invalid ${f}` };
    }
    v[f] = n;
  }
  if (v.frames < 1 || v.frameW < 1 || v.frameH < 1) {
    return { error: "frames / frameW / frameH must be > 0" };
  }
  return { url, ...v };
}

router.put("/slice", async (req, res) => {
  const n = normalizeSlice(req.body || {});
  if (n.error) return res.status(400).json({ error: n.error });

  try {
    await query(
      `INSERT INTO sprite_slices
         (url, frames, frame_w, frame_h, offset_x, offset_y, gap_x, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (url) DO UPDATE SET
         frames=EXCLUDED.frames,
         frame_w=EXCLUDED.frame_w,
         frame_h=EXCLUDED.frame_h,
         offset_x=EXCLUDED.offset_x,
         offset_y=EXCLUDED.offset_y,
         gap_x=EXCLUDED.gap_x,
         updated_by=EXCLUDED.updated_by,
         updated_at=NOW()`,
      [n.url, n.frames, n.frameW, n.frameH, n.offsetX, n.offsetY, n.gapX, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[sprites] save failed:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.delete("/slice", async (req, res) => {
  const url = (req.query.url || req.body?.url || "").toString().trim();
  if (!url.startsWith("/assets/sprites/admin/base/")) {
    return res.status(400).json({ error: "Invalid sprite URL" });
  }
  try {
    await query(`DELETE FROM sprite_slices WHERE url = $1`, [url]);
    res.json({ ok: true });
  } catch (err) {
    console.error("[sprites] delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = { router, ensureSchema };
