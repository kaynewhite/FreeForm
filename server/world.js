const express = require("express");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const router = express.Router();

const WORLD_DIR = path.join(store.DATA_DIR, "world");
fs.mkdirSync(WORLD_DIR, { recursive: true });

const MAPS_DIR = path.join(store.DATA_DIR, "maps");

// Shard names follow the same conventions as map / tileset names.
const SHARD_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
// Layer names (admin-defined). Same character set as shards but shorter.
const LAYER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
// Tile reference is "<tileset_name>:<local_tile_id>". Tileset names follow
// the same /^[a-zA-Z0-9_-]+$/ rule the maps router enforces; tile id is a
// non-negative integer.
const TILE_REF_RE = /^([a-zA-Z0-9][a-zA-Z0-9_-]{0,63}):(\d+)$/;
// Sparse coords use 32-bit signed range, capped to keep the JSON file from
// being weaponised against itself (one paint op can't blow past these).
const COORD_MAX = 1 << 20; // ~±1 million tiles each direction
const MAX_BATCH = 1024;
const DEFAULT_LAYERS = ["ground", "decor"];

function shardPath(shard) {
  if (!SHARD_RE.test(shard)) return null;
  const file = path.resolve(WORLD_DIR, `${shard}.json`);
  if (path.dirname(file) !== WORLD_DIR) return null;
  return file;
}

function emptyShard(shard) {
  const now = new Date().toISOString();
  return {
    shard,
    tileSize: 16,
    createdAt: now,
    updatedAt: now,
    layers: DEFAULT_LAYERS.map((name) => ({ name, tiles: {} })),
  };
}

function loadShard(shard) {
  const file = shardPath(shard);
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const w = JSON.parse(raw);
    // Defensive: if the file is older / partially written, fix it up rather
    // than crash. Missing layers are added empty so paints to them work.
    if (!Array.isArray(w.layers)) w.layers = [];
    for (const name of DEFAULT_LAYERS) {
      if (!w.layers.some((l) => l.name === name)) {
        w.layers.push({ name, tiles: {} });
      }
    }
    return w;
  } catch (err) {
    if (err.code === "ENOENT") return emptyShard(shard);
    throw err;
  }
}

