# Freeform Mana

Sharded sandbox MMORPG (top-down, browser-based, permadeath). This repo is the
working implementation. Currently only the auth slice is built.

## Stack
- Node.js 20 + Express
- PostgreSQL (Replit-managed) accessed via `pg`
- `bcrypt` for password hashing, `express-session` + `connect-pg-simple` for sessions
- `ws` for the realtime layer (20 Hz authoritative tick on `/ws/realm`)
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
- `server/index.js` — Express app, session middleware, static client, port 5000. Wraps the app in `http.createServer` so `server/realtime.js` can attach a WebSocket upgrade handler on the same port.
- `server/realtime.js` — Realtime / multiplayer layer. WebSocket server at `/ws/realm` that authenticates the upgrade by reading the express-session cookie (`fm.sid`), unsigning it with the same `SESSION_SECRET`, and looking the session up in the `session` table. On connect, loads the caller's living character (404s if dead/none) and adds them to a per-shard `Player` record (`{x, y, facing, anim, input}`). Runs a 20 Hz authoritative tick: each player's last-received `input` packet (`{dx,dy,sprint,facing}`) is integrated into x/y at 4.5 tiles/s walk (×1.8 sprint) with diagonals normalized, then the full shard snapshot is broadcast as `{type:"state", t, players:[…]}`. Client→server messages: `input`, `chat`, `ping`. Server→client: `welcome` (you + others on join), `join`, `leave`, `state`, `chat` (system + say), `pong`, `goodbye` (sent on multi-tab takeover with close code 4000). Position survives logout via `pos_x`, `pos_y`, `shard`, `facing` columns on `characters` — loaded on connect, lazy-saved every 15 s and on disconnect.
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
- `client/realm.html` is hosted inside `index.html` (section `#realm`). `client/realm.js` / `client/realm.css` own the in-realm view: a full-viewport top-down canvas that paints procedural grass everywhere by default (the "plain grass ground" all shards start as), then layers any painted tiles from `data/world/default.json` on top, then renders every player on the shard (self + others) as race-tinted circles with name plates and a facing tick (admins draw with a gold ring, self with a thin gold ring). On `enter()` the realm opens a `WebSocket` to `/ws/realm` (no token — the session cookie travels with the upgrade) and ingests `welcome` / `join` / `leave` / `state` / `chat` messages. WASD/arrow keys send `input` packets to the server (~20 Hz coalesced) and the camera follows the **server-authoritative** position (smooth fractional-tile scroll); shift = sprint. Mouse wheel zooms 1×–6×. The chat rail broadcasts plain speech through the socket — every connected client in the shard sees the same line, in order. Slash commands stay client-side: `/help` lists them, `/leave` exits back to the character sheet (and tears down the socket), `/command we` (and `/we`, plus the `world_edit` / `server_edit` aliases) toggles the admin palette overlay. While the editor is open, WASD reverts to free-pan and the player avatar is parked (input zeroed out) so the admin can build without the body wandering off — players see the world but get a polite refusal if they try a `/command we`. The palette overlay reuses `GET /api/world/_/tilesets` to enumerate uploaded TSX tilesets, lets the admin pick a tile, click world to paint, right-click to erase, drag to brush a stroke, and pick the active layer + brush mode (paint/erase) without leaving the realm. Multi-tab safety: a second connection for the same character bumps the first one with close code 4000 and a "replaced" reason.
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
- Email + password registration with validation and bcrypt hashing
- Login, logout, "who am I" endpoint
- Session cookies persisted in Postgres
- Character forge: random race (5 races), gender, fixed 500 mana cap; admin path skips race/gender per §3.8
- Permadeath flow: `POST /api/characters/me/die` marks the row dead and frees the name
- Admin sprite slicing pipeline (per-frame rects, fps, scale) + animated character-sheet portrait
- Tileset uploader (TSX + image, /maps.html) and in-game live world painter (`/command we`)
- **Realtime multiplayer slice** — `/ws/realm` WebSocket, 20 Hz authoritative tick, presence + shard-wide chat, server-authoritative movement (4.5 t/s walk, ×1.8 sprint), camera-follow render, position persisted across logout
- **In-realm HUD** — Majestic medieval-fantasy theme (gold double-bezel borders, parchment textures, Cinzel display, ornate corner flourishes). Five non-overlapping zones laid out around the canvas:
  - **Crown bar** (top-left): `‹ Leave` button + Realm/Mode badge (`Server 0 · Firstlight` with Architect/Player Mode subtitle) + souls-online counter + edit-flag pill (visible only while a `/command we` editor mode is active).
  - **Atlas** (top-right): 200×200 mini-map (±100 tiles, painted ground occupancy + race-tinted dots + facing tick + glowing self-pip), expand-to-fullscreen button, and a Pulse / coords foot strip below.
  - **Codex right rail** (under the Atlas): Char (C), Inventory (I), Spellbook (K), Quests (J), Map (M), Help (H), Settings (⚙) buttons. Each opens a corresponding modal; keys also work as global shortcuts when not typing.
  - **Voices chat** (mid-left): collapsible chat panel with header fold and `T to speak` input.
  - **HUD plate** (bottom-center, DOTA-2 style): portrait+identity wing | HP/MP/ST bars + numeric readouts | 10-slot hotbar (racial weapon in slot 1, locked spell slots 2–0) | XP / Control / Resistance / Cast-speed stats wing. Caps to viewport so it never overflows on small screens.
  - **Channeled Output meter** (centered above the plate, wheel-driven 1–100%, 5%/notch).
  - **Modals**: Map (zoom-to-canvas painted minimap of ±160 tiles, soul list, position readout), Settings (zoom slider + audio sliders + leave-realm button), Vessel (mirrors the character sheet — portrait, race, level, bars, stats, weapon), Inventory (24-cell parchment grid + equip slots + carried text + hint), Spellbook (Mana Bolt placeholder + locked tome), Quests (parchment list + journal hint), Help (full keybinds + slash-command reference). All modals dismiss via veil click, Esc, or ✕. Build-mode (`/command we`) hides the plate / Atlas / Output meter so the admin sees a clean canvas; chat + Codex + Crown stay.
  - **Dev hook**: appending `?hud-demo=1` to the URL boots straight into the realm HUD with a synthetic Architect vessel — for fast layout sanity-checks without going through login.
