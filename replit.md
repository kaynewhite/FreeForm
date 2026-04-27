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
- `server/sprites.js` — Admin-only. `/api/sprites/manifest` walks `client/assets/sprites/admin/base/` and reports every sheet grouped by animation+weapon. `/api/sprites/slices` (GET) and `/api/sprites/slice` (PUT/DELETE) read/write **`data/sprite_slices.json`** so the admin's per-sheet crops survive every restart and re-import.
- `server/maps.js` — Admin-only. Upload, list, fetch, and delete Tiled map bundles (.tmx + .tsx + tileset images) under `data/maps/<name>/`. Endpoints: `GET /api/maps`, `POST /api/maps/upload` (multipart), `GET /api/maps/file/:name/:file`, `DELETE /api/maps/:name`, `DELETE /api/maps/:name/file/:file`. Filenames whitelisted to `.tmx/.tsx/.png/.jpg`, ≤32 MB each, ≤64 files per upload.
- `client/sprites.html` / `sprites.js` / `sprites.css` — Admin-only sandbox at `/sprites.html`. Renders direction previews + a raw-sheet cropper. Per-card slice controls (N/W/H/X/Y/G + reset). Drag-to-crop on the raw sheet, zoom slider, "Apply slice to all directions". **Per-frame mode** (per-card opt-in): when toggled on, each frame stores its own `{x,y,w,h}` rect — used for sheets where individual frames have different sizes/positions. The drag-to-crop and W/H/X/Y inputs then edit the *active* frame's rect; an "Active frame" selector picks which one. Saved data round-trips through `data/sprite_slices.json`.
- `client/maps.html` / `maps.js` / `maps.css` — Admin-only Map Workshop at `/maps.html`. Upload form (name + multi-file picker), stored-maps list with per-file types and delete buttons, and a built-in TMX viewer that parses the map + every referenced TSX (external or embedded), loads tileset images, and renders all visible layers to a canvas with per-tile flip flags. Layer toggles + zoom slider.
- `client/` — static frontend (login, forge, character sheet)
- `client/assets/sprites/admin/` — admin sprite sheets, organized by animation (idle/walk/attack/cast/death) and weapon variant (no-weapon + 13 weapon overlays). Death sheets are always a single non-directional row.
- `data/` — file-backed persistence, checkpointed with the project. `sprite_slices.json` for per-sheet crops, `maps/<name>/...` for uploaded Tiled bundles. Created on boot.

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
