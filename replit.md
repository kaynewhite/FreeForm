# Freeform Mana

Sharded sandbox MMORPG (top-down, browser-based, permadeath). This repo is the
working implementation. Currently only the auth slice is built.

## Stack
- Node.js 20 + Express
- PostgreSQL (Replit-managed) accessed via `pg`
- `bcrypt` for password hashing, `express-session` + `connect-pg-simple` for sessions
- Vanilla HTML/CSS/JS client (PixiJS will be added when world rendering starts)

## UI strategy
All UI is hand-coded HTML + CSS — **no UI asset packs, no UI frameworks**.
Tome aesthetic: dark navy background, gold accents, Cinzel / Cormorant Garamond
/ MedievalSharp web fonts, inline SVG sigil. The same approach scales to every
in-game UI surface (HUD, hotbar, inventory grid, character sheet, spellbook,
crafting, dialogs, tooltips, minimap frame, death screen) — DOM elements
overlaid on the PixiJS canvas, animated with CSS.

The only assets that need to be real images are **in-world** content: character
sprites (admin set already supplied), tile/terrain art, monster/NPC/item
sprites, spell-effect sheets, and small per-item icons (32×32 PNGs made one at
a time, not bought as a pack).

## Layout
- `server/index.js` — Express app, session middleware, static client, port 5000
- `server/db.js` — Postgres connection pool
- `server/schema.js` — Idempotent bootstrap of `users`, `characters`, `session` tables. Runs on every boot.
- `server/store.js` — Tiny file-backed JSON store. Atomic writes (temp file + rename) into `data/`. Used by sprite slices today; reusable for any small persisted blob.
- `server/auth.js` — `/api/auth/register`, `/login`, `/logout`, `/me`
- `server/characters.js` — `/api/characters` (forge, /me, /me/die)
- `server/races.js` — race definitions and stat modifiers (Human, Orc, Elf, Crystalline, Voidborn)
- `server/admin.js` — Admin character stat block per design doc §3.8 (no race/class)
- `server/seed.js` — Idempotent admin user seed, runs on every boot. Configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars.
- `server/sprites.js` — Admin-only. `/api/sprites/manifest` walks `client/assets/sprites/admin/base/` and reports every sheet grouped by animation+weapon. `/api/sprites/slices` (GET) and `/api/sprites/slice` (PUT/DELETE) read/write **`data/sprite_slices.json`** so per-sheet crops + animation metadata survive every restart and re-import. Each saved record contains: `frames`, `frameW`, `frameH`, `offsetX`, `offsetY`, `gapX`, `perFrame`, `frameRects`, `fps` (1-60), `scale` (1-8). The in-game animator can look up any URL and get everything it needs to play the animation correctly without recomputing.
- `server/maps.js` — Admin-only **tileset uploader** at `/api/maps`. Accepts only `.tsx` + `.png/.jpg` (no `.tmx` — actual maps are built in-world via `/command we` and `/command server_edit`). Files saved to `data/maps/<name>/`. Endpoints: `GET /api/maps`, `POST /api/maps/upload` (multipart), `GET /api/maps/file/:name/:file`, `DELETE /api/maps/:name`, `DELETE /api/maps/:name/file/:file`. ≤32 MB per file, ≤64 files per upload, strict filename whitelist, path-traversal blocked.
- `client/sprites.html` / `sprites.js` / `sprites.css` — Admin-only sandbox at `/sprites.html`. Renders direction previews + a raw-sheet cropper. Per-card slice controls (N/W/H/X/Y/G + reset). Drag-to-crop on the raw sheet, zoom slider, "Apply slice to all directions" (also propagates fps + scale). **Per-frame mode** (per-card opt-in): each frame stores its own `{x,y,w,h}` rect — for sheets where frames have different sizes/positions. **FPS + scale are per-card and persisted**; the global FPS/Scale inputs always reflect the *active* card and edit only that card. Each preview animates at its own fps; switching cards syncs the controls to that sheet's saved values. Saved data round-trips through `data/sprite_slices.json`.
- `client/maps.html` / `maps.js` / `maps.css` — Admin-only **Tileset Library** at `/maps.html`. Upload form (name + multi-file picker), stored-tilesets list with per-file types and delete buttons. Built-in TSX viewer parses the tileset, loads its image, and renders the tile grid with togglable grid lines and tile-id labels. Hover any tile to see its local id (and source rect); click a tile to copy its id to the clipboard for pasting into `/command we` workflows.
- `server/world.js` — Admin-only **world-state API** at `/api/world`. Per-shard sparse tile storage on disk at `data/world/<shard>.json`. Endpoints: `GET /:shard` (read full shard), `POST /:shard/paint` (batch paint/erase, max 1024 tiles per call), `POST /:shard/clear-layer`, `GET /_/tilesets` (parsed TSX summaries + image URLs the in-game palette consumes). Tile references are `"<tilesetName>:<localTileId>"` strings; every paint validates the tileset exists in `data/maps/` and the id is in range against a small in-memory TSX cache invalidated by mtime. Coords capped at ±2²⁰. Default layers `ground` + `decor` are auto-created. **Every shard starts as plain grass ground** — `defaultGround: "grass:0"` is written into the JSON on creation, and the in-game renderer fills any unset tile with this reference so a fresh world is walkable from the first frame. `ensureDefaultShard()` runs on boot so `data/world/default.json` always exists. Shard JSON shape: `{ shard, tileSize, defaultGround, createdAt, updatedAt, layers: [{ name, tiles: { "x,y": "tileset:id" } }] }`.
- **World painting is in-game, live.** There is intentionally no `/world.html` admin page — world editing happens inside the running game via `/command we`, `/command world_edit`, and `/command server_edit` (typed into the in-realm chat rail). Each click is a live write straight to `/api/world/default/paint`; there are no draft saves. The in-game palette is screen-contained — the realm view itself is `position: fixed`, the page never scrolls, and the only scrollable region is the palette body.
- `client/realm.html` is hosted inside `index.html` (section `#realm`). `client/realm.js` / `client/realm.css` own the in-realm view: a full-viewport top-down canvas that paints procedural grass everywhere by default (the "plain grass ground" all shards start as), then layers any painted tiles from `data/world/default.json` on top. WASD/arrow keys pan the camera (shift = sprint), mouse wheel zooms 1×–6×. The chat rail at the bottom-left accepts plain speech and slash commands; `/help` lists them, `/leave` exits back to the character sheet, `/command we` (and `/we`, plus the `world_edit` / `server_edit` aliases) toggles the admin palette overlay. Players see the world but get a polite refusal if they try a `/command we`. The palette overlay reuses `GET /api/world/_/tilesets` to enumerate uploaded TSX tilesets, lets the admin pick a tile, click world to paint, right-click to erase, drag to brush a stroke, and pick the active layer + brush mode (paint/erase) without leaving the realm.
- `server/world.js` write endpoints (`POST /:shard/paint`, `POST /:shard/clear-layer`) are admin-gated with an internal `requireAdmin` middleware, while `GET /:shard` and `GET /_/tilesets` only require an authenticated session — that way every player's client can render the live world while only admins can change it.
- `client/app.js` / `index.html` / `styles.css` — login, forge, and the character sheet. The character sheet now includes an **animated portrait canvas** (`#portrait-canvas`) above the name. On `showCharacter()` it picks the right idle-down sheet for the vessel (admin → `admin-idleDown-spritesheet.png`; players have no art yet → placeholder), fetches `/api/sprites/slices`, applies the saved frames/frameRects/perFrame/fps/scale, and runs a `requestAnimationFrame` loop centering each frame in the canvas (so per-frame rects of varying size don't jitter). Slices are cached for the session and the loop is torn down on logout. Falls back to a single-strip inference if no slice exists for the URL.
- `client/assets/sprites/admin/` — admin sprite sheets, organized by animation (idle/walk/attack/cast/death) and weapon variant (no-weapon + 13 weapon overlays). Death sheets are always a single non-directional row.
- `data/` — file-backed persistence, checkpointed with the project. `sprite_slices.json` for per-sheet crops, `maps/<name>/...` for uploaded tilesets, `world/<shard>.json` for painted world tiles. Created on boot.

## Database
Tables created via SQL on every boot (no ORM yet) by `server/schema.js`:
- `users(id, email, password_hash, role, created_at, last_login_at)`
- `characters(id, account_id, name, race, gender, mana_cap, max_hp, hp, level, xp, control, efficiency, cast_speed, resistance, stamina_cap, created_at, died_at)` with partial unique indexes `unique_living_char_name` and `one_living_char_per_account`. `race` and `gender` are nullable — admins have neither (design doc §3.8).
- `session(sid, sess, expire)` — session store

Sprite-slice and tilemap data live on disk under `data/`, not in Postgres, so admin work survives a database wipe.

## Run
- Workflow `Start application` runs `node server/index.js` on `0.0.0.0:5000`
- The preview pane is proxied to this port
- `SESSION_SECRET` is required in production; auto-generated in dev

## What's done
- Email/username + password registration with validation and bcrypt hashing
- Login (accepts email or username), logout, "who am I" endpoint
- Session cookies persisted in Postgres

## Next up (per design doc)
- Character creation (random race roll, gender, fixed 500 mana cap)
- Persist characters; permadeath flow (delete row on HP=0)
- WebSocket tick loop (20 Hz authoritative server) + PixiJS top-down client
- Wire the Map Workshop's parsed TMX into the world renderer so admins can build worlds from uploaded tilesets