- **In-realm avatars** — Admin renders with their real spritesheet (per-direction idle + walk frames, per-frame slice metadata respected), with foot-anchored draw position and a soft elliptical shadow. Players currently fall through to a race-tinted circle. Movement is server-authoritative at 20Hz but each avatar is exponentially smoothed toward its target every render frame (~16/s catch-up), so 60fps motion is silky. Camera follows the smoothed self-position so it never jitters.
- **Speech bubbles** — Chat lines float for 4.5s as a parchment bubble above the speaker's head (everywhere in the shard, including their own client), with a soft fade-out in the last 600ms.
- **Chat UX** — `T` opens chat from anywhere; submitting the input auto-blurs so movement keys take over again until `T` is pressed. Click the chat header to fold the panel down to just its title bar; clicking again expands it back (history is preserved).
- **Build mode UX** — Opening the in-game tile editor (`/command we` etc.) hides the player-facing HUD (stat panel, hotbar, output meter, presence, mini-map) so the admin sees the world cleanly; only chat + the editor flag + the palette remain. Wheel zooms the camera in editor mode and drives Output in player mode.
- **Coordinates readout** — The mini-map foot now shows the player's own integer tile each frame (was previously the mouse hover, which only made sense in the editor).
- **Server-0 admin gate** — Until `/command create_server` + `/command world_publish` ship, only admins may step into the only existing shard. The WS upgrade rejects non-admins with `403 No published server yet`, the character-sheet "Enter the Realm" button is disabled for players, and the player-side note explains they're waiting for a player shard to open.

- **Combat slice (§5/§7)** — Server is sole authority on damage and cooldowns; clients only send intent and render the broadcast.
  - **Vitals** — HP / Mana / Stamina each have a cap (`max_hp` / `mana_cap` / `stamina_cap` columns) and stream live in every 20 Hz state packet, so the HUD bars are never out-of-sync. Welcome packet seeds the full stat block (control, efficiency, cast_speed, resistance, level, xp, weapon).
  - **Stamina** — Sprint+move drains 15.7 / sec; stationary or walking, stamina regens 12 / sec back up to cap.
  - **Mana** — Regens 8 × efficiency / sec, always.
  - **HP** — Regens 1.5 / sec **only** if no damage taken in the last 5 s (out-of-combat lockout).
  - **Slot 1 (basic attack)** — Press `1` to swing the racial weapon (Free Hand for admins). Server does a rectangular front-arc hit-test (per-weapon `reach` × `arc`), applies `weapon.dmg + control × 0.5` minus `target.resistance / 200`, persists HP, broadcasts `swing` (gold 220 ms arc) + `hit` (red `-N` damage popup, 900 ms float). Cooldown = `weapon.cd` ms; insufficient stamina returns `attack_denied{reason:"stamina"}` → chat err.
  - **Slot 2 (Mana Bolt)** — Press `2` to cast the first weave. Server does a long, narrow forward-lane hit-test (8 tiles × ±0.55), picks first target only (lance-line). Damage = `(18 + control × 0.6) × output`; mana cost = `30 × output` rounded, both scaled by the channeled Output dial (5–100%, mouse-wheel). Cooldown = `900 / cast_speed` ms (min 150). Broadcasts a `bolt` event (animated arcane beam: white-hot core inside cyan-blue glow; width and tip flare scale with output). Insufficient mana → `cast_denied{reason:"mana"}`.
  - **Death** — When HP ≤ 0, `slay()` broadcasts `slain{by, name}`, persists `died_at`, and (after a 1.5 s "YOU HAVE FALLEN" parchment veil) kicks the loser's socket with WS code 4001 so they're bounced back to the character forge per the existing permadeath flow.
  - **Spellbook modal** now lists Mana Bolt as available (other spells stay locked).

## Next up (per design doc)
- Wire the Map Workshop's parsed TMX into a tile-aware collision pass so painted walls actually block movement
- Replace the placeholder circle-avatars with the per-race idle/walk sprite sheets once they exist (uses the same slice pipeline as the portrait)
- Brief red avatar flash on hit (state.fx.hits is already populated, just needs a draw-time tint)
- More spells (Ward of the Veil, Ember Step, Soulbind) following the same `tryCast` pattern
- Monsters / NPCs to give players something to swing at outside of PvP