function saveShard(w) {
  w.updatedAt = new Date().toISOString();
  const file = shardPath(w.shard);
  if (!file) throw new Error("Invalid shard");
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(w, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// Tiny TSX cache. Keyed by tileset name; invalidated when the underlying
// .tsx file's mtime changes. We only need a handful of fields, so a lazy
// regex parse is fine and avoids pulling in a real XML library.
const tsxCache = new Map();
function readTilesetMeta(name) {
  const dir = path.join(MAPS_DIR, name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const tsx = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(".tsx"));
  if (!tsx) return null;
  const tsxPath = path.join(dir, tsx);
  const stat = fs.statSync(tsxPath);
  const cached = tsxCache.get(name);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.meta;
  const xml = fs.readFileSync(tsxPath, "utf8");
  const attr = (re) => {
    const m = xml.match(re);
    return m ? m[1] : null;
  };
  const meta = {
    name,
    tileWidth: Number(attr(/tilewidth="(\d+)"/i)),
    tileHeight: Number(attr(/tileheight="(\d+)"/i)),
    tileCount: Number(attr(/tilecount="(\d+)"/i)),
    columns: Number(attr(/\bcolumns="(\d+)"/i)),
    spacing: Number(attr(/spacing="(\d+)"/i)) || 0,
    margin: Number(attr(/margin="(\d+)"/i)) || 0,
    image: attr(/<image[^>]*\bsource="([^"]+)"/i),
    imageWidth: Number(attr(/<image[^>]*\bwidth="(\d+)"/i)),
    imageHeight: Number(attr(/<image[^>]*\bheight="(\d+)"/i)),
  };
  if (!Number.isFinite(meta.tileCount) || meta.tileCount <= 0) return null;
  tsxCache.set(name, { mtimeMs: stat.mtimeMs, meta });
  return meta;
}

function validateTileRef(ref) {
  // Returns { ok:true, tileset, tileId } or { ok:false, error }.
  if (typeof ref !== "string") return { ok: false, error: "tile must be a string" };
  const m = ref.match(TILE_REF_RE);
  if (!m) return { ok: false, error: `tile must look like "tileset:id", got "${ref}"` };
  const tileset = m[1];
  const tileId = Number(m[2]);
  const meta = readTilesetMeta(tileset);
  if (!meta) return { ok: false, error: `tileset "${tileset}" not found` };
  if (tileId < 0 || tileId >= meta.tileCount) {
    return { ok: false, error: `tile id ${tileId} out of range for "${tileset}" (0..${meta.tileCount - 1})` };
  }
  return { ok: true, tileset, tileId };
}

function findOrAddLayer(world, name) {
  if (!LAYER_RE.test(name)) return null;
  let layer = world.layers.find((l) => l.name === name);
  if (!layer) {
    layer = { name, tiles: {} };
    world.layers.push(layer);
  }
  return layer;
}

function coordKey(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (Math.abs(x) > COORD_MAX || Math.abs(y) > COORD_MAX) return null;
  return `${x},${y}`;
}

// ---- routes ----

// Read a shard's full tile data. (Admin-only via the route mount in
// server/index.js for now; once non-admins need to render the world, we'll
// split read access out of the admin gate.)
router.get("/:shard", (req, res) => {
  const file = shardPath(req.params.shard);
  if (!file) return res.status(400).json({ error: "Invalid shard name" });
  try {
    const world = loadShard(req.params.shard);
    res.json({ world });
  } catch (err) {
    console.error("[world] read failed", err);
    res.status(500).json({ error: "Failed to read shard" });
  }
});

// Paint a batch of tiles. Body shape:
//   { layer: "ground", tiles: [{ x, y, tile: "terrain_set:5" }, ...] }
// To erase, send tile: null. Mixed paint+erase in one batch is fine.
router.post("/:shard/paint", (req, res) => {
  const file = shardPath(req.params.shard);
  if (!file) return res.status(400).json({ error: "Invalid shard name" });
  const { layer, tiles } = req.body || {};
  if (!layer || typeof layer !== "string") return res.status(400).json({ error: "layer required" });
  if (!Array.isArray(tiles)) return res.status(400).json({ error: "tiles must be an array" });
  if (tiles.length === 0) return res.status(400).json({ error: "tiles array is empty" });
  if (tiles.length > MAX_BATCH) return res.status(400).json({ error: `tiles batch too large (max ${MAX_BATCH})` });
  if (!LAYER_RE.test(layer)) return res.status(400).json({ error: "Invalid layer name" });

  // Validate every entry up front — partial paints would leave the shard
  // file in a half-finished state and we'd never know which write was bad.
  const ops = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!t || typeof t !== "object") return res.status(400).json({ error: `tiles[${i}] must be an object` });
    const key = coordKey(t.x, t.y);
    if (!key) return res.status(400).json({ error: `tiles[${i}] has invalid coords` });
    if (t.tile === null || t.tile === undefined) {
      ops.push({ key, ref: null });
    } else {
      const v = validateTileRef(t.tile);
      if (!v.ok) return res.status(400).json({ error: `tiles[${i}]: ${v.error}` });
      ops.push({ key, ref: t.tile });
    }
  }

  try {
    const world = loadShard(req.params.shard);
    const lyr = findOrAddLayer(world, layer);
    if (!lyr) return res.status(400).json({ error: "Invalid layer name" });
    let painted = 0, erased = 0;
    for (const op of ops) {
      if (op.ref === null) {
        if (op.key in lyr.tiles) { delete lyr.tiles[op.key]; erased++; }
      } else {
        lyr.tiles[op.key] = op.ref;
        painted++;
      }
    }
    saveShard(world);
    res.json({ ok: true, painted, erased, layer });
  } catch (err) {
    console.error("[world] paint failed", err);
    res.status(500).json({ error: "Failed to paint" });
  }
});

// Wipe an entire layer's tiles (the layer itself stays).
router.post("/:shard/clear-layer", (req, res) => {
  const file = shardPath(req.params.shard);
  if (!file) return res.status(400).json({ error: "Invalid shard name" });
  const { layer } = req.body || {};
  if (!layer || !LAYER_RE.test(layer)) return res.status(400).json({ error: "Invalid layer name" });
  try {
    const world = loadShard(req.params.shard);
    const lyr = world.layers.find((l) => l.name === layer);
    if (!lyr) return res.status(404).json({ error: "Layer not found" });
    const cleared = Object.keys(lyr.tiles).length;
    lyr.tiles = {};
    saveShard(world);
    res.json({ ok: true, cleared, layer });
  } catch (err) {
    console.error("[world] clear-layer failed", err);
    res.status(500).json({ error: "Failed to clear layer" });
  }
});

// Tileset metadata for the world editor UI. Returns the parsed TSX summary
// for every uploaded tileset, plus the URL the editor should load the image
// from (the existing /api/maps/file/... endpoint).
router.get("/_/tilesets", (_req, res) => {
  if (!fs.existsSync(MAPS_DIR)) return res.json({ tilesets: [] });
  const out = [];
  for (const name of fs.readdirSync(MAPS_DIR)) {
    if (name.startsWith(".")) continue;
    const dir = path.join(MAPS_DIR, name);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const meta = readTilesetMeta(name);
    if (!meta || !meta.image) continue;
    out.push({
      ...meta,
      imageUrl: `/api/maps/file/${encodeURIComponent(name)}/${encodeURIComponent(meta.image)}`,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ tilesets: out });
});

module.exports = { router };
