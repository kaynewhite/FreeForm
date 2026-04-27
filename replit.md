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
- `server/auth.js` — `/api/auth/register`, `/login`, `/logout`, `/me`
- `server/characters.js` — `/api/characters` (forge, /me, /me/die)
- `server/races.js` — race definitions and stat modifiers (Human, Orc, Elf, Crystalline, Voidborn)
- `server/admin.js` — Admin character stat block per design doc §3.8 (no race/class)
- `server/seed.js` — Idempotent admin user seed, runs on every boot. Configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars.
- `server/sprites.js` — Admin-only `/api/sprites/manifest` endpoint. Walks `client/assets/sprites/admin/base/` and reports every sheet grouped by animation+weapon, marking each as per-direction or combined `UpLeftDownRight`.
- `client/sprites.html` / `sprites.js` / `sprites.css` — Admin-only sandbox at `/sprites.html`. Renders 4 direction previews + a raw-sheet cropper. Per-card slice controls (N/W/H/X/Y/G + reset, where G is the horizontal gap between frames). The raw sheet supports **drag-to-crop**: drag a box around the first frame and the active card's slice updates live, with ghost previews of the N repeats stepping right by `W + Gap`. Gap regions are tinted faint cyan in the overlay so they're visible. Zoom slider (1×–8×) for accurate cropping on tiny sheets. "Apply slice to all directions" copies the active card's W/H/X/Gap (and Y for per-direction sets) to the others. Linked from the account strip when role=admin.
- `client/` — static frontend (login, forge, character sheet)
- `client/assets/sprites/admin/` — admin sprite sheets, organized by animation (idle/walk/attack/cast/death) and weapon variant (no-weapon + 13 weapon overlays)

## Database
Tables created via SQL (no ORM yet):
- `users(id, email, password_hash, role, created_at, last_login_at)`
- `characters(id, account_id, name, race, gender, mana_cap, max_hp, hp, level, xp, control, efficiency, cast_speed, resistance, stamina_cap, created_at, died_at)` with partial unique indexes `unique_living_char_name` and `one_living_char_per_account`. `race` and `gender` are nullable — admins have neither (design doc §3.8).
- `session(sid, sess, expire)` — session store

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
