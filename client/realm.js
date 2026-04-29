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
    me: null,                   // { id, name, x, y, facing, isAdmin, race }
    others: new Map(),          // id -> { id, name, x, y, facing, anim, isAdmin, race }
    ws: null,
    wsReady: false,
    lastInputSent: { dx: 0, dy: 0, sprint: false, facing: "down", t: 0 },
    inputDirty: false,
    serverTickHz: 20,
    presence: 1,
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
    if (!raw.trim()) return;
    chatInput.value = "";
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
    if (e.key === "Enter" && !isTypingInChat()) {
      // Quick chat focus — feels game-y.
      e.preventDefault();
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
    coordsEl.textContent = `(${x}, ${y})`;
    // Drag-paint: holding the mouse button while moving keeps painting.
    if (state.editor.open && state.role === "admin") {
      if (state.mouse.leftDown)  paintAt(x, y, false);
      if (state.mouse.rightDown) paintAt(x, y, true);
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    const next = Math.max(1, Math.min(6, state.zoom + dir));
    if (next !== state.zoom) state.zoom = next;
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
  function openEditor(mode) {
    state.editor.open = true;
    state.editor.mode = mode;
    paletteMode.textContent = mode;
    editModeEl.textContent = mode;
    editFlag.hidden = false;
    paletteEl.hidden = false;
    canvas.style.cursor = "crosshair";
    chat(`Editor open — /${mode}. Pick a tile, click world to paint, right-click to erase.`, "cmd");
    ensureTilesetsLoaded();
  }
  function closeEditor() {
    state.editor.open = false;
    paletteEl.hidden = true;
    editFlag.hidden = true;
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

    // Other players first, then self on top.
    for (const p of state.others.values()) drawPlayer(p, tilePx, false);
    if (state.me) drawPlayer(state.me, tilePx, true);

    // Editor overlays: light grid + cursor highlight.
    if (state.editor.open) {
      drawGrid(cols, rows, tilePx);
      drawCursor(tilePx);
    }

    // Origin cross — easy reference point for admins navigating with WASD.
    drawOriginCross(tilePx);
  }

  // Each player is a glowing circle for now (sprites land when player race
  // sheets are uploaded). Admins get a gold ring; others get a race-tinted
  // body. Name plate floats above the head.
  const RACE_COLOR = {
    human: "#f4d499", orc: "#7fe39a", elf: "#b9e6e6",
    crystalline: "#cfe4ff", voidborn: "#caa6ff",
  };
  function drawPlayer(p, tilePx, isSelf) {
    const { sx, sy } = worldToScreen(p.x, p.y, tilePx);
    const cx = sx + tilePx / 2;
    const cy = sy + tilePx / 2;
    const r  = tilePx * 0.42;
    const fill = p.isAdmin ? "#f6e4a3" : (RACE_COLOR[p.race] || "#cfe4ff");
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // ring (admin = thicker gold, self = thin gold, others = dim)
    ctx.lineWidth = isSelf ? 2.5 : 1.5;
    ctx.strokeStyle = p.isAdmin ? "#f6e4a3" : (isSelf ? "rgba(246,228,163,0.9)" : "rgba(0,0,0,0.55)");
    ctx.beginPath();
    ctx.arc(cx, cy, r + (isSelf ? 1 : 0), 0, Math.PI * 2);
    ctx.stroke();
    // facing tick
    const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [fx, fy] = dirs[p.facing] || [0, 1];
    ctx.strokeStyle = "rgba(20,16,8,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + fx * r * 0.85, cy + fy * r * 0.85);
    ctx.stroke();
    // name plate
    const label = p.name + (p.isAdmin ? " ✦" : "");
    ctx.font = "600 12px 'Cinzel', 'Cormorant Garamond', serif";
    const w = ctx.measureText(label).width + 10;
    const ny = cy - r - 14;
    ctx.fillStyle = "rgba(10,10,18,0.78)";
    ctx.fillRect(cx - w / 2, ny, w, 16);
    ctx.fillStyle = isSelf ? "#f6e4a3" : "#e3dcc7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, ny + 8);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
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
    const dt = lastTickTime ? (now - lastTickTime) / 1000 : 0;
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
      // While editing, pause input transmission so the player avatar stays put.
      if (state.wsReady && (state.lastInputSent.dx || state.lastInputSent.dy)) {
        state.lastInputSent.dx = 0; state.lastInputSent.dy = 0;
        try { state.ws.send(JSON.stringify({ type: "input", dx: 0, dy: 0, sprint: false, facing: state.lastInputSent.facing })); } catch {}
      }
    } else {
      // Player mode: send input, camera follows our authoritative position.
      maybeSendInput();
      if (state.me) {
        const tilePx = state.tileSize * state.zoom;
        const cols = window.innerWidth  / tilePx;
        const rows = window.innerHeight / tilePx;
        state.cameraX = state.me.x - cols / 2 + 0.5;
        state.cameraY = state.me.y - rows / 2 + 0.5;
      }
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
        for (const o of msg.others || []) state.others.set(o.id, o);
        setPresence(state.others.size + 1);
        chat(`Shard "${msg.shard}" — ${state.others.size} other ${state.others.size === 1 ? "soul" : "souls"} present.`, "cmd");
        break;
      case "join":
        if (msg.player && msg.player.id !== state.me?.id) {
          state.others.set(msg.player.id, msg.player);
          setPresence(state.others.size + 1);
        }
        break;
      case "leave":
        state.others.delete(msg.id);
        setPresence(state.others.size + (state.me ? 1 : 0));
        break;
      case "state":
        for (const p of msg.players || []) {
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
        // Snapshot's player count is the truth — keep the HUD in lockstep.
        setPresence((msg.players || []).length);
        break;
      case "chat":
        if (msg.kind === "system") chat(msg.text, "cmd");
        else if (msg.from) {
          const tag = msg.from.isAdmin ? "✦ " : "";
          chat(`${tag}${msg.from.name}: ${msg.text}`,
               msg.from.id === state.me?.id ? "self" : "");
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
    barHpFill.style.width = pct(state.cur.hp, maxHp) + "%";
    barMpFill.style.width = pct(state.cur.mp, maxMp) + "%";
    barStFill.style.width = pct(state.cur.st, maxSt) + "%";
    barHpNum.textContent = `${Math.round(state.cur.hp)}/${maxHp}`;
    barMpNum.textContent = `${Math.round(state.cur.mp)}/${maxMp}`;
    barStNum.textContent = `${Math.round(state.cur.st)}/${maxSt}`;
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
  // Draws painted-tile occupancy (faint), then other souls (race-tinted),
  // then self at the exact center as a gold pip with a facing tick.
  const MM_HALF = 80;
  function renderMinimap() {
    const w = minimap.width, h = minimap.height;
    minimapCtx.fillStyle = "#0c0e14";
    minimapCtx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const me = state.me;
    if (!me) return;
    // Faint paint occupancy (only the active "ground" + "decor" layers).
    if (state.world) {
      minimapCtx.fillStyle = "rgba(95, 130, 80, 0.35)";
      for (const layer of state.world.layers) {
        for (const k in layer.tiles) {
          const c = k.indexOf(",");
          const tx = +k.slice(0, c), ty = +k.slice(c + 1);
          const dx = tx - me.x, dy = ty - me.y;
          if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
          minimapCtx.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    }
    // Cardinal cross + frame
    minimapCtx.strokeStyle = "rgba(217,166,74,0.18)";
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, 0); minimapCtx.lineTo(cx + 0.5, h);
    minimapCtx.moveTo(0, cy + 0.5); minimapCtx.lineTo(w, cy + 0.5);
    minimapCtx.stroke();
    // Other souls
    for (const o of state.others.values()) {
      const dx = o.x - me.x, dy = o.y - me.y;
      if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      minimapCtx.fillStyle = o.isAdmin ? "#f6e4a3" : (RACE_COLOR[o.race] || "#cfe4ff");
      minimapCtx.fillRect(px - 1, py - 1, 3, 3);
    }
    // Self pip (slightly larger, gold)
    minimapCtx.fillStyle = "#f6e4a3";
    minimapCtx.fillRect(cx - 2, cy - 2, 4, 4);
    minimapCtx.strokeStyle = "rgba(20,16,8,0.85)";
    minimapCtx.strokeRect(cx - 2.5, cy - 2.5, 5, 5);
    // Facing tick
    const fdir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[me.facing] || [0, 1];
    minimapCtx.strokeStyle = "#f6e4a3";
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, cy + 0.5);
    minimapCtx.lineTo(cx + 0.5 + fdir[0] * 6, cy + 0.5 + fdir[1] * 6);
    minimapCtx.stroke();
  }

  // ---- enter / leave ----
  async function enter({ role, character }) {
    state.role = role || "player";
    setBadge(state.role);
    realmEl.hidden = false;
    resize();
    // If the host page handed us the character row, use it immediately so
    // the HUD has values on first paint. Otherwise pull it ourselves.
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
      if (state.role === "admin") {
        chat("Architect: type /command we, /command world_edit, or /command server_edit to weave the world.", "cmd");
      }
      try { await loadWorld(); }
      catch (err) { chat("Failed to load world: " + err.message, "err"); }
    }
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
