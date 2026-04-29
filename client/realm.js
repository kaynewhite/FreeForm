/* ---- in-game realm view ----
   Renders the live world (shard "default") to a canvas, hosts the chat /
   command rail, and drives the in-game tile editor that opens via the
   admin slash commands /command we, /command world_edit, /command
   server_edit. Painting is wired straight to /api/world/<shard>/paint —
   each click is a live edit, not a draft. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const SHARD = "default";

  // Slash-command aliases that all open the in-game tile editor. Order
  // matters only for which label we show in the HUD.
  const EDITOR_COMMANDS = {
    "/command we":          "we",
    "/command world_edit":  "world_edit",
    "/command server_edit": "server_edit",
    // Bare shortcuts so admins can save keystrokes once they've learned them.
    "/we":          "we",
    "/world_edit":  "world_edit",
    "/server_edit": "server_edit",
  };

  const realmEl     = $("#realm");
  const canvas      = $("#realm-canvas");
  const ctx         = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const coordsEl    = $("#realm-coords");
  const editFlag    = $("#realm-edit-flag");
  const editModeEl  = $("#realm-edit-mode");
  const leaveBtn    = $("#leave-realm-btn");

  const chatLog     = $("#chat-log");
  const chatForm    = $("#chat-form");
  const chatInput   = $("#chat-input");

  // ---- HUD widgets ----
  const rbServerName = $("#rb-server-name");
  const rbMode       = $("#rb-mode");
  const presenceCt   = $("#presence-count");
  const minimap      = $("#minimap-canvas");
  const minimapCtx   = minimap.getContext("2d");
  minimapCtx.imageSmoothingEnabled = false;

  const statsName    = $("#stats-name");
  const statsRace    = $("#stats-race");
  const statsLevel   = $("#stats-level-num");
  const barHpFill    = $("#bar-hp-fill");
  const barMpFill    = $("#bar-mp-fill");
  const barStFill    = $("#bar-st-fill");
  const barHpNum     = $("#bar-hp-num");
  const barMpNum     = $("#bar-mp-num");
  const barStNum     = $("#bar-st-num");
  const statsXp      = $("#stats-xp");
  const statsCtrl    = $("#stats-ctrl");
  const statsRes     = $("#stats-res");

  const hbWeaponIcon = $("#hb-weapon-icon");
  const hbWeaponName = $("#hb-weapon-name");
  const statsCast    = $("#stats-cast");

  // HUD portrait (in the bottom-center plate)
  const hudPortrait      = $("#hud-portrait-canvas");
  const hudPortraitCtx   = hudPortrait.getContext("2d");
  hudPortraitCtx.imageSmoothingEnabled = false;
  const hudPortraitEmpty = $("#hud-portrait-empty");

  // Output meter (scroll wheel adjusts in player mode; locked in editor mode).
  const outputBox    = $("#realm-output");
  const outFill      = $("#out-fill");
  const outNum       = $("#out-num");

  // Collapsible chat
  const chatPanel    = $("#realm-chat");
  const chatHead     = $("#chat-head");
  const chatBody     = $("#chat-body");
  const chatHint     = $("#chat-hint");
  const chatCollapseGlyph = $("#chat-collapse");

  // Modals (Atlas, Settings, Vessel, Satchel, Spellbook, Quests, Help)
  const modalVeil   = $("#modal-veil");
  const modals      = {
    map:        $("#modal-map"),
    settings:   $("#modal-settings"),
    character:  $("#modal-character"),
    inventory:  $("#modal-inventory"),
    spellbook:  $("#modal-spellbook"),
    quests:     $("#modal-quests"),
    help:       $("#modal-help"),
  };
  const codexButtons = document.querySelectorAll(".codex-btn[data-modal]");
  const atlasExpand  = $("#atlas-expand-btn");

  // Map-modal canvas + stat readouts
  const mapModalCanvas = $("#map-modal-canvas");
  const mapModalCtx    = mapModalCanvas.getContext("2d");
  mapModalCtx.imageSmoothingEnabled = false;
  const mapPos    = $("#map-pos");
  const mapSouls  = $("#map-souls");

  // Vessel-modal portrait + stat readouts
  const charModalPortrait    = $("#char-modal-portrait");
  const charModalPortraitCtx = charModalPortrait.getContext("2d");
  charModalPortraitCtx.imageSmoothingEnabled = false;
  const charModalRefs = {
    name:   $("#char-modal-name"),
    race:   $("#char-modal-race"),
    level:  $("#char-modal-level"),
    hp:     $("#char-modal-hp"),
    mp:     $("#char-modal-mp"),
    st:     $("#char-modal-st"),
    xp:     $("#char-modal-xp"),
    ctrl:   $("#char-modal-ctrl"),
    cast:   $("#char-modal-cast"),
    eff:    $("#char-modal-eff"),
    res:    $("#char-modal-res"),
    weapon: $("#char-modal-weapon"),
  };

  // Settings inputs (saved in localStorage so preferences persist)
  const setZoom        = $("#set-zoom");
  const setZoomNum     = $("#set-zoom-num");
  const setVol         = $("#set-vol");
  const setVolNum      = $("#set-vol-num");
  const setShowFps     = $("#set-show-fps");
  const setPixelPerf   = $("#set-pixel-perfect");
  const setShowGrid    = $("#set-show-grid");
  const setShowCoords  = $("#set-show-coords");
  const setMuteAmb     = $("#set-mute-amb");
  const setLeaveBtn    = $("#set-leave-btn");

  // Inventory placeholder grid (24 cells)
  (() => {
    const inv = $("#inv-grid");
    if (inv && !inv.childElementCount) {
      for (let i = 0; i < 24; i++) {
        const cell = document.createElement("div");
        cell.className = "inv-cell is-locked";
        inv.appendChild(cell);
      }
    }
  })();

  // Per-race weapon glyph for the hotbar slot icon. Vague enough to work in
  // any system font — real per-weapon art lands when we have spell sheets.
  const WEAPON_ICON = {
    Dagger: "†",
    Club: "🜨",
    Bow: ")",
    Slingshot: "Y",
    Katana: "⚔",
    "Free Hand": "✦",
  };

  const paletteEl   = $("#realm-palette");
  const paletteBody = $("#palette-body");
  const paletteMode = $("#palette-mode");
  const paletteLayer= $("#palette-layer");
  const paletteBrush= $("#palette-brush");
  const paletteSel  = $("#palette-selected-readout");
  const paletteClose= $("#palette-close-btn");
  const paletteClear= $("#palette-clear-btn");

  // ---- API helper ----
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const msg = (body && body.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body;
  }

  // ---- sprite registry ----
  // Loads admin idle/walk sheets for all four facings, plus their slice
  // metadata, so the in-realm avatar animates with real art instead of a
  // placeholder circle. Players currently have no sheets uploaded — they
  // will fall through to the circle renderer.
  const SpriteSet = {
    loaded: false,
    slices: {},
    sheets: { admin: { idle: {}, walk: {} } }, // sheets[role][anim][facing] = { img, slice }
  };
  function _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + url));
      img.src = url;
    });
  }
  function _normalizeSlice(raw, img) {
    if (!raw) return {
      frames: 1, frameW: img.naturalWidth, frameH: img.naturalHeight,
      offsetX: 0, offsetY: 0, gapX: 0,
      perFrame: false, frameRects: null, fps: 8,
    };
    return {
      frames: raw.frames || 1,
      frameW: raw.frameW || img.naturalWidth,
      frameH: raw.frameH || img.naturalHeight,
      offsetX: raw.offsetX || 0,
      offsetY: raw.offsetY || 0,
      gapX: raw.gapX || 0,
      perFrame: !!raw.perFrame,
      frameRects: Array.isArray(raw.frameRects) ? raw.frameRects : null,
      fps: Math.max(1, Math.min(60, raw.fps || 8)),
    };
  }
  async function loadAdminSprites() {
    if (SpriteSet.loaded) return;
    try { SpriteSet.slices = await api("/api/sprites/slices") || {}; }
    catch { SpriteSet.slices = {}; }
    const ROOT = "/assets/sprites/admin/base";
    const ANIMS = {
      idle: `${ROOT}/idle-spritesheets/no-weapon/admin-idle`,
      walk: `${ROOT}/walking-spritesheets/no-weapon/admin-walk`,
    };
    const DIRS = ["Up", "Down", "Left", "Right"];
    await Promise.all(Object.entries(ANIMS).flatMap(([anim, prefix]) =>
      DIRS.map(async (D) => {
        const url = `${prefix}${D}-spritesheet.png`;
        try {
          const img = await _loadImage(url);
          SpriteSet.sheets.admin[anim][D.toLowerCase()] = {
            img,
            slice: _normalizeSlice(SpriteSet.slices[url], img),
            url,
          };
        } catch { /* skip missing files silently */ }
      })
    ));
    SpriteSet.loaded = true;
  }
  function getSpriteForPlayer(p, anim) {
    if (!p.isAdmin) return null;
    const set = SpriteSet.sheets.admin[anim] || SpriteSet.sheets.admin.idle;
    return set[p.facing] || set.down || null;
  }

  // ---- per-player render record (smooth-lerped visual position) ----
  // The server pushes authoritative state at 20Hz. We keep a separate
  // visual record per player and exponentially smooth it toward the target
  // every frame. That kills the visible jitter on the 50ms tick boundary
  // without needing real client-side prediction.
  function ensureRenderRec(p) {
    let rec = state.renderPlayers.get(p.id);
    if (!rec) {
      rec = {
        id: p.id, name: p.name, isAdmin: !!p.isAdmin, race: p.race,
        weapon: p.weapon || null,
        x: p.x, y: p.y,            // visual (lerped) position
        tx: p.x, ty: p.y,           // authoritative target
        facing: p.facing || "down",
        anim: p.anim || "idle",
        animTime: 0,                // accumulator for sprite frame timing
        bubble: null,               // { text, until }
      };
      state.renderPlayers.set(p.id, rec);
      return rec;
    }
    rec.name = p.name ?? rec.name;
    rec.isAdmin = !!(p.isAdmin ?? rec.isAdmin);
    rec.race = p.race ?? rec.race;
    rec.weapon = p.weapon ?? rec.weapon;
    rec.tx = p.x;
    rec.ty = p.y;
    rec.facing = p.facing || rec.facing;
    rec.anim = p.anim || rec.anim;
    return rec;
  }
  function lerpRenderPositions(dt) {
    // Strong smoothing factor — fast catch-up so input feels responsive,
    // but smooth enough to hide the 50ms ticks. About 1 tile of slop max.
    const k = 1 - Math.exp(-dt * 16);
    for (const rec of state.renderPlayers.values()) {
      rec.x += (rec.tx - rec.x) * k;
      rec.y += (rec.ty - rec.y) * k;
      // Snap when we're effectively there to avoid endless float drift.
      if (Math.abs(rec.tx - rec.x) < 0.005) rec.x = rec.tx;
      if (Math.abs(rec.ty - rec.y) < 0.005) rec.y = rec.ty;
      rec.animTime += dt;
    }
  }
  function attachBubble(playerId, text) {
    const rec = state.renderPlayers.get(playerId);
    if (!rec) return;
    rec.bubble = { text: text.slice(0, 120), until: performance.now() + 4500 };
  }

  // ---- state ----
  const state = {
    role: "player",
    booted: false,
    world: null,                // { layers, tileSize, defaultGround, ... }
    tileSize: 16,
    zoom: 2,                    // multiplier
    cameraX: -16, cameraY: -10, // top-left of the canvas, in world tile coords (floats)
    keys: new Set(),            // currently held keys for movement / panning
    tilesets: new Map(),        // name -> { meta, image }
    editor: { open: false, mode: "we", selected: null, brush: "paint", layer: "ground" },
    mouse: { x: 0, y: 0, tileX: 0, tileY: 0, leftDown: false, rightDown: false },

    // ---- character / vessel (snapshot from /api/characters/me at enter) ----
    // The base stat block (max_hp, mana_cap, stamina_cap, control, etc.)
    // comes from /api/characters/me on enter, but the LIVE vitals
    // (hp/mana/stamina) are server-authoritative — every welcome + state
    // packet overwrites state.cur with the truth from the tick loop.
    character: null,
    cur: { hp: 0, mp: 0, st: 0 },

    // ---- combat FX (transient, render-only) -----------------------------
    // swings: { id, x, y, facing, reach, arc, t0, weapon }  — fades over 220ms
    // pops:   { id, x, y, dmg, t0, dy }                     — floating numbers
    // hits:   targetId -> tFlashUntil                        — red avatar pulse
    fx: { swings: [], pops: [], hits: new Map(), bolts: [] },
    deadOverlay: null,           // { until, by } — death modal countdown

    // ---- realtime / multiplayer ----
    me: null,                   // { id, name, x, y, facing, isAdmin, race } — authoritative latest
    others: new Map(),          // id -> { id, name, x, y, facing, anim, isAdmin, race }
    // Visual records, one per player including self. We lerp these toward the
    // authoritative position every frame so 60fps render smooths out the 20Hz
    // server tick. Speech bubbles also live here so they follow the avatar.
    renderPlayers: new Map(),   // id -> { name, isAdmin, race, weapon, x, y, facing, anim, bubble }
    ws: null,
    wsReady: false,
    lastInputSent: { dx: 0, dy: 0, sprint: false, facing: "down", t: 0 },
    inputDirty: false,
    serverTickHz: 20,
    presence: 1,

    // Output meter (channeling power for casting). Scroll wheel changes this
    // in player mode; ignored in editor mode (where wheel zooms the camera).
    output: 100,

    // Chat panel collapse state. Persisted across re-enters.
    chatCollapsed: false,
  };

  // ---- chat ----
  function chat(line, kind = "") {
    const div = document.createElement("div");
    div.className = "chat-line" + (kind ? " is-" + kind : "");
    div.textContent = line;
    chatLog.appendChild(div);
    while (chatLog.childElementCount > 80) chatLog.firstElementChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // Slash-command parser. Returns true if the input was handled as a command
  // (so the chat line shouldn't be echoed as plain speech).
  function tryCommand(raw) {
    const text = raw.trim();
    if (!text.startsWith("/")) return false;
    const lower = text.toLowerCase();

    if (lower === "/help" || lower === "/?") {
      chat("Commands: /command we, /command world_edit, /command server_edit (admin), /leave", "cmd");
      return true;
    }
    if (lower === "/leave" || lower === "/exit" || lower === "/quit") {
      leave();
      return true;
    }

    // Editor toggle — pick the longest matching alias so "/command we" wins
    // over a hypothetical "/we" prefix match.
    const aliases = Object.keys(EDITOR_COMMANDS).sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      if (lower === alias) {
        if (state.role !== "admin") {
          chat("That command belongs to the Architect alone.", "err");
          return true;
        }
        const mode = EDITOR_COMMANDS[alias];
        toggleEditor(mode);
        return true;
      }
    }

    chat(`Unknown command: ${text}`, "err");
    return true;
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = chatInput.value;
    chatInput.value = "";
    // Auto-blur so movement keys (WASD/T) work again until the player
    // explicitly re-opens chat with T.
    chatInput.blur();
    if (!raw.trim()) return;
    if (tryCommand(raw)) return;
    // Plain speech — broadcast to everyone in this shard via the socket.
    // The server will echo it back (including to us) so all clients render
    // the same line in the same order.
    if (state.wsReady) {
      try { state.ws.send(JSON.stringify({ type: "chat", text: raw })); }
      catch (err) { chat("Voice failed: " + err.message, "err"); }
    } else {
      chat(raw, ""); // fallback: at least show locally
    }
  });

  // ---- camera / panning ----
  // Page-level keys: WASD/arrows pan camera while the chat input isn't
  // focused. Esc closes the editor (or focuses chat → leaves the realm if
  // chat is empty).
  function isTypingInChat() {
    return document.activeElement === chatInput;
  }
  document.addEventListener("keydown", (e) => {
    if (realmEl.hidden) return;
    const key = (e.key || "").toLowerCase();
    if (e.key === "Escape") {
      if (state.editor.open) { closeEditor(); return; }
      if (isTypingInChat()) { chatInput.blur(); return; }
    }
    // T opens chat from anywhere in the realm. While typing, T just types
    // a "t" like any letter (default browser behavior, no override).
    if (key === "t" && !isTypingInChat()) {
      e.preventDefault();
      if (state.chatCollapsed) setChatCollapsed(false);
      chatInput.focus();
      return;
    }
    if (isTypingInChat()) return;
    // Hotbar slot 1 → basic weapon swing. Editor mode is build-only, so
    // attacks are politely ignored while a `/command we` palette is up.
    if (key === "1" && !state.editor.open) {
      e.preventDefault();
      sendAttack();
    }
    // Hotbar slot 2 → Mana Bolt. Cost & damage scale with the channeled
    // Output dial (mouse-wheel). Held back the same way as melee while
    // the world editor palette is up.
    if (key === "2" && !state.editor.open) {
      e.preventDefault();
      sendCast("mana_bolt");
    }
    if (key) state.keys.add(key);
  });
  document.addEventListener("keyup", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key) state.keys.delete(key);
  });

  // ---- mouse: paint / erase / hover readout ----
  function eventToTileCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tilePx = state.tileSize * state.zoom;
    const tx = Math.floor(px / tilePx) + state.cameraX;
    const ty = Math.floor(py / tilePx) + state.cameraY;
    return { x: tx, y: ty };
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) state.mouse.leftDown = true;
    if (e.button === 2) state.mouse.rightDown = true;
    if (state.editor.open && state.role === "admin") {
      const { x, y } = eventToTileCoords(e);
      paintAt(x, y, e.button === 2);
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) state.mouse.leftDown = false;
    if (e.button === 2) state.mouse.rightDown = false;
  });
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = eventToTileCoords(e);
    state.mouse.tileX = x;
    state.mouse.tileY = y;
    // (Coords readout is updated each frame from the player's own position
    // — see the tick loop — so it always reads as a tidy pair of integers.)
    // Drag-paint: holding the mouse button while moving keeps painting.
    if (state.editor.open && state.role === "admin") {
      if (state.mouse.leftDown)  paintAt(x, y, false);
      if (state.mouse.rightDown) paintAt(x, y, true);
    }
  });
  // Wheel does double duty:
  //   - Editor mode: zoom the camera (1× → 6×).
  //   - Player mode: drive the Output meter (1% → 100%, 5% per notch).
  // Per design doc §14: scroll = output, only zoom while building.
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    if (state.editor.open) {
      const next = Math.max(1, Math.min(6, state.zoom + dir));
      if (next !== state.zoom) state.zoom = next;
    } else {
      const next = Math.max(1, Math.min(100, state.output + dir * 5));
      if (next !== state.output) { state.output = next; refreshOutput(); }
    }
  }, { passive: false });

  // ---- world load / paint ----
  let lastPaintKey = "";
  async function paintAt(x, y, eraseClick) {
    if (!state.world) return;
    const layerName = state.editor.layer;
    const layer = state.world.layers.find((l) => l.name === layerName);
    if (!layer) { chat(`No layer "${layerName}".`, "err"); return; }
    const erasing = eraseClick || state.editor.brush === "erase";
    if (!erasing && !state.editor.selected) {
      chat("Pick a tile from the palette first.", "err");
      return;
    }
    const key = `${x},${y}`;
    const tile = erasing ? null : `${state.editor.selected.tileset}:${state.editor.selected.tileId}`;
    // Skip identical drag-paints onto the same tile so we don't spam the
    // server with no-op writes.
    const stamp = `${layerName}|${key}|${tile}`;
    if (stamp === lastPaintKey) return;
    lastPaintKey = stamp;
    const prev = layer.tiles[key];
    if (tile === null) delete layer.tiles[key];
    else layer.tiles[key] = tile;
    try {
      await api(`/api/world/${SHARD}/paint`, {
        method: "POST",
        body: JSON.stringify({ layer: layerName, tiles: [{ x, y, tile }] }),
      });
    } catch (err) {
      // Roll back the optimistic write so the on-screen state matches the file.
      if (prev !== undefined) layer.tiles[key] = prev;
      else delete layer.tiles[key];
      chat("Paint failed: " + err.message, "err");
    }
  }

  async function loadWorld() {
    const { world } = await api(`/api/world/${SHARD}`);
    state.world = world;
    state.tileSize = world.tileSize || 16;
    populateLayerSelect();
  }

  function populateLayerSelect() {
    paletteLayer.innerHTML = "";
    for (const l of state.world.layers) {
      const opt = document.createElement("option");
      opt.value = l.name;
      opt.textContent = l.name;
      paletteLayer.appendChild(opt);
    }
    if (!state.world.layers.find((l) => l.name === state.editor.layer)) {
      state.editor.layer = state.world.layers[0]?.name || "ground";
    }
    paletteLayer.value = state.editor.layer;
  }

  paletteLayer.addEventListener("change", () => { state.editor.layer = paletteLayer.value; });
  paletteBrush.addEventListener("change", () => { state.editor.brush = paletteBrush.value; });
  paletteClear.addEventListener("click", async () => {
    const layer = state.editor.layer;
    if (!confirm(`Clear every tile on layer "${layer}"? This cannot be undone.`)) return;
    try {
      await api(`/api/world/${SHARD}/clear-layer`, {
        method: "POST",
        body: JSON.stringify({ layer }),
      });
      const lyr = state.world.layers.find((l) => l.name === layer);
      if (lyr) lyr.tiles = {};
      chat(`Layer "${layer}" cleared.`, "good");
    } catch (err) {
      chat("Clear failed: " + err.message, "err");
    }
  });

  // ---- tilesets / palette ----
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + url));
      img.src = url;
    });
  }
  let tilesetsLoaded = false;
  async function ensureTilesetsLoaded() {
    if (tilesetsLoaded) return;
    let body;
    try { body = await api("/api/world/_/tilesets"); }
    catch (err) {
      paletteBody.innerHTML = `<p class="palette-empty">Failed to load tilesets: ${err.message}</p>`;
      return;
    }
    const tilesets = body.tilesets || [];
    if (!tilesets.length) {
      paletteBody.innerHTML = `<p class="palette-empty">No tilesets uploaded yet. Add some in the <a href="/maps.html">Tileset Library</a>, then come back.</p>`;
      tilesetsLoaded = true;
      return;
    }
    paletteBody.innerHTML = "";
    for (const ts of tilesets) {
      try {
        const img = await loadImage(ts.imageUrl);
        state.tilesets.set(ts.name, { meta: ts, image: img });
        renderPaletteEntry(ts, img);
      } catch (err) {
        const div = document.createElement("div");
        div.className = "palette-tileset";
        div.innerHTML = `<div class="ts-head"><span class="name">${ts.name}</span><span class="meta">image failed: ${err.message}</span></div>`;
        paletteBody.appendChild(div);
      }
    }
    tilesetsLoaded = true;
  }

  function renderPaletteEntry(meta, img) {
    const wrap = document.createElement("div");
    wrap.className = "palette-tileset";
    wrap.innerHTML = `
      <div class="ts-head">
        <span class="name">${meta.name}</span>
        <span class="meta">${meta.tileWidth}×${meta.tileHeight} · ${meta.tileCount} tiles · ${meta.columns} cols</span>
      </div>
      <div class="palette-stage">
        <canvas></canvas>
        <div class="selection"></div>
      </div>`;
    paletteBody.appendChild(wrap);
    const cv = wrap.querySelector("canvas");
    const sel = wrap.querySelector(".selection");
    const Z = 2;
    cv.width = meta.imageWidth * Z;
    cv.height = meta.imageHeight * Z;
    const pctx = cv.getContext("2d");
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(img, 0, 0, meta.imageWidth, meta.imageHeight, 0, 0, cv.width, cv.height);
    pctx.strokeStyle = "rgba(255,255,255,0.18)";
    pctx.lineWidth = 1;
    pctx.beginPath();
    for (let c = 0; c <= meta.columns; c++) {
      const x = (meta.margin + c * (meta.tileWidth + meta.spacing)) * Z + 0.5;
      pctx.moveTo(x, 0); pctx.lineTo(x, cv.height);
    }
    const rows = Math.ceil(meta.tileCount / meta.columns);
    for (let r = 0; r <= rows; r++) {
      const y = (meta.margin + r * (meta.tileHeight + meta.spacing)) * Z + 0.5;
      pctx.moveTo(0, y); pctx.lineTo(cv.width, y);
    }
    pctx.stroke();

    cv.addEventListener("click", (e) => {
      const rect = cv.getBoundingClientRect();
      const px = (e.clientX - rect.left) / Z;
      const py = (e.clientY - rect.top) / Z;
      const col = Math.floor((px - meta.margin) / (meta.tileWidth + meta.spacing));
      const row = Math.floor((py - meta.margin) / (meta.tileHeight + meta.spacing));
      if (col < 0 || col >= meta.columns || row < 0) return;
      const id = row * meta.columns + col;
      if (id >= meta.tileCount) return;
      paletteEl.querySelectorAll(".selection").forEach((s) => s.style.display = "none");
      sel.style.left   = (meta.margin + col * (meta.tileWidth + meta.spacing)) * Z + "px";
      sel.style.top    = (meta.margin + row * (meta.tileHeight + meta.spacing)) * Z + "px";
      sel.style.width  = meta.tileWidth  * Z + "px";
      sel.style.height = meta.tileHeight * Z + "px";
      sel.style.display = "block";
      state.editor.selected = { tileset: meta.name, tileId: id };
      paletteSel.textContent = `${meta.name}:${id}`;
      // Switching to a real tile implies "paint", not "erase".
      paletteBrush.value = "paint";
      state.editor.brush = "paint";
    });
  }

  // ---- editor open/close ----
  // Opening the editor hides the player-facing HUD (stat panel, hotbar,
  // output meter, presence, mini-map) so the admin sees the world cleanly.
  // Chat stays — the admin still needs to type slash commands.
  function openEditor(mode) {
    state.editor.open = true;
    state.editor.mode = mode;
    paletteMode.textContent = mode;
    editModeEl.textContent = mode;
    editFlag.hidden = false;
    paletteEl.hidden = false;
    realmEl.classList.add("is-editing");
    canvas.style.cursor = "crosshair";
    chat(`Editor open — /${mode}. Pick a tile, click world to paint, right-click to erase.`, "cmd");
    ensureTilesetsLoaded();
  }
  function closeEditor() {
    state.editor.open = false;
    paletteEl.hidden = true;
    editFlag.hidden = true;
    realmEl.classList.remove("is-editing");
    chat("Editor closed.", "cmd");
  }
  function toggleEditor(mode) {
    if (state.editor.open && state.editor.mode === mode) { closeEditor(); return; }
    openEditor(mode);
  }
  paletteClose.addEventListener("click", closeEditor);

  // ---- canvas size / render loop ----
  function resize() {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resize);

  // Procedural grass renderer used wherever no real ground tile is painted
  // (or when the configured defaultGround tileset isn't uploaded). Cached
  // off-screen so it draws fast.
  let grassPattern = null;
  function makeGrassPattern() {
    const g = document.createElement("canvas");
    g.width = 16; g.height = 16;
    const c = g.getContext("2d");
    c.fillStyle = "#2c5b2a";
    c.fillRect(0, 0, 16, 16);
    // a few darker / lighter blades for texture
    const blades = [
      ["#1f3f1c", 30],
      ["#3b7a36", 22],
      ["#5da159", 12],
    ];
    for (const [color, count] of blades) {
      c.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const x = Math.floor(Math.random() * 16);
        const y = Math.floor(Math.random() * 16);
        c.fillRect(x, y, 1, 1);
      }
    }
    return g;
  }

  function viewportTilesAcross() { return Math.ceil(window.innerWidth  / (state.tileSize * state.zoom)) + 1; }
  function viewportTilesDown()   { return Math.ceil(window.innerHeight / (state.tileSize * state.zoom)) + 1; }

  // World-tile -> screen-pixel using the (possibly fractional) camera.
  function worldToScreen(wx, wy, tilePx) {
    return {
      sx: (wx - state.cameraX) * tilePx,
      sy: (wy - state.cameraY) * tilePx,
    };
  }

  function render() {
    const tilePx = state.tileSize * state.zoom;
    const cols = viewportTilesAcross() + 1;
    const rows = viewportTilesDown() + 1;
    const camTileX = Math.floor(state.cameraX);
    const camTileY = Math.floor(state.cameraY);
    const offX = -(state.cameraX - camTileX) * tilePx;
    const offY = -(state.cameraY - camTileY) * tilePx;

    // Background = procedural grass tiled across the viewport (fractional
    // camera offset so scroll is smooth, not jittery per-tile).
    if (!grassPattern) grassPattern = makeGrassPattern();
    for (let dy = -1; dy < rows; dy++) {
      for (let dx = -1; dx < cols; dx++) {
        ctx.drawImage(grassPattern, dx * tilePx + offX, dy * tilePx + offY, tilePx, tilePx);
      }
    }

    if (!state.world) return;

    // Painted layers, in array order (earliest first, latest on top).
    for (const layer of state.world.layers) {
      const isActive = state.editor.open && layer.name === state.editor.layer;
      ctx.globalAlpha = !state.editor.open || isActive ? 1 : 0.55;
      for (let dy = -1; dy < rows; dy++) {
        for (let dx = -1; dx < cols; dx++) {
          const wx = camTileX + dx;
          const wy = camTileY + dy;
          const ref = layer.tiles[`${wx},${wy}`];
          if (!ref) continue;
          drawTileRef(ref, dx * tilePx + offX, dy * tilePx + offY, tilePx);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Draw all visible avatars from the smoothed render records, sorted by
    // y so closer-to-camera souls overlap correctly. Self is flagged so it
    // gets the brighter ring and label.
    const meId = state.me?.id;
    const recs = Array.from(state.renderPlayers.values())
      .sort((a, b) => a.y - b.y);
    for (const rec of recs) drawPlayer(rec, tilePx, rec.id === meId);
    // Combat FX: swing arcs above avatars, damage pops above arcs, speech
    // bubbles above all of it.
    drawSwings(tilePx);
    drawBolts(tilePx);
    drawHitPops(tilePx);
    for (const rec of recs) drawBubble(rec, tilePx);

    // Editor overlays: light grid + cursor highlight.
    if (state.editor.open) {
      drawGrid(cols, rows, tilePx);
      drawCursor(tilePx);
    }

    // Origin cross — easy reference point for admins navigating with WASD.
    drawOriginCross(tilePx);

    // Death veil — drawn last so it covers every layer including the FX.
    if (state.deadOverlay) drawDeathVeil();
  }

  // ---- combat FX: slash arcs + floating damage numbers --------------
  // Both fade out over a fixed window (220 ms / 900 ms). We don't bother
  // with a separate animation rAF — the existing render loop already
  // runs at display rate and sweeps these every frame.
  const SWING_LIFE_MS = 220;
  const POP_LIFE_MS   = 900;
  function drawSwings(tilePx) {
    const now = performance.now();
    const fv = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
    const live = [];
    for (const sw of state.fx.swings) {
      const age = now - sw.t0;
      if (age >= SWING_LIFE_MS) continue;
      live.push(sw);
      const t = age / SWING_LIFE_MS;            // 0 → 1
      const alpha = 1 - t;
      const [dx, dy] = fv[sw.facing] || fv.down;
      // Anchor the arc to the swinger's snapshot pos, projected forward.
      const { sx, sy } = worldToScreen(sw.x, sw.y, tilePx);
      const cx = sx + tilePx / 2 + dx * tilePx * sw.reach * 0.55;
      const cy = sy + tilePx / 2 + dy * tilePx * sw.reach * 0.55;
      const r  = tilePx * (sw.reach * 0.55) * (0.7 + 0.3 * t);
      // Sweep angle: perpendicular to facing
      const baseAng = Math.atan2(dy, dx);
      const half = (Math.PI / 3) * (0.6 + 0.4 * t);
      ctx.save();
      ctx.lineWidth = Math.max(2, tilePx * 0.18);
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(246,228,163,${0.85 * alpha})`;
      ctx.shadowColor = "rgba(246,228,163,0.7)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, baseAng - half, baseAng + half);
      ctx.stroke();
      ctx.restore();
    }
    state.fx.swings = live;
  }
  function drawHitPops(tilePx) {
    const now = performance.now();
    const live = [];
    for (const pop of state.fx.pops) {
      const age = now - pop.t0;
      if (age >= POP_LIFE_MS) continue;
      live.push(pop);
      const t = age / POP_LIFE_MS;
      const alpha = 1 - t;
      // Track the target if it's still around; else stick to snapshot pos.
      const rec = state.renderPlayers.get(pop.id);
      const wx = rec ? rec.x : pop.x;
      const wy = rec ? rec.y : pop.y;
      const { sx, sy } = worldToScreen(wx, wy, tilePx);
      const cx = sx + tilePx / 2;
      const cy = sy - 8 - t * 32;          // float upward over the life
      ctx.save();
      ctx.font = `700 ${Math.round(tilePx * 0.95)}px "Cinzel", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(20,12,6,${0.85 * alpha})`;
      ctx.fillStyle   = `rgba(255,138,122,${alpha})`;
      const txt = `-${pop.dmg}`;
      ctx.strokeText(txt, cx, cy);
      ctx.fillText(txt, cx, cy);
      ctx.restore();
    }
    state.fx.pops = live;
  }

  // Mana Bolt beam — a glowing arcane lance that grows from the caster's
  // position toward the impact point at the spell's flight speed, then
  // briefly hangs in the air and fades. Width and brightness scale with
  // the caster's channeled Output, so a 100% bolt looks much heavier
  // than a 10% poke.
  function drawBolts(tilePx) {
    const now = performance.now();
    const live = [];
    for (const b of state.fx.bolts) {
      const age = now - b.t0;
      if (age > b.travelMs + b.fadeMs) continue;
      live.push(b);
      const flightP = Math.min(1, age / Math.max(1, b.travelMs));
      const fadeAmt = age > b.travelMs ? Math.min(1, (age - b.travelMs) / b.fadeMs) : 0;
      const alpha = 1 - fadeAmt * 0.95;
      const a = worldToScreen(b.fromX, b.fromY, tilePx);
      const tipWX = b.fromX + (b.toX - b.fromX) * flightP;
      const tipWY = b.fromY + (b.toY - b.fromY) * flightP;
      const tip   = worldToScreen(tipWX, tipWY, tilePx);
      const out   = b.output;
      const lw    = (3 + out * 4) * (1 - fadeAmt * 0.5);

      ctx.save();
      ctx.lineCap = "round";
      // Outer glow
      ctx.globalAlpha = 0.55 * alpha;
      ctx.strokeStyle = "rgba(140, 200, 255, 1)";
      ctx.lineWidth = lw + 6;
      ctx.shadowColor = "rgba(120, 180, 255, 0.9)";
      ctx.shadowBlur = 14 + out * 10;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(tip.sx, tip.sy);
      ctx.stroke();
      // Hot core
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "rgba(245, 248, 255, 1)";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(tip.sx, tip.sy);
      ctx.stroke();
      // Tip flare on impact
      if (flightP >= 1) {
        ctx.globalAlpha = (1 - fadeAmt) * 0.8;
        ctx.fillStyle = "rgba(180, 220, 255, 1)";
        ctx.beginPath();
        ctx.arc(tip.sx, tip.sy, 6 + out * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    state.fx.bolts = live;
  }

  function drawDeathVeil() {
    const w = canvas.width, h = canvas.height;
    const now = performance.now();
    const left = Math.max(0, state.deadOverlay.until - now);
    const fade = Math.min(1, (4500 - left) / 600);
    ctx.save();
    ctx.fillStyle = `rgba(8,4,4,${0.78 * fade})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgba(255,108,108,${fade})`;
    ctx.font = `900 ${Math.round(Math.min(w, h) * 0.09)}px "Cinzel", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillText("YOU HAVE FALLEN", w/2, h/2 - 18);
    ctx.font = `500 ${Math.round(Math.min(w, h) * 0.028)}px "Cormorant Garamond", serif`;
    ctx.fillStyle = `rgba(246,228,163,${0.9 * fade})`;
    ctx.fillText(`Slain by ${state.deadOverlay.by} — the vessel is spent.`, w/2, h/2 + 30);
    ctx.restore();
  }

  // ---- avatar rendering ----
  // Players draw with their own sprite sheet when one is loaded; otherwise
  // we fall back to the race-tinted glowing pip so the world is still
  // legible. Name plate sits above the head and a soft elliptical shadow
  // grounds the avatar to the tile.
  const RACE_COLOR = {
    human: "#f4d499", orc: "#7fe39a", elf: "#b9e6e6",
    crystalline: "#cfe4ff", voidborn: "#caa6ff",
  };
  function drawPlayer(rec, tilePx, isSelf) {
    const { sx, sy } = worldToScreen(rec.x, rec.y, tilePx);
    const cx = sx + tilePx / 2;
    const cy = sy + tilePx / 2;
    // Use walk sheet only when the avatar is actually moving toward its
    // target — covers both server-issued anim flag and visible drift.
    const moving = rec.anim === "walk" ||
                   Math.hypot(rec.tx - rec.x, rec.ty - rec.y) > 0.05;
    const sprite = getSpriteForPlayer(rec, moving ? "walk" : "idle");
    if (sprite) {
      drawSpriteAvatar(sprite, rec, cx, cy, tilePx);
    } else {
      drawCirclePip(rec, cx, cy, tilePx, isSelf);
    }
    // Name plate (gold ring on selection, lighter for self)
    const label = rec.name + (rec.isAdmin ? " ✦" : "");
    ctx.font = "600 12px 'Cinzel', 'Cormorant Garamond', serif";
    const w = ctx.measureText(label).width + 12;
    const ny = cy - tilePx * 0.85 - 14;
    // panel
    ctx.fillStyle = "rgba(10,10,18,0.82)";
    ctx.fillRect(cx - w / 2, ny, w, 16);
    ctx.strokeStyle = isSelf ? "rgba(246,228,163,0.7)"
                              : "rgba(217,166,74,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 + 0.5, ny + 0.5, w - 1, 15);
    ctx.fillStyle = isSelf ? "#f6e4a3" : (rec.isAdmin ? "#f6e4a3" : "#e9dfc6");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, ny + 8);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
  function drawCirclePip(rec, cx, cy, tilePx, isSelf) {
    const r  = tilePx * 0.42;
    const fill = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isSelf ? 2.5 : 1.5;
    ctx.strokeStyle = rec.isAdmin ? "#f6e4a3" : (isSelf ? "rgba(246,228,163,0.9)" : "rgba(0,0,0,0.55)");
    ctx.beginPath();
    ctx.arc(cx, cy, r + (isSelf ? 1 : 0), 0, Math.PI * 2);
    ctx.stroke();
    const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [fx, fy] = dirs[rec.facing] || [0, 1];
    ctx.strokeStyle = "rgba(20,16,8,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + fx * r * 0.85, cy + fy * r * 0.85);
    ctx.stroke();
  }
  function drawSpriteAvatar(sprite, rec, cx, cy, tilePx) {
    const slice = sprite.slice;
    const frames = Math.max(1, slice.frames | 0);
    const idx = Math.floor(rec.animTime * slice.fps) % frames;
    let sx, sy, sw, sh;
    if (slice.perFrame && slice.frameRects && slice.frameRects[idx]) {
      ({ x: sx, y: sy, w: sw, h: sh } = slice.frameRects[idx]);
    } else {
      sx = slice.offsetX + idx * (slice.frameW + slice.gapX);
      sy = slice.offsetY;
      sw = slice.frameW;
      sh = slice.frameH;
    }
    // Scale so each sprite is roughly two tiles tall — feels right for a
    // top-down RPG (54px sprite at 16px tiles → ~1.7 tiles, then ×scale).
    const targetH = tilePx * 1.9;
    const scale = targetH / sh;
    const dw = sw * scale, dh = sh * scale;
    const dx = cx - dw / 2;
    const dy = cy - dh * 0.78;       // anchor near the feet, not the center
    // Soft shadow at the base
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + tilePx * 0.32, tilePx * 0.36, tilePx * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  // Speech bubble that floats above the avatar for a few seconds after
  // a chat message arrives. Wraps to fit a max width and adjusts its
  // height per line — clean parchment look matches the rest of the HUD.
  function drawBubble(rec, tilePx) {
    if (!rec.bubble) return;
    const now = performance.now();
    if (now > rec.bubble.until) { rec.bubble = null; return; }
    const { sx, sy } = worldToScreen(rec.x, rec.y, tilePx);
    const cx = sx + tilePx / 2;
    const baseY = sy + tilePx / 2 - tilePx * 0.85 - 18;

    ctx.font = "500 13px 'Cormorant Garamond', serif";
    const maxW = 220;
    const words = rec.bubble.text.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (ctx.measureText(trial).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    const lineH = 16;
    const padX = 8, padY = 5;
    let bw = 0;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    bw += padX * 2;
    const bh = lines.length * lineH + padY * 2;
    const bx = cx - bw / 2;
    const by = baseY - bh - 6;
    // Fade out in the last 600ms.
    const remain = rec.bubble.until - now;
    const alpha = remain < 600 ? remain / 600 : 1;
    ctx.globalAlpha = alpha;
    // panel + ornate gold edge
    ctx.fillStyle = "rgba(14,12,18,0.92)";
    ctx.strokeStyle = "rgba(217,166,74,0.7)";
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, bh, 4);
    ctx.fill();
    ctx.stroke();
    // tail
    ctx.beginPath();
    ctx.moveTo(cx - 5, by + bh);
    ctx.lineTo(cx + 5, by + bh);
    ctx.lineTo(cx,     by + bh + 6);
    ctx.closePath();
    ctx.fillStyle = "rgba(14,12,18,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(217,166,74,0.7)";
    ctx.stroke();
    // text
    ctx.fillStyle = rec.isAdmin ? "#f6e4a3" : "#ece2c5";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, by + padY + i * lineH);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawTileRef(ref, dx, dy, tilePx) {
    const m = ref.match(/^(.+):(\d+)$/);
    if (!m) return;
    const ts = state.tilesets.get(m[1]);
    if (!ts || !ts.image) return;
    const id = Number(m[2]);
    const meta = ts.meta;
    const col = id % meta.columns;
    const row = Math.floor(id / meta.columns);
    const sx = meta.margin + col * (meta.tileWidth  + meta.spacing);
    const sy = meta.margin + row * (meta.tileHeight + meta.spacing);
    ctx.drawImage(ts.image, sx, sy, meta.tileWidth, meta.tileHeight, dx, dy, tilePx, tilePx);
  }
  function drawGrid(cols, rows, tilePx) {
    ctx.strokeStyle = "rgba(217,166,74,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let dx = 0; dx <= cols; dx++) {
      const x = dx * tilePx + 0.5;
      ctx.moveTo(x, 0); ctx.lineTo(x, rows * tilePx);
    }
    for (let dy = 0; dy <= rows; dy++) {
      const y = dy * tilePx + 0.5;
      ctx.moveTo(0, y); ctx.lineTo(cols * tilePx, y);
    }
    ctx.stroke();
  }
  function drawCursor(tilePx) {
    const cx = (state.mouse.tileX - state.cameraX) * tilePx;
    const cy = (state.mouse.tileY - state.cameraY) * tilePx;
    ctx.strokeStyle = "rgba(246,228,163,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx + 0.5, cy + 0.5, tilePx - 1, tilePx - 1);
  }
  function drawOriginCross(tilePx) {
    const ox = (0 - state.cameraX) * tilePx;
    const oy = (0 - state.cameraY) * tilePx;
    if (ox + tilePx < 0 || oy + tilePx < 0 || ox > window.innerWidth || oy > window.innerHeight) return;
    ctx.strokeStyle = "rgba(246,228,163,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + tilePx / 2, oy + 2);
    ctx.lineTo(ox + tilePx / 2, oy + tilePx - 2);
    ctx.moveTo(ox + 2,         oy + tilePx / 2);
    ctx.lineTo(ox + tilePx - 2, oy + tilePx / 2);
    ctx.stroke();
  }

  // ---- input + camera tick ----
  // While the editor is OPEN, WASD/arrows pan the camera (admin worldbuild
  // mode). While the editor is CLOSED, WASD/arrows are sent to the server
  // as movement input and the camera follows the player.
  function readInput() {
    let dx = 0, dy = 0;
    if (state.keys.has("w") || state.keys.has("arrowup"))    dy -= 1;
    if (state.keys.has("s") || state.keys.has("arrowdown"))  dy += 1;
    if (state.keys.has("a") || state.keys.has("arrowleft"))  dx -= 1;
    if (state.keys.has("d") || state.keys.has("arrowright")) dx += 1;
    const sprint = state.keys.has("shift");
    let facing = state.lastInputSent.facing;
    if (dx || dy) {
      if (Math.abs(dx) > Math.abs(dy)) facing = dx < 0 ? "left" : "right";
      else                              facing = dy < 0 ? "up"   : "down";
    }
    return { dx, dy, sprint, facing };
  }
  // Coalesce input sends to ~20 Hz. Server applies them on its tick anyway.
  function maybeSendInput() {
    if (!state.wsReady) return;
    const inp = readInput();
    const last = state.lastInputSent;
    const now = performance.now();
    const changed = inp.dx !== last.dx || inp.dy !== last.dy
                 || inp.sprint !== last.sprint || inp.facing !== last.facing;
    // Always re-send periodically too — keeps the server happy with current intent.
    if (!changed && now - last.t < 100) return;
    last.dx = inp.dx; last.dy = inp.dy; last.sprint = inp.sprint;
    last.facing = inp.facing; last.t = now;
    try { state.ws.send(JSON.stringify({ type: "input", ...inp })); } catch {}
  }

  // Slot-1 attack — fires whatever weapon the vessel is wearing. The
  // server is the sole authority on cooldown / stamina / damage; we just
  // send the intent and let it answer with {swing}/{hit}/{attack_denied}.
  function sendAttack() {
    if (!state.wsReady || !state.me) return;
    const facing = state.me.facing || "down";
    try { state.ws.send(JSON.stringify({ type: "attack", facing })); } catch {}
  }

  // Slot-2 cast — Mana Bolt for now. The dial-in `output` (5–100%) is sent
  // as a unit float; server pays the mana, picks the first target in the
  // lane in front of us, and broadcasts a {bolt} for everyone to render.
  function sendCast(spell) {
    if (!state.wsReady || !state.me) return;
    const facing = state.me.facing || "down";
    const output = Math.max(0.05, Math.min(1, (state.output || 100) / 100));
    try { state.ws.send(JSON.stringify({ type: "cast", spell, facing, output })); } catch {}
  }

  let lastTickTime = 0;
  function tick(now) {
    const dt = lastTickTime ? Math.min(0.1, (now - lastTickTime) / 1000) : 0;
    lastTickTime = now;

    if (state.editor.open) {
      // Admin worldbuild: free-pan the camera (legacy behavior).
      const speed = state.keys.has("shift") ? 24 : 8;
      let dx = 0, dy = 0;
      if (state.keys.has("w") || state.keys.has("arrowup"))    dy -= 1;
      if (state.keys.has("s") || state.keys.has("arrowdown"))  dy += 1;
      if (state.keys.has("a") || state.keys.has("arrowleft"))  dx -= 1;
      if (state.keys.has("d") || state.keys.has("arrowright")) dx += 1;
      if (dx || dy) {
        camAccumX += dx * speed * dt;
        camAccumY += dy * speed * dt;
        const snapX = Math.trunc(camAccumX);
        const snapY = Math.trunc(camAccumY);
        if (snapX) { state.cameraX += snapX; camAccumX -= snapX; }
        if (snapY) { state.cameraY += snapY; camAccumY -= snapY; }
      }
      // While editing, pause input transmission so the avatar stays put.
      if (state.wsReady && (state.lastInputSent.dx || state.lastInputSent.dy)) {
        state.lastInputSent.dx = 0; state.lastInputSent.dy = 0;
        try { state.ws.send(JSON.stringify({ type: "input", dx: 0, dy: 0, sprint: false, facing: state.lastInputSent.facing })); } catch {}
      }
    } else {
      maybeSendInput();
    }

    // Smoothly interpolate every avatar's visual position toward its
    // server-authoritative target. This is what makes 60fps render look
    // fluid even though the server only ticks at 20Hz.
    lerpRenderPositions(dt);

    // Camera follows the smoothed self-record so it never jitters.
    if (!state.editor.open && state.me) {
      const meRec = state.renderPlayers.get(state.me.id);
      if (meRec) {
        const tilePx = state.tileSize * state.zoom;
        const cols = window.innerWidth  / tilePx;
        const rows = window.innerHeight / tilePx;
        state.cameraX = meRec.x - cols / 2 + 0.5;
        state.cameraY = meRec.y - rows / 2 + 0.5;
      }
    }

    // HUD coords readout — show the player's own integer tile, not the
    // float lerp position and not the mouse hover (the mouse readout was
    // a leftover from the old editor-only HUD).
    if (state.me) {
      coordsEl.textContent = `(${Math.round(state.me.x)}, ${Math.round(state.me.y)})`;
    }

    render();
    renderMinimap();
    raf = requestAnimationFrame(tick);
  }
  let camAccumX = 0, camAccumY = 0;
  let raf = 0;

  // ---- websocket: realtime presence + chat ----
  function connectSocket() {
    if (state.ws) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws/realm`;
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.addEventListener("open", () => {
      state.wsReady = true;
      chat("Bound to the world's pulse.", "good");
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleServerMessage(msg);
    });
    ws.addEventListener("close", (ev) => {
      state.wsReady = false;
      state.ws = null;
      state.others.clear();
      if (ev.code === 4000) chat("Another session took your place.", "err");
      else if (!realmEl.hidden) {
        chat("Lost the world's pulse — reconnecting…", "err");
        setTimeout(() => { if (!realmEl.hidden) connectSocket(); }, 1500);
      }
    });
    ws.addEventListener("error", () => {
      // close handler will run; nothing to do here
    });
  }
  function handleServerMessage(msg) {
    switch (msg.type) {
      case "welcome":
        state.serverTickHz = msg.tickHz || 20;
        state.me = msg.you;
        state.others.clear();
        state.renderPlayers.clear();
        ensureRenderRec(msg.you);
        for (const o of msg.others || []) {
          state.others.set(o.id, o);
          ensureRenderRec(o);
        }
        setPresence(state.others.size + 1);
        // Hydrate the HUD from authoritative vitals — the server may have
        // a wounded HP from a previous session, and stamina/mana always
        // start at cap.
        if (state.character) {
          if (msg.you.hpMax)   state.character.max_hp      = msg.you.hpMax;
          if (msg.you.manaMax) state.character.mana_cap    = msg.you.manaMax;
          if (msg.you.stMax)   state.character.stamina_cap = msg.you.stMax;
          if (msg.you.weapon)  state.character.starting_weapon = msg.you.weapon;
          state.cur.hp = msg.you.hp ?? state.cur.hp;
          state.cur.mp = msg.you.mana ?? state.cur.mp;
          state.cur.st = msg.you.st ?? state.cur.st;
          refreshBars();
        }
        chat(`Shard "${msg.shard}" — ${state.others.size} other ${state.others.size === 1 ? "soul" : "souls"} present.`, "cmd");
        break;
      case "join":
        if (msg.player && msg.player.id !== state.me?.id) {
          state.others.set(msg.player.id, msg.player);
          ensureRenderRec(msg.player);
          setPresence(state.others.size + 1);
        }
        break;
      case "leave":
        state.others.delete(msg.id);
        state.renderPlayers.delete(msg.id);
        setPresence(state.others.size + (state.me ? 1 : 0));
        break;
      case "state": {
        for (const p of msg.players || []) {
          ensureRenderRec(p);
          if (state.me && p.id === state.me.id) {
            state.me.x = p.x; state.me.y = p.y;
            state.me.facing = p.facing; state.me.anim = p.anim;
            // Mirror live vitals into HUD; tick is 20Hz which is fine
            // for the bar smoothing and number readouts.
            if (typeof p.hp === "number") state.cur.hp = p.hp;
            if (typeof p.mana === "number") state.cur.mp = p.mana;
            if (typeof p.st === "number") state.cur.st = p.st;
            refreshBars();
          } else {
            const cur = state.others.get(p.id);
            if (cur) { Object.assign(cur, p); }
            else state.others.set(p.id, p);
          }
        }
        // Drop any stragglers not in this snapshot
        const present = new Set((msg.players || []).map((p) => p.id));
        for (const id of state.others.keys()) {
          if (!present.has(id)) state.others.delete(id);
        }
        for (const id of state.renderPlayers.keys()) {
          if (!present.has(id) && id !== state.me?.id) state.renderPlayers.delete(id);
        }
        // Snapshot's player count is the truth — keep the HUD in lockstep.
        setPresence((msg.players || []).length);
        break;
      }
      case "chat":
        if (msg.kind === "system") chat(msg.text, "cmd");
        else if (msg.from) {
          const tag = msg.from.isAdmin ? "✦ " : "";
          chat(`${tag}${msg.from.name}: ${msg.text}`,
               msg.from.id === state.me?.id ? "self" : "");
          // Speech bubble above the speaker — shows up over their avatar
          // for everyone in the shard, including themselves.
          attachBubble(msg.from.id, msg.text);
        }
        break;
      case "swing": {
        // Render a fading slash arc in front of the swinger. We snapshot
        // the swinger's render position so the arc stays anchored even if
        // they keep moving.
        const rec = state.renderPlayers.get(msg.id);
        if (rec) {
          state.fx.swings.push({
            id: msg.id,
            x: rec.x, y: rec.y,
            facing: msg.facing || rec.facing || "down",
            reach: msg.reach || 1.2,
            arc: msg.arc || 0.7,
            t0: performance.now(),
            weapon: msg.weapon,
          });
        }
        break;
      }
      case "hit": {
        // Floating damage number above the target, plus a brief red flash.
        const rec = state.renderPlayers.get(msg.id);
        const now = performance.now();
        if (rec) {
          state.fx.pops.push({
            id: msg.id,
            x: rec.x, y: rec.y,
            dmg: msg.dmg,
            t0: now,
          });
          state.fx.hits.set(msg.id, now + 220);
        }
        // If we're the one taking the hit, knock our local HP down right
        // away (the next state packet will confirm) so the bar reacts
        // before the next tick lands.
        if (state.me && msg.id === state.me.id && typeof msg.hp === "number") {
          state.cur.hp = msg.hp;
          refreshBars();
        }
        break;
      }
      case "attack_denied":
        if (msg.reason === "stamina") chat("Too winded — catch your breath.", "err");
        break;
      case "bolt": {
        // Add a flying-beam effect that travels from caster to endpoint
        // at the spell's tile/sec speed; the renderer will draw it for
        // however long the trip + a short fade takes.
        const dx = msg.to.x - msg.from.x;
        const dy = msg.to.y - msg.from.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const travelMs = (dist / Math.max(1, msg.speed || 18)) * 1000;
        state.fx.bolts.push({
          spell: msg.spell,
          fromX: msg.from.x, fromY: msg.from.y,
          toX:   msg.to.x,   toY:   msg.to.y,
          output: msg.output || 1,
          t0: performance.now(),
          travelMs,
          fadeMs: 220,
        });
        // If the caster was us, deduct mana locally for snappy feedback.
        if (state.me && msg.from.id === state.me.id) {
          // Server is authoritative — next state packet refreshes anyway,
          // but the bolt event itself implies the cost was paid.
          // (No-op here: state ticks at 20Hz, so the bar will update fast.)
        }
        break;
      }
      case "cast_denied":
        if (msg.reason === "mana") chat("Not enough mana for that bolt.", "err");
        break;
      case "slain": {
        const isMe = state.me && msg.id === state.me.id;
        const byTxt = msg.by ? msg.by.name : "the realm";
        if (isMe) {
          // Flag self-death — render loop pops a parchment death screen
          // over the canvas; the socket will close right after.
          state.deadOverlay = { until: performance.now() + 4500, by: byTxt };
          chat(`You were slain by ${byTxt}. The vessel is spent.`, "err");
        } else {
          chat(`${msg.name || "Someone"} fell to ${byTxt}.`, "cmd");
        }
        break;
      }
      case "goodbye":
        chat("Server: " + (msg.reason || "disconnected"), "err");
        if (msg.reason === "slain") {
          // Hold the death overlay long enough to read it, then bow out
          // so the player lands on the forge to mourn / re-vessel.
          setTimeout(() => leave(), 1500);
        }
        break;
    }
  }
  function disconnectSocket() {
    if (!state.ws) return;
    try { state.ws.close(1000, "leave"); } catch {}
    state.ws = null;
    state.wsReady = false;
    state.others.clear();
    state.renderPlayers.clear();
    state.me = null;
  }

  // ---- HUD: stat panel + hotbar + minimap ----
  function applyCharacterToHud(ch) {
    state.character = ch;
    state.cur.hp = ch.hp ?? ch.max_hp ?? 0;
    state.cur.mp = ch.mana_cap ?? 0;        // mana sits at cap until casting lands
    state.cur.st = ch.stamina_cap ?? 0;     // stamina at cap until sprint drain lands
    statsName.textContent  = ch.name || "—";
    statsLevel.textContent = ch.level ?? 1;
    const isAdmin = ch.race === null || ch.race === undefined;
    const raceLabel = isAdmin ? "Architect" : (ch.race_name || ch.race || "—");
    statsRace.textContent  = raceLabel;
    statsRace.classList.toggle("is-admin", isAdmin);
    statsXp.textContent    = ch.xp ?? 0;
    statsCtrl.textContent  = ch.control ?? 10;
    statsRes.textContent   = `${ch.resistance ?? 0}%`;
    if (statsCast) statsCast.textContent = `${(ch.cast_speed ?? 1).toFixed(1)}×`;
    const weapon = ch.starting_weapon || (isAdmin ? "Free Hand" : "—");
    hbWeaponName.textContent = weapon;
    hbWeaponIcon.textContent = WEAPON_ICON[weapon] || "⚔";

    // Mirror everything into the Vessel modal so opening it gives a full sheet.
    if (charModalRefs.name) {
      charModalRefs.name.textContent  = ch.name || "—";
      charModalRefs.race.textContent  = raceLabel;
      charModalRefs.level.textContent = ch.level ?? 1;
      charModalRefs.hp.textContent    = `${ch.hp ?? ch.max_hp ?? 0} / ${ch.max_hp ?? 0}`;
      charModalRefs.mp.textContent    = `${ch.mana_cap ?? 0}`;
      charModalRefs.st.textContent    = `${ch.stamina_cap ?? 0}`;
      charModalRefs.xp.textContent    = `${ch.xp ?? 0}`;
      charModalRefs.ctrl.textContent  = `${ch.control ?? 10}`;
      charModalRefs.cast.textContent  = `${(ch.cast_speed ?? 1).toFixed(2)}×`;
      charModalRefs.eff.textContent   = `${(ch.efficiency ?? 1).toFixed(2)}×`;
      charModalRefs.res.textContent   = `${ch.resistance ?? 0}%`;
      charModalRefs.weapon.textContent= weapon;
    }

    refreshBars();
    drawHudPortrait();
  }

  // ---- HUD portrait ---------------------------------------------------
  // Draws the player into the bottom-HUD portrait frame. For admins we
  // grab an idle "Down" frame from the sprite registry; for everyone else
  // we paint a race-tinted glowing pip so the frame is never empty.
  function drawHudPortrait() {
    const ch = state.character;
    if (!ch) return;
    const isAdmin = ch.race === null || ch.race === undefined;
    paintPortrait(hudPortraitCtx, hudPortrait.width, hudPortrait.height, ch, isAdmin);
    if (charModalPortraitCtx) {
      paintPortrait(charModalPortraitCtx, charModalPortrait.width, charModalPortrait.height, ch, isAdmin);
    }
    if (hudPortraitEmpty) hudPortraitEmpty.hidden = true;
  }
  function paintPortrait(c, w, h, ch, isAdmin) {
    c.imageSmoothingEnabled = false;
    // Backdrop wash — match the frame's tint.
    const bg = c.createRadialGradient(w/2, h*0.35, 4, w/2, h/2, w*0.7);
    bg.addColorStop(0, isAdmin ? "rgba(246,228,163,0.18)" : "rgba(91,140,255,0.16)");
    bg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = "rgba(0,0,0,0)";
    c.clearRect(0, 0, w, h);
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    if (isAdmin && SpriteSet.loaded) {
      const set = SpriteSet.sheets.admin.idle.down
               || SpriteSet.sheets.admin.idle.right
               || SpriteSet.sheets.admin.idle.up;
      if (set && set.img) {
        const slice = set.slice;
        let sx, sy, sw, sh;
        if (slice.perFrame && slice.frameRects && slice.frameRects[0]) {
          ({ x: sx, y: sy, w: sw, h: sh } = slice.frameRects[0]);
        } else {
          sx = slice.offsetX; sy = slice.offsetY;
          sw = slice.frameW;   sh = slice.frameH;
        }
        // Fit the sprite vertically with a margin so the head + torso show.
        const targetH = h * 0.95;
        const scale = targetH / sh;
        const dw = sw * scale, dh = sh * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2 + h * 0.04;  // nudge down a hair
        c.drawImage(set.img, sx, sy, sw, sh, dx, dy, dw, dh);
        return;
      }
    }
    // Fallback: race-tinted glowing pip.
    const RACE = { human: "#f4d499", orc: "#7fe39a", elf: "#b9e6e6",
                   crystalline: "#cfe4ff", voidborn: "#caa6ff" };
    const fill = isAdmin ? "#f6e4a3" : (RACE[ch.race] || "#cfe4ff");
    const r = w * 0.32;
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.ellipse(w/2, h*0.78, r*0.85, r*0.32, 0, 0, Math.PI*2);
    c.fill();
    const glow = c.createRadialGradient(w/2, h/2, 0, w/2, h/2, r*1.6);
    glow.addColorStop(0, fill);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fill;
    c.beginPath();
    c.arc(w/2, h/2, r, 0, Math.PI*2);
    c.fill();
    c.strokeStyle = "rgba(20,16,8,0.6)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(w/2, h/2, r, 0, Math.PI*2);
    c.stroke();
  }
  function refreshBars() {
    const ch = state.character;
    if (!ch) return;
    const maxHp = ch.max_hp || 1;
    const maxMp = ch.mana_cap || 1;
    const maxSt = ch.stamina_cap || 1;
    const pct = (n, m) => Math.max(0, Math.min(100, (n / m) * 100));
    const hpPct = pct(state.cur.hp, maxHp);
    barHpFill.style.width = hpPct + "%";
    barMpFill.style.width = pct(state.cur.mp, maxMp) + "%";
    barStFill.style.width = pct(state.cur.st, maxSt) + "%";
    barHpNum.textContent = `${Math.round(state.cur.hp)}/${maxHp}`;
    barMpNum.textContent = `${Math.round(state.cur.mp)}/${maxMp}`;
    barStNum.textContent = `${Math.round(state.cur.st)}/${maxSt}`;
    // Pulse the HP bar when life is low — purely cosmetic until combat lands.
    barHpFill.parentElement.classList.toggle("is-low", hpPct < 30);
  }
  function setBadge(role) {
    rbServerName.textContent = "0 · Firstlight";
    rbMode.textContent = role === "admin" ? "Architect Mode" : "Player Mode";
  }
  function setPresence(n) {
    state.presence = n;
    presenceCt.textContent = n;
  }

  // Mini-map: 200×200 px, 1 px ≈ 1 tile, range ±100 tiles around self.
  // Re-renders at ~12Hz (capped) so we never spend 60fps walking the world's
  // painted-tile maps. Draws background + paint (faint) + cardinal cross +
  // other souls + self pip with a glow halo and facing tick.
  const MM_HALF = 100;
  let lastMinimapAt = 0;
  function renderMinimap() {
    const now = performance.now();
    if (now - lastMinimapAt < 80) return; // ~12 Hz cap
    lastMinimapAt = now;

    const w = minimap.width, h = minimap.height;
    const cx = w / 2, cy = h / 2;
    // Backplate
    minimapCtx.fillStyle = "#0c0e14";
    minimapCtx.fillRect(0, 0, w, h);

    // Center on the smoothed self position so the pip is rock-steady.
    const meRec = state.me ? state.renderPlayers.get(state.me.id) : null;
    const meX = meRec ? meRec.x : 0;
    const meY = meRec ? meRec.y : 0;

    // Faint painted-tile occupancy. Cap iterations so a fully-painted world
    // never becomes a perf cliff.
    if (state.world) {
      minimapCtx.fillStyle = "rgba(105, 145, 90, 0.42)";
      let drawn = 0;
      const cap = 6000;
      outer: for (const layer of state.world.layers) {
        for (const k in layer.tiles) {
          const c = k.indexOf(",");
          const tx = +k.slice(0, c), ty = +k.slice(c + 1);
          const dx = tx - meX, dy = ty - meY;
          if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
          minimapCtx.fillRect(cx + dx, cy + dy, 1, 1);
          if (++drawn >= cap) break outer;
        }
      }
    }

    // Cardinal cross + outer frame
    minimapCtx.strokeStyle = "rgba(217,166,74,0.22)";
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, 0); minimapCtx.lineTo(cx + 0.5, h);
    minimapCtx.moveTo(0, cy + 0.5); minimapCtx.lineTo(w, cy + 0.5);
    minimapCtx.stroke();

    // Other souls (3px square, race-tinted)
    for (const rec of state.renderPlayers.values()) {
      if (state.me && rec.id === state.me.id) continue;
      const dx = rec.x - meX, dy = rec.y - meY;
      if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      minimapCtx.fillStyle = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
      minimapCtx.fillRect(px - 1, py - 1, 3, 3);
    }

    if (!meRec) return;

    // Self pip — gold with a soft glow halo so it always reads against any
    // backdrop. This is the bit the user couldn't find before.
    const grd = minimapCtx.createRadialGradient(cx, cy, 0, cx, cy, 9);
    grd.addColorStop(0, "rgba(246,228,163,0.9)");
    grd.addColorStop(1, "rgba(246,228,163,0)");
    minimapCtx.fillStyle = grd;
    minimapCtx.fillRect(cx - 9, cy - 9, 18, 18);
    minimapCtx.fillStyle = "#fff7d8";
    minimapCtx.fillRect(cx - 2, cy - 2, 5, 5);
    minimapCtx.strokeStyle = "rgba(20,16,8,0.95)";
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(cx - 2.5, cy - 2.5, 6, 6);
    // Facing tick (fans out from the pip)
    const fdir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[meRec.facing] || [0, 1];
    minimapCtx.strokeStyle = "#fff7d8";
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, cy + 0.5);
    minimapCtx.lineTo(cx + 0.5 + fdir[0] * 8, cy + 0.5 + fdir[1] * 8);
    minimapCtx.stroke();
  }

  // ---- output meter ----
  function refreshOutput() {
    outFill.style.width = state.output + "%";
    outNum.textContent  = state.output + "%";
    // Glow the meter when the player is dialing back from full power so
    // the change is visible without staring at the number.
    outputBox.classList.toggle("is-charging", state.output < 100);
  }

  // ---- chat collapse ----
  function setChatCollapsed(c) {
    state.chatCollapsed = c;
    chatPanel.classList.toggle("is-collapsed", c);
    chatBody.hidden = c;
    chatCollapseGlyph.textContent = c ? "▴" : "▾";
  }
  chatHead.addEventListener("click", (e) => {
    e.preventDefault();
    setChatCollapsed(!state.chatCollapsed);
  });

  // ---- modal system --------------------------------------------------
  // Only one modal open at a time. Veil is shared. Esc closes the top-most
  // modal first, falling through to the standard editor/chat handling.
  let activeModal = null;
  function openModal(name) {
    const m = modals[name];
    if (!m) return;
    if (activeModal && activeModal !== name) closeModal();
    m.hidden = false;
    modalVeil.hidden = false;
    activeModal = name;
    // Light up the matching codex button.
    codexButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.modal === name));
    // Per-modal hooks (refresh content on open).
    if (name === "map") renderMapModal();
    if (name === "character") drawHudPortrait();
    // Close chat focus so keyboard shortcuts (Esc, etc.) work.
    if (isTypingInChat()) chatInput.blur();
  }
  function closeModal() {
    if (!activeModal) return;
    const m = modals[activeModal];
    if (m) m.hidden = true;
    modalVeil.hidden = true;
    codexButtons.forEach((b) => b.classList.remove("is-active"));
    activeModal = null;
  }
  function toggleModal(name) {
    if (activeModal === name) closeModal();
    else openModal(name);
  }
  // Codex buttons → open / toggle modal of the same name.
  codexButtons.forEach((b) => {
    b.addEventListener("click", () => toggleModal(b.dataset.modal));
  });
  // Atlas expand button → open the full Atlas modal.
  if (atlasExpand) atlasExpand.addEventListener("click", () => openModal("map"));
  // Veil click + ✕ buttons close the active modal.
  modalVeil.addEventListener("click", closeModal);
  document.querySelectorAll("[data-modal-close]").forEach((b) => {
    b.addEventListener("click", closeModal);
  });
  // Settings → leave button (mirror of crown leave).
  if (setLeaveBtn) setLeaveBtn.addEventListener("click", () => { closeModal(); leave(); });

  // Settings → live-bind controls to state where it matters.
  if (setZoom) {
    setZoom.addEventListener("input", () => {
      const z = Math.max(1, Math.min(6, +setZoom.value || 2));
      state.zoom = z;
      if (setZoomNum) setZoomNum.textContent = z;
    });
  }
  if (setVol) {
    setVol.addEventListener("input", () => {
      if (setVolNum) setVolNum.textContent = setVol.value;
    });
  }

  // ---- map modal renderer ---------------------------------------------
  // Same idea as renderMinimap but with a wider window (±200 tiles) and
  // per-tile zoom so the canvas stays full-resolution. Re-renders on open
  // and again whenever the player moves a tile while the modal is up.
  const MAP_HALF = 160;        // ±160 tiles each direction
  const MAP_SCALE = 2;         // 2px per world tile → 320×320 → fits 640×640
  function renderMapModal() {
    if (!modals.map || modals.map.hidden) return;
    const w = mapModalCanvas.width, h = mapModalCanvas.height;
    const cx = w / 2, cy = h / 2;
    const scale = MAP_SCALE;             // px per world tile
    mapModalCtx.fillStyle = "#0c0e14";
    mapModalCtx.fillRect(0, 0, w, h);
    const meRec = state.me ? state.renderPlayers.get(state.me.id) : null;
    const meX = meRec ? meRec.x : 0;
    const meY = meRec ? meRec.y : 0;

    // Painted ground
    if (state.world) {
      mapModalCtx.fillStyle = "rgba(105, 145, 90, 0.55)";
      let drawn = 0;
      const cap = 18000;
      outer: for (const layer of state.world.layers) {
        for (const k in layer.tiles) {
          const c = k.indexOf(",");
          const tx = +k.slice(0, c), ty = +k.slice(c + 1);
          const dx = tx - meX, dy = ty - meY;
          if (Math.abs(dx) > MAP_HALF || Math.abs(dy) > MAP_HALF) continue;
          mapModalCtx.fillRect(cx + dx * scale, cy + dy * scale, scale, scale);
          if (++drawn >= cap) break outer;
        }
      }
    }

    // Cardinal cross
    mapModalCtx.strokeStyle = "rgba(217,166,74,0.18)";
    mapModalCtx.lineWidth = 1;
    mapModalCtx.beginPath();
    mapModalCtx.moveTo(cx + 0.5, 0); mapModalCtx.lineTo(cx + 0.5, h);
    mapModalCtx.moveTo(0, cy + 0.5); mapModalCtx.lineTo(w, cy + 0.5);
    mapModalCtx.stroke();

    // Origin (0,0)
    const oxd = -meX, oyd = -meY;
    if (Math.abs(oxd) <= MAP_HALF && Math.abs(oyd) <= MAP_HALF) {
      const ox = cx + oxd * scale, oy = cy + oyd * scale;
      mapModalCtx.strokeStyle = "rgba(216,178,87,0.85)";
      mapModalCtx.lineWidth = 1;
      mapModalCtx.strokeRect(ox - 5, oy - 5, 10, 10);
    }

    // Other souls
    for (const rec of state.renderPlayers.values()) {
      if (state.me && rec.id === state.me.id) continue;
      const dx = rec.x - meX, dy = rec.y - meY;
      if (Math.abs(dx) > MAP_HALF || Math.abs(dy) > MAP_HALF) continue;
      mapModalCtx.fillStyle = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
      mapModalCtx.fillRect(cx + dx * scale - 1, cy + dy * scale - 1, scale + 2, scale + 2);
    }

    // Self pip with halo
    if (meRec) {
      const grd = mapModalCtx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      grd.addColorStop(0, "rgba(246,228,163,0.9)");
      grd.addColorStop(1, "rgba(246,228,163,0)");
      mapModalCtx.fillStyle = grd;
      mapModalCtx.fillRect(cx - 18, cy - 18, 36, 36);
      mapModalCtx.fillStyle = "#fff7d8";
      mapModalCtx.fillRect(cx - 3, cy - 3, 6, 6);
      mapModalCtx.strokeStyle = "rgba(20,16,8,0.9)";
      mapModalCtx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
    }

    // Footnotes
    if (mapPos) mapPos.textContent = state.me
      ? `(${Math.round(state.me.x)}, ${Math.round(state.me.y)})` : "(?, ?)";
    if (mapSouls) mapSouls.textContent = state.presence;
  }
  // Refresh while the modal is open so the player tracks movement.
  setInterval(() => { if (activeModal === "map") renderMapModal(); }, 250);

  // ---- in-realm shortcuts (M, C, I, K, J, H + Esc) ----------------------
  document.addEventListener("keydown", (e) => {
    if (realmEl.hidden) return;
    if (isTypingInChat()) return;          // typing → ignore shortcuts
    const key = (e.key || "").toLowerCase();

    if (e.key === "Escape") {
      if (activeModal) { closeModal(); e.preventDefault(); return; }
      // (editor close + chat blur are handled by the older Esc handler)
    }
    const SHORT = { m: "map", c: "character", i: "inventory",
                    k: "spellbook", j: "quests", h: "help" };
    if (SHORT[key]) {
      e.preventDefault();
      toggleModal(SHORT[key]);
    }
  });

  // ---- enter / leave ----
  async function enter({ role, character }) {
    state.role = role || "player";
    setBadge(state.role);
    realmEl.hidden = false;
    resize();
    refreshOutput();
    setChatCollapsed(state.chatCollapsed);
    // Kick off sprite loading in parallel with the character fetch so first
    // paint already has the admin's art ready when the welcome arrives.
    const spritesPromise = loadAdminSprites();
    if (character) applyCharacterToHud(character);
    else {
      try {
        const r = await api("/api/characters/me");
        if (r && r.character) applyCharacterToHud(r.character);
      } catch (err) { /* HUD will stay at "—" until next attempt */ }
    }
    if (!state.booted) {
      state.booted = true;
      chat("You step onto the plain grass.", "good");
      chat("Press T to speak. Click the chat header to fold it away.", "cmd");
      if (state.role === "admin") {
        chat("Architect: type /command we, /command world_edit, or /command server_edit to weave the world.", "cmd");
      }
      try { await loadWorld(); }
      catch (err) { chat("Failed to load world: " + err.message, "err"); }
    }
    await spritesPromise.catch(() => {});
    connectSocket();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function leave() {
    realmEl.hidden = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    state.keys.clear();
    closeEditor();
    disconnectSocket();
    window.dispatchEvent(new CustomEvent("freeform:leave-realm"));
  }
  leaveBtn.addEventListener("click", leave);

  // Best-effort goodbye when the tab closes — saves us a "ghost" player
  // hanging around until the server's tick notices the dead socket.
  window.addEventListener("beforeunload", () => {
    if (state.ws) try { state.ws.close(1000, "unload"); } catch {}
  });

  window.FreeformRealm = { enter, leave };

  // ---- DEV: ?hud-demo=1 — mount the HUD with a fake vessel so we can
  // sanity-check the layout without going through login. Safe to leave in
  // (only fires when the query string explicitly opts in). ------------
  if (typeof location !== "undefined" && /[?&]hud-demo=1\b/.test(location.search)) {
    window.addEventListener("DOMContentLoaded", () => {
      enter({
        role: "admin",
        character: {
          name: "Aerynd of Firstlight",
          race: null, race_name: "Architect",
          level: 7, xp: 1340,
          hp: 168, max_hp: 200,
          mana_cap: 220, stamina_cap: 140,
          control: 18, resistance: 12,
          cast_speed: 1.25, efficiency: 1.10,
          starting_weapon: "Free Hand",
        },
      }).catch(() => {});
    });
  }
})();
