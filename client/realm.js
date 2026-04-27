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
    cameraX: -16, cameraY: -10, // top-left of the canvas, in world tile coords
    keys: new Set(),            // currently held keys for panning
    tilesets: new Map(),        // name -> { meta, image }
    editor: { open: false, mode: "we", selected: null, brush: "paint", layer: "ground" },
    mouse: { x: 0, y: 0, tileX: 0, tileY: 0, leftDown: false, rightDown: false },
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
    // Plain speech — for now just echo it locally. Multi-player chat lands
    // when the WebSocket loop does.
    chat(raw, "");
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
    state.keys.add(e.key.toLowerCase());
  });
  document.addEventListener("keyup", (e) => {
    state.keys.delete(e.key.toLowerCase());
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

  function render() {
    const tilePx = state.tileSize * state.zoom;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cols = viewportTilesAcross();
    const rows = viewportTilesDown();

    // Background = procedural grass tiled across the viewport. This is the
    // "plain grass ground" the world starts as.
    if (!grassPattern) grassPattern = makeGrassPattern();
    for (let dy = 0; dy < rows; dy++) {
      for (let dx = 0; dx < cols; dx++) {
        ctx.drawImage(grassPattern, dx * tilePx, dy * tilePx, tilePx, tilePx);
      }
    }

    if (!state.world) return;

    // Painted layers, in array order (earliest first, latest on top).
    for (const layer of state.world.layers) {
      const isActive = state.editor.open && layer.name === state.editor.layer;
      ctx.globalAlpha = !state.editor.open || isActive ? 1 : 0.55;
      for (let dy = 0; dy < rows; dy++) {
        for (let dx = 0; dx < cols; dx++) {
          const wx = state.cameraX + dx;
          const wy = state.cameraY + dy;
          const ref = layer.tiles[`${wx},${wy}`];
          if (!ref) continue;
          drawTileRef(ref, dx * tilePx, dy * tilePx, tilePx);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Editor overlays: light grid + cursor highlight.
    if (state.editor.open) {
      drawGrid(cols, rows, tilePx);
      drawCursor(tilePx);
    }

    // Origin cross — easy reference point for admins navigating with WASD.
    drawOriginCross(tilePx);
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

  // ---- camera tick ----
  let lastTickTime = 0;
  function tick(now) {
    const dt = lastTickTime ? (now - lastTickTime) / 1000 : 0;
    lastTickTime = now;
    // 8 tiles per second of camera movement, scaled to whatever the user
    // is doing. Holding shift speeds it up.
    const speed = state.keys.has("shift") ? 24 : 8;
    let dx = 0, dy = 0;
    if (state.keys.has("w") || state.keys.has("arrowup"))    dy -= 1;
    if (state.keys.has("s") || state.keys.has("arrowdown"))  dy += 1;
    if (state.keys.has("a") || state.keys.has("arrowleft"))  dx -= 1;
    if (state.keys.has("d") || state.keys.has("arrowright")) dx += 1;
    if (dx || dy) {
      // Move by sub-tile fractions over time, then snap when accumulated.
      camAccumX += dx * speed * dt;
      camAccumY += dy * speed * dt;
      const snapX = Math.trunc(camAccumX);
      const snapY = Math.trunc(camAccumY);
      if (snapX) { state.cameraX += snapX; camAccumX -= snapX; }
      if (snapY) { state.cameraY += snapY; camAccumY -= snapY; }
    }
    render();
    raf = requestAnimationFrame(tick);
  }
  let camAccumX = 0, camAccumY = 0;
  let raf = 0;

  // ---- enter / leave ----
  async function enter({ role }) {
    state.role = role || "player";
    realmEl.hidden = false;
    resize();
    if (!state.booted) {
      state.booted = true;
      chat("You step onto the plain grass.", "good");
      if (state.role === "admin") {
        chat("Architect: type /command we, /command world_edit, or /command server_edit to weave the world.", "cmd");
      }
      try { await loadWorld(); }
      catch (err) { chat("Failed to load world: " + err.message, "err"); }
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function leave() {
    realmEl.hidden = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    state.keys.clear();
    closeEditor();
    window.dispatchEvent(new CustomEvent("freeform:leave-realm"));
  }
  leaveBtn.addEventListener("click", leave);

  window.FreeformRealm = { enter, leave };
})();
