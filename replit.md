# Freeform Mana

Sharded sandbox MMORPG (top-down, browser-based, permadeath). This repo is the
working implementation. Core loop: movement, mana bolt combat, and mana shield are live.

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
- `server/realtime.js` — Realtime / multiplayer layer. WebSocket server at `/ws/realm` that authenticates the upgrade by reading the express-session cookie (`fm.sid`), unsigning it with the same `SESSION_SECRET`, and looking the session up in the `session` table. **Any logged-in account with a living character can connect** to the shared `default` shard — admins build, players roam and fight. (Per-server isolation lands when `/command create_server` + `/command world_publish` ship.) Runs a 20 Hz authoritative tick: each player's last `input` packet (`{dx,dy,sprint,facing}`) is integrated into x/y at 4.5 tiles/s walk (×1.8 sprint) with diagonals normalized, then the full shard snapshot is broadcast as `{type:"state", t, players:[…]}`. **No weapon system** — §7.1 removes weapons; all combat is spell-only. **Spell slots 1–6**: slot 1 = Mana Shield (aura/protective), slot 2 = Mana Bolt (projectile lane-hit). Both are server-resolved: Mana Shield broadcasts `{type:"shield", id, hp, maxHp, output}` and stores `caster.shield` for sustain tick; Mana Bolt broadcasts `{type:"bolt", …}` + `{type:"hit", …}`. Client→server messages: `input`, `chat`, `cast`, `ping`. Server→client: `welcome`, `join`, `leave`, `state`, `chat`, `bolt`, `hit`, `swing`, `shield`, `pong`, `goodbye`, `cast_denied`. **Spell math follows design doc §14.1, §3.5, §4.1 + §4.2 exactly** — no cooldown (mana is the only gate); cost = `BaseCost × (Output%/100) × (1 - min(0.75, Efficiency%/100))`; damage = `baseUnit × Output × SpellBasePower × (1 + 0.1 × (SpellLv - 1)) × Min(10, 1 + log10(ManaCap/500))`. Mana Bolt: BaseCost 50, baseUnit 50, power 1.0, lv 1 — at 100% Output a 500-cap starter deals ~55 dmg (≈4 hits to kill 200 HP), a 5000-cap admin deals ~110 (≈2 hits). Position survives logout via `pos_x`, `pos_y`, `shard`, `facing` columns on `characters` — loaded on connect, lazy-saved every 15 s and on disconnect.
- `server/db.js` — Postgres connection pool
- `server/schema.js` — Idempotent bootstrap of `users`, `characters`, `session` tables. Runs on every boot.
- `server/store.js` — Tiny file-backed JSON store. Atomic writes (temp file + rename) into `data/`. Used by sprite slices today; reusable for any small persisted blob.
- `server/auth.js` — `/api/auth/register`, `/login`, `/logout`, `/me`
- `server/characters.js` — `/api/characters` (forge, /me, /me/die)
- `server/races.js` — race definitions and stat modifiers (Human, Orc, Elf, Crystalline, Voidborn)
- `server/admin.js` — Admin character stat block per design doc §3.8 (no race/class)
- `server/seed.js` — Idempotent admin user seed, runs on every boot. Configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars.
- `server/sprites.js` — Admin-only. **Multi-character.** `/api/sprites/characters` walks `client/assets/sprites/` and lists every subfolder that contains a `base/` directory (currently `admin` + `osnica`); each entry includes `id`, display `label`, `base` URL, and a `hasSheets` flag. `/api/sprites/manifest?character=<id>` (defaults to `admin`) walks that character's `base/` folder and reports every sheet grouped by animation+weapon. `/api/sprites/slices` (GET) and `/api/sprites/slice` (PUT/DELETE) read/write **`data/sprite_slices.json`** keyed by full sprite URL, so per-character slices coexist without collision. `/api/sprites/copy-slices` (POST `{from, to}`) copies every saved slice from one character onto the matching sheets of another (skips sheets that don't exist on disk). Saved record fields: `frames`, `frameW`, `frameH`, `offsetX`, `offsetY`, `gapX`, `perFrame`, `frameRects`, `fps` (1-60), `scale` (1-8).
- `server/maps.js` — Admin-only **tileset uploader** at `/api/maps`. Accepts only `.tsx` + `.png/.jpg` (no `.tmx` — actual maps are built in-world via `/command we` and `/command server_edit`). Files saved to `data/maps/<name>/`. Endpoints: `GET /api/maps`, `POST /api/maps/upload` (multipart), `GET /api/maps/file/:name/:file`, `DELETE /api/maps/:name`, `DELETE /api/maps/:name/file/:file`. ≤32 MB per file, ≤64 files per upload, strict filename whitelist, path-traversal blocked.
- `client/sprites.html` / `sprites.js` / `sprites.css` — Admin-only sandbox at `/sprites.html`. **No autosave — explicit Save changes button.** Every edit (frames/W/H/X/Y/G, FPS, scale, per-frame toggle, drag-to-crop on the raw sheet, Apply-all to other directions) just marks the affected card(s) dirty in memory; the gold-ringed "Save changes (N)" button at the top-right of the toolbar shows the unsaved count and writes everything to disk in one batch when clicked (Ctrl/Cmd-S also flushes). A `beforeunload` guard warns if you try to leave with unsaved edits. Each unsaved card shows a sticky `● unsaved` pip on its card body. Reset is the only thing that still hits the server immediately (it's a destructive explicit action). **Character dropdown** at the top lets the admin flip between `admin`, `osnica`, and any future character folder; switching reloads the manifest for that character without leaving the page. **"Apply settings to other character…"** POSTs to `/api/sprites/copy-slices` to mirror every saved slice onto another character's matching sheets. **Per-frame mode** (per-card opt-in): each frame stores its own `{x,y,w,h}` rect — for sheets where frames have different sizes/positions. FPS + scale are per-card and persisted; the global FPS/Scale inputs always reflect the *active* card and edit only that card. Saved data round-trips through `data/sprite_slices.json`.
- `client/maps.html` / `maps.js` / `maps.css` — Admin-only **Tileset Library** at `/maps.html`. Upload form (name + multi-file picker), stored-tilesets list with per-file types and delete buttons. Built-in TSX viewer parses the tileset, loads its image, and renders the tile grid with togglable grid lines and tile-id labels. Hover any tile to see its local id (and source rect); click a tile to copy its id to the clipboard for pasting into `/command we` workflows.
- `server/world.js` — Admin-only **world-state API** at `/api/world`. Per-shard sparse tile storage on disk at `data/world/<shard>.json`. Endpoints: `GET /:shard` (read full shard), `POST /:shard/paint` (batch paint/erase, max 1024 tiles per call), `POST /:shard/clear-layer`, `GET /_/tilesets` (parsed TSX summaries + image URLs the in-game palette consumes). Tile references are `"<tilesetName>:<localTileId>"` strings; every paint validates the tileset exists in `data/maps/` and the id is in range against a small in-memory TSX cache invalidated by mtime. Coords capped at ±2²⁰. Default layers `ground` + `decor` are auto-created. **Every shard starts as plain grass ground** — `defaultGround: "grass:0"` is written into the JSON on creation, and the in-game renderer fills any unset tile with this reference so a fresh world is walkable from the first frame. `ensureDefaultShard()` runs on boot so `data/world/default.json` always exists. Shard JSON shape: `{ shard, tileSize, defaultGround, createdAt, updatedAt, layers: [{ name, tiles: { "x,y": "tileset:id" } }] }`.
- **World painting is in-game, live.** There is intentionally no `/world.html` admin page — world editing happens inside the running game via `/command we`, `/command world_edit`, and `/command server_edit` (typed into the in-realm chat rail). Each click is a live write straight to `/api/world/default/paint`; there are no draft saves. The in-game palette is screen-contained — the realm view itself is `position: fixed`, the page never scrolls, and the only scrollable region is the palette body.
- `client/realm.html` is hosted inside `index.html` (section `#realm`). `client/realm.js` / `client/realm.css` own the in-realm view: a full-viewport top-down canvas. **Backdrop is the deep void of space** — a 256×256 pre-rendered starfield (radial gradient + three densities of stars + faint nebula blooms) tiled across the viewport with a slow 30% parallax so the world feels big. **Spells aim at the cursor, not the player's facing** — `state.mouse.worldX/worldY` is tracked in float tile-coords on every mousemove; on cast (`sendCast`) the `aimFacingFromCursor()` helper picks the dominant cardinal axis from the player→cursor delta, snaps `state.me.facing` locally for instant visual rotation, and sends that facing in the `cast` packet so the server's lance hit-test fires in the clicked direction even if you were running left a moment ago. Painted tiles from `data/world/default.json` are layered on top of the void, then every player on the shard (self + others) as race-tinted circles with name plates and a facing tick (admins draw with a gold ring, self with a thin gold ring). On `enter()` the realm shows a **loading veil with progress bar** while it (re)fetches the world from disk — `loadWorld()` runs on **every** entry, not just first boot, so edits made in another session always appear immediately. Then it opens a `WebSocket` to `/ws/realm` (no token — the session cookie travels with the upgrade) and ingests `welcome` / `join` / `leave` / `state` / `chat` messages. WASD/arrow keys send `input` packets to the server (~20 Hz coalesced) and the camera follows the **server-authoritative** position (smooth fractional-tile scroll); shift = sprint. Mouse wheel zooms 1×–6×. The chat rail broadcasts plain speech through the socket. Slash commands: `/help` lists them, `/leave` exits, `/command we` (and `/we`, plus the `world_edit` / `server_edit` aliases) toggles the admin palette overlay. While the editor is open, WASD reverts to free-pan. The palette overlay enumerates uploaded TSX tilesets, lets the admin pick a tile, click world to paint, right-click to erase, drag to brush a stroke, pick the active layer + brush mode, and now run a **viewport Fill** with four modes: `empty` (only unset tiles), `edges` (visible border ring), `same` (replace every tile matching the cursor/center tile), `all` (overwrite everything visible). Fill batches writes server-side in chunks of 400. Multi-tab safety: a second connection bumps the first with close code 4000.
- `server/world.js` write endpoints (`POST /:shard/paint`, `POST /:shard/clear-layer`) are admin-gated with an internal `requireAdmin` middleware, while `GET /:shard` and `GET /_/tilesets` only require an authenticated session — that way every player's client can render the live world while only admins can change it.
- `client/app.js` / `index.html` / `styles.css` — login, forge, and the character sheet. The character sheet now includes an **animated portrait canvas** (`#portrait-canvas`) above the name. On `showCharacter()` it picks the right idle-down sheet for the vessel (admin → `admin-idleDown-spritesheet.png`; players have no art yet → placeholder), fetches `/api/sprites/slices`, applies the saved frames/frameRects/perFrame/fps/scale, and runs a `requestAnimationFrame` loop centering each frame in the canvas (so per-frame rects of varying size don't jitter). Slices are cached for the session and the loop is torn down on logout. Falls back to a single-strip inference if no slice exists for the URL.
- `client/assets/sprites/<character>/base/` — sprite sheets for each character, organized by animation (idle/walk/attack/cast/death) and weapon variant (no-weapon + weapon overlays). Death sheets are always a single non-directional row. `admin/` is fully populated; `osnica/` has the directory scaffolding ready for sheets to be dropped in (filename convention is `osnica[-<weapon>]-<animKey><Direction>-spritesheet.png`).
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

## v27 polish (apr-2026)
- **Sprite sandbox `Mirror across facings`** — toolbar button on `/sprites.html`
  copies the active card's slice settings (frames/W/H/X/Y/G/perFrame/fps/scale)
  to its opposing direction (Right↔Left, Down↔Up) for every weapon variant of
  the active animation. Marks all touched cards dirty for the explicit Save.
- **Single-sheet (non-directional) sprites** — `server/sprites.js` parser and
  `client/sprites.js` rebuild now accept sheets that have no direction suffix
  (e.g. `osnica-idle-spritesheet.png`). They surface in the manifest under the
  `all` direction label. Used by characters that ship as one sheet per anim.
- **Hotbar 1+5+F layout** — slot 1 is the basic-attack racial weapon (always
  equipped on entry, paints purple pulse via `paintEquipHighlight`); slots 2-6
  are the five spell quick-slots; the F-key opens a 15-slot radial
  `#spell-wheel` overlay anchored to the plate. Empty wheel slots toast a
  "bind from Spellbook" hint; bound spells will wire in once the Spellbook
  redesign lands.
- **Plate centering** — `repositionHudPlate()` (ResizeObserver on chat panel
  and codex rail) keeps the bottom plate horizontally centered between the
  Voices chat (left) and the codex rail (right) regardless of which is folded.
- **Fellowship dropdown** — `#fellow-btn` on the codex rail toggles a
  `#fellow-menu` listing Guild / Party / Friends entries; placeholder
  modals open from each so the wiring matches the doc before the systems exist.
- **Chat hint visibility** — `body:not(.is-architect) .chat-hint { display:none }`
  hides the "T to speak" pill for non-admin players. The realm enter() sets
  the `is-architect` class on `<body>` only when `state.role === "admin"`.
- **Tutorial spam removed** — chat no longer auto-prints the welcome / tip
  bundle; only the admin command-hint line is pushed (and only for admins).
- **Tome modal as encyclopedia** — `#modal-help` is now an 8-section reference
  (movement, combat, casting, world tools, social, vessel, philosophy, version
  notes). All admin-only `/command …` cheatsheet content was excised so the
  Tome reads as in-fiction lore for every player.
- **Casting visuals** — `markCasting()` flips `state.castEntry[id]` for ~280 ms
  after every cast; `getSpriteForPlayer` then prefers the cast spritesheet for
  the snapped cardinal facing (`aimFacingFromCursor()`). Falls back to idle if
  the cast sheet is missing so non-admin avatars don't disappear. Admin uses
  per-direction sheets in `cast-spritesheets/no-weapon/`; OS Nica uses the
  single-sheet `cast` art via the new `all`-direction parser.
- **Improved combat VFX** —
  - **Mana Bolt**: launch flash at the caster origin (first 18% of flight) +
    layered violet/gold core with a comet trail; impact adds a brighter
    multi-stop burst, an outward shock-ring, and a one-shot screen shake
    whose amplitude scales with Output (`pushShake(2.4 + out × 7.5, 220 ms)`).
  - **Basic attack**: arc is drawn as a wide soft halo behind a bright thin
    stroke; six seeded sparks fan out along the swing tip and decay with the
    arc.  Reads as a real blade glint instead of a flat curve.
  - **Charge aura**: while right-mouse is held with a spell equipped,
    `drawChargeAura()` paints a violet/blue ground glow under the caster plus
    six orbiting gold sparks; brightness scales with Output.
- **Screen shake plumbing** — `consumeShake / pushShake / tickShake` and
  `state.fx.shake = {x,y,amp,until}`; `render()` now wraps in
  `ctx.save()` + `translate(shake.x, shake.y)` and ends with
  `ctx.restore() + tickShake()`.

## Recent overhaul (apr-2026)
- **Casting flow per design doc §14/§18.** Hotkey `2` *equips* Mana Bolt — it
  no longer auto-fires. Left-click is a fixed-output (20%) tap-cast; right-click
  charges to the current Channeled Output dial and releases on mouseup, with
  the meter pulsing gold while held. The cursor gives a 360° aim vector that
  the server uses for the lane direction; the sprite still snaps to four
  cardinals so existing art works untouched. `realm.js#sendCast` adds
  `aimX/aimY` to the `cast` packet and `server/realtime.js#tryCast` prefers
  the unit-vector when present.
- **Mana Bolt projectile** is now a *traveling* violet/gold ball with a fading
  comet trail — not a beam. Width and brightness scale with Output. See
  `realm.js#drawBolts`.
- **Backdrop:** void darker (`#070512` → `#020106`) to match login. Two slow
  drifting aurora blobs (violet + gold) plus 64 seeded drift-particles render
  every frame for the "magical realism" feel without painting over ground.
- **Name plate** shrunk to 10 px Cinzel and re-anchored at `cy − tilePx*1.7 − 14`
  so it banners *over* the player's head instead of dominating the canvas.
- **Output meter** is positioned with `getBoundingClientRect` of `.plate-hotbar`
  so it always sits 10 px above the slots regardless of viewport / plate height.
- **Hotbar slot 2** gets `data-equipped="true"` while Mana Bolt is drawn — the
  CSS gives it the equipped purple pulse.
- **Fill modes** `world` and `world-edges` added — they expand the brush to a
  bbox of every painted tile across all layers (padded by 8, capped at ±150).
- **Slash commands** cover §27: `/help` opens the help modal, `/tp x y`,
  `/goto name`, `/summon name`, `/home/spawn`, `/leave`, plus a generic
  forwarder so any verb is sent to the server. `/command create_spell` opens
  the new 11-step inscribe wizard (`#modal-spellwiz`) — Identity → School →
  Form → Targeting → Range → Lane → Cost → Effects → Visuals → Sound →
  Review. The wizard emits the spell as a JSON blob into chat for preview
  (server persistence lands in a follow-up).

## Next up (per design doc)
- Wire the Map Workshop's parsed TMX into a tile-aware collision pass so painted walls actually block movement
- Replace the placeholder circle-avatars with the per-race idle/walk sprite sheets once they exist (uses the same slice pipeline as the portrait)
- Brief red avatar flash on hit (state.fx.hits is already populated, just needs a draw-time tint)
- More spells (Ward of the Veil, Ember Step, Soulbind) following the same `tryCast` pattern
- Monsters / NPCs to give players something to swing at outside of PvP
