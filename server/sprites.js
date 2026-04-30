const express = require("express");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const router = express.Router();

// Sprite assets are organized as:
//   client/assets/sprites/<character>/base/<anim>-spritesheets/<variant>/<file>.png
// where <character> is "admin", "osnica", etc. The endpoints in this file
// accept a `?character=<id>` query (defaulting to admin) so a single
// sandbox UI can flip between characters without changing routes.
const SPRITE_ROOT_DIR = path.join(__dirname, "..", "client", "assets", "sprites");
const ANIMATIONS = ["idle", "walking", "attack", "cast", "death"];
const SLICES_FILE = "sprite_slices.json";

let slices = store.load(SLICES_FILE, {});

function persist() {
  store.save(SLICES_FILE, slices);
}

async function ensureSchema() { /* slices are file-backed; no DB schema */ }

// Walks SPRITE_ROOT_DIR for any subdirectory that contains a `base/`
// folder. That's our minimum bar for "this character has uploaded art".
function listCharacters() {
  if (!fs.existsSync(SPRITE_ROOT_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(SPRITE_ROOT_DIR)) {
    const full = path.join(SPRITE_ROOT_DIR, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const baseDir = path.join(full, "base");
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) continue;
    out.push({
      id: name,
      label: name === "admin" ? "Admin" : name.replace(/^./, (c) => c.toUpperCase()),
      base: `/assets/sprites/${name}/base`,
      hasSheets: anyAnimDirHasFiles(baseDir),
    });
  }
  // Stable order: admin first, then alphabetical.
  out.sort((a, b) => (a.id === "admin" ? -1 : b.id === "admin" ? 1 : a.id.localeCompare(b.id)));
  return out;
}

function anyAnimDirHasFiles(baseDir) {
  for (const anim of ANIMATIONS) {
    const animDir = path.join(baseDir, `${anim}-spritesheets`);
    if (!fs.existsSync(animDir)) continue;
    for (const variant of fs.readdirSync(animDir)) {
      const variantDir = path.join(animDir, variant);
      if (!fs.statSync(variantDir).isDirectory()) continue;
      for (const f of fs.readdirSync(variantDir)) {
        if (f.endsWith(".png")) return true;
      }
    }
  }
  return false;
}

// Filenames are "<character>[-<weapon>]-<animKey><Direction>-spritesheet.png".
// e.g. "admin-walkUp-spritesheet.png", "admin-sword-attackDownLeftUpRight-spritesheet.png"
function parseFile(file, character, animation) {
  const stem = file.replace(/-spritesheet\.png$/, "");
  const parts = stem.split("-");
  if (parts[0] !== character) return null;

  const weapon = parts.length === 2 ? "no-weapon" : parts[1];
  const tail = parts[parts.length - 1];
  const animKey = animation === "walking" ? "walk" : animation;
  const dirPart = tail.startsWith(animKey) ? tail.slice(animKey.length) : "";

  if (animation === "death") return { file, weapon, direction: null, combined: false };
  if (dirPart === "UpLeftDownRight") return { file, weapon, direction: null, combined: true };
  if (["Up", "Down", "Left", "Right"].includes(dirPart)) {
    return { file, weapon, direction: dirPart.toLowerCase(), combined: false };
  }
  // Single non-directional sheet (e.g. OS Nica's hand-painted strips that
  // were authored without a per-direction split).  We treat these the same
  // way the sandbox treats death sheets — one card, no facing.
  if (dirPart === "") return { file, weapon, direction: null, combined: false };
  return null;
}

function safeCharacterId(req) {
  const raw = (req.query.character || req.body?.character || "admin").toString().trim();
  // Defensive: only allow simple slugs to keep this off any path-traversal
  // surface even though we never concatenate it into a shell command.
  if (!/^[a-z0-9_-]+$/i.test(raw)) return null;
  return raw;
}

// List every character folder that has uploaded sheets (or at least a
// `base/` directory). The sandbox uses this to populate its dropdown.
router.get("/characters", (_req, res) => {
  res.json({ characters: listCharacters() });
});

router.get("/manifest", (req, res) => {
  const character = safeCharacterId(req);
  if (!character) return res.status(400).json({ error: "Invalid character" });
  const baseDir = path.join(SPRITE_ROOT_DIR, character, "base");
  const out = {};
  for (const anim of ANIMATIONS) {
    const animDir = path.join(baseDir, `${anim}-spritesheets`);
    out[anim] = {};
    if (!fs.existsSync(animDir)) continue;
    for (const variant of fs.readdirSync(animDir)) {
      const variantDir = path.join(animDir, variant);
      if (!fs.statSync(variantDir).isDirectory()) continue;
      const entries = [];
      for (const f of fs.readdirSync(variantDir)) {
        if (!f.endsWith(".png")) continue;
        const parsed = parseFile(f, character, anim);
        if (!parsed) continue;
        entries.push({
          ...parsed,
          url: `/assets/sprites/${character}/base/${anim}-spritesheets/${variant}/${f}`,
        });
      }
      if (entries.length) out[anim][variant] = entries;
    }
  }
  res.json({
    character,
    root: `/assets/sprites/${character}/base`,
    animations: out,
  });
});

router.get("/slices", (_req, res) => {
  res.json(slices);
});

// URL guard accepts /assets/sprites/<character>/base/... for any character.
const SPRITE_URL_RE = /^\/assets\/sprites\/[a-z0-9_-]+\/base\//i;

function normalizeSlice(body) {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!SPRITE_URL_RE.test(url)) return { error: "Invalid sprite URL" };
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
  const fps = body.fps === undefined || body.fps === null ? 8 : Number(body.fps);
  const scale = body.scale === undefined || body.scale === null ? 3 : Number(body.scale);
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) return { error: "Invalid fps" };
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) return { error: "Invalid scale" };
  v.fps = fps;
  v.scale = scale;

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
    fps: n.fps,
    scale: n.scale,
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
  if (!SPRITE_URL_RE.test(url)) {
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

// Copy every saved slice for /assets/sprites/<from>/... to the analogous
// /assets/sprites/<to>/... URL. Used by the sandbox's "Apply settings to
// other character" button so an admin can mirror the calibration they've
// done for one character (frame counts, fps, scale, per-frame rects)
// onto another character's matching sheets in one click.
router.post("/copy-slices", (req, res) => {
  const from = (req.body?.from || "").toString().trim();
  const to   = (req.body?.to   || "").toString().trim();
  if (!/^[a-z0-9_-]+$/i.test(from) || !/^[a-z0-9_-]+$/i.test(to)) {
    return res.status(400).json({ error: "Invalid character id" });
  }
  if (from === to) return res.status(400).json({ error: "Source and destination must differ" });

  const fromPrefix = `/assets/sprites/${from}/`;
  const toPrefix   = `/assets/sprites/${to}/`;
  let copied = 0, skipped = 0;
  for (const url of Object.keys(slices)) {
    if (!url.startsWith(fromPrefix)) continue;
    const targetUrl = toPrefix + url.slice(fromPrefix.length);
    // Match the analogous filename ending in `<character>-...-spritesheet.png` —
    // if the destination doesn't have a corresponding file on disk, skip
    // (we don't want to leave dangling slices for nonexistent sheets).
    const onDiskPath = path.join(SPRITE_ROOT_DIR, ...targetUrl.replace("/assets/sprites/", "").split("/"));
    // The original filename embeds `<from>-` as a prefix; rewrite it to `<to>-`.
    const dir = path.dirname(onDiskPath);
    const filename = path.basename(onDiskPath);
    const rewrittenFilename = filename.startsWith(`${from}-`)
      ? `${to}-${filename.slice(from.length + 1)}`
      : filename;
    const finalDiskPath = path.join(dir, rewrittenFilename);
    if (!fs.existsSync(finalDiskPath)) { skipped++; continue; }
    const finalUrl = path.posix.join(path.posix.dirname(targetUrl), rewrittenFilename);

    slices[finalUrl] = {
      ...slices[url],
      updatedAt: new Date().toISOString(),
      updatedBy: req.session?.userId || null,
    };
    copied++;
  }
  try {
    persist();
    res.json({ ok: true, copied, skipped });
  } catch (err) {
    console.error("[sprites] copy failed:", err);
    res.status(500).json({ error: "Copy failed" });
  }
});

module.exports = { router, ensureSchema };
