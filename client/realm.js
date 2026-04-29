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
    // We keep current_hp/mp/stamina locally as floats and clamp on render.
    // The server doesn't push these yet — combat/regen lands in a later
    // slice — so they sit pinned at max for now. The rest of the fields
    // come straight from the API row and are read-only during the session.
    character: null,
    cur: { hp: 0, mp: 0, st: 0 },

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
    // Speech bubbles last so they sit on top of every avatar.
    for (const rec of recs) drawBubble(rec, tilePx);

    // Editor overlays: light grid + cursor highlight.
    if (state.editor.open) {
      drawGrid(cols, rows, tilePx);
      drawCursor(tilePx);
    }

    // Origin cross — easy reference point for admins navigating with WASD.
    drawOriginCross(tilePx);
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
      case "goodbye":
        chat("Server: " + (msg.reason || "disconnected"), "err");
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
    statsRace.textContent  = isAdmin ? "Architect" : (ch.race_name || ch.race || "—");
    statsRace.classList.toggle("is-admin", isAdmin);
    statsXp.textContent    = ch.xp ?? 0;
    statsCtrl.textContent  = ch.control ?? 10;
    statsRes.textContent   = `${ch.resistance ?? 0}%`;
    const weapon = ch.starting_weapon || (isAdmin ? "Free Hand" : "—");
    hbWeaponName.textContent = weapon;
    hbWeaponIcon.textContent = WEAPON_ICON[weapon] || "⚔";
    refreshBars();
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

  // Mini-map: 160×160 px, 1 px ≈ 1 tile, range ±80 tiles around self.
  // Re-renders at ~12Hz (capped) so we never spend 60fps walking the world's
  // painted-tile maps. Draws background + paint (faint) + cardinal cross +
  // other souls + self pip with a glow halo and facing tick.
  const MM_HALF = 80;
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
})();
