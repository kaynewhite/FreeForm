(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const SHARD = "default";

  const stage = $("#world-stage");
  const canvas = $("#world-canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const layerSelect = $("#layer-select");
  const zoomInput = $("#zoom");
  const zoomOut = $("#zoom-out");
  const gridToggle = $("#grid-toggle");
  const coordsToggle = $("#coords-toggle");
  const hoverReadout = $("#hover-readout");
  const paletteEl = $("#palette");
  const selectedReadout = $("#selected-readout");
  const statusMsg = $("#status-msg");
  const paintStatus = $("#paint-status");
  $("#shard-name").textContent = SHARD;

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
  function setStatus(text, isError = false) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("is-good", !isError && !!text);
  }
  let paintStatusTimer = 0;
  function flashPaintStatus(text) {
    paintStatus.textContent = text;
    clearTimeout(paintStatusTimer);
    paintStatusTimer = window.setTimeout(() => { paintStatus.textContent = ""; }, 1200);
  }

  // ---- state ----
  const state = {
    world: null,                // { layers: [{name, tiles}], tileSize, ... }
    tileSize: 16,               // world canvas grid tile size (px in world coords)
    zoom: 2,                    // multiplier
    cameraX: 0,                 // world-coord top-left of canvas, in tile units
    cameraY: 0,
    layer: "ground",
    selected: null,             // { tileset, tileId } or null
    tilesets: new Map(),        // name -> { meta, image (HTMLImageElement) }
  };

  // ---- camera & sizing ----
  function tilesAcross() {
    return Math.ceil(canvas.width / (state.tileSize * state.zoom));
  }
  function tilesDown() {
    return Math.ceil(canvas.height / (state.tileSize * state.zoom));
  }
  function recenter() {
    state.cameraX = -Math.floor(tilesAcross() / 2);
    state.cameraY = -Math.floor(tilesDown() / 2);
    redraw();
  }
  function fitCanvasToStage() {
    const rect = stage.getBoundingClientRect();
    canvas.width = Math.max(200, Math.floor(rect.width));
    canvas.height = Math.max(200, Math.floor(rect.height));
    redraw();
  }

  // ---- pan via middle-button / shift+drag ----
  let panning = null;
  stage.addEventListener("mousedown", (e) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      panning = { startX: e.clientX, startY: e.clientY, camX: state.cameraX, camY: state.cameraY };
      e.preventDefault();
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    const dx = e.clientX - panning.startX;
    const dy = e.clientY - panning.startY;
    const tilePx = state.tileSize * state.zoom;
    state.cameraX = panning.camX - Math.round(dx / tilePx);
    state.cameraY = panning.camY - Math.round(dy / tilePx);
    redraw();
  });
  window.addEventListener("mouseup", () => { panning = null; });

  // ---- click to paint, right-click to erase ----
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
  canvas.addEventListener("mousedown", async (e) => {
    if (panning) return;
    if (e.shiftKey) return; // shift+drag is panning
    if (e.button !== 0 && e.button !== 2) return;
    const erasing = e.button === 2;
    const { x, y } = eventToTileCoords(e);
    if (!erasing && !state.selected) {
      setStatus("Pick a tile from the palette first.", true);
      return;
    }
    setStatus("");
    const tile = erasing ? null : `${state.selected.tileset}:${state.selected.tileId}`;
    // Optimistic local update so the click feels instant.
    const layer = state.world.layers.find((l) => l.name === state.layer);
    if (!layer) return;
    const key = `${x},${y}`;
    const prev = layer.tiles[key];
    if (tile === null) delete layer.tiles[key];
    else layer.tiles[key] = tile;
    redraw();
    try {
      await api(`/api/world/${SHARD}/paint`, {
        method: "POST",
        body: JSON.stringify({ layer: state.layer, tiles: [{ x, y, tile }] }),
      });
      flashPaintStatus(erasing ? "Erased" : "Painted");
    } catch (err) {
      // Roll back the optimistic write so the on-screen state matches the file.
      if (prev !== undefined) layer.tiles[key] = prev;
      else delete layer.tiles[key];
      redraw();
      setStatus("Paint failed: " + err.message, true);
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = eventToTileCoords(e);
    const layer = state.world?.layers.find((l) => l.name === state.layer);
    const cur = layer?.tiles[`${x},${y}`];
    hoverReadout.textContent = `(${x}, ${y})${cur ? "  ·  " + cur : ""}`;
  });
  canvas.addEventListener("mouseleave", () => { hoverReadout.textContent = "—"; });

  // ---- toolbar ----
  zoomInput.addEventListener("input", () => {
    state.zoom = Number(zoomInput.value);
    zoomOut.value = state.zoom + "x";
    redraw();
  });
  gridToggle.addEventListener("change", redraw);
  coordsToggle.addEventListener("change", redraw);
  layerSelect.addEventListener("change", () => {
    state.layer = layerSelect.value;
    redraw();
  });
  $("#recenter-btn").addEventListener("click", recenter);
  $("#clear-layer-btn").addEventListener("click", async () => {
    if (!confirm(`Clear every tile on layer "${state.layer}"? This cannot be undone.`)) return;
    try {
      await api(`/api/world/${SHARD}/clear-layer`, {
        method: "POST",
        body: JSON.stringify({ layer: state.layer }),
      });
      const layer = state.world.layers.find((l) => l.name === state.layer);
      if (layer) layer.tiles = {};
      redraw();
      flashPaintStatus("Layer cleared");
    } catch (err) {
      setStatus("Clear failed: " + err.message, true);
    }
  });

  // ---- rendering ----
  function redraw() {
    if (!state.world) return;
    const tilePx = state.tileSize * state.zoom;
    const cols = tilesAcross();
    const rows = tilesDown();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw layers in array order — earliest first, latest on top.
    for (const layer of state.world.layers) {
      const isActive = layer.name === state.layer;
      ctx.globalAlpha = isActive ? 1 : 0.45;
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

    if (gridToggle.checked) drawGrid(cols, rows, tilePx);
    if (coordsToggle.checked) drawCoords(cols, rows, tilePx);
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
    const sx = meta.margin + col * (meta.tileWidth + meta.spacing);
    const sy = meta.margin + row * (meta.tileHeight + meta.spacing);
    ctx.drawImage(ts.image, sx, sy, meta.tileWidth, meta.tileHeight, dx, dy, tilePx, tilePx);
  }
  function drawGrid(cols, rows, tilePx) {
    ctx.strokeStyle = "rgba(217,166,74,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let dx = 0; dx <= cols; dx++) {
      const x = dx * tilePx + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows * tilePx);
    }
    for (let dy = 0; dy <= rows; dy++) {
      const y = dy * tilePx + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(cols * tilePx, y);
    }
    ctx.stroke();
  }
  function drawCoords(cols, rows, tilePx) {
    if (tilePx < 28) return; // too small to read anyway
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `${Math.max(8, Math.floor(tilePx * 0.28))}px monospace`;
    ctx.textBaseline = "top";
    for (let dy = 0; dy < rows; dy++) {
      for (let dx = 0; dx < cols; dx++) {
        const wx = state.cameraX + dx;
        const wy = state.cameraY + dy;
        ctx.fillText(`${wx},${wy}`, dx * tilePx + 2, dy * tilePx + 2);
      }
    }
  }
  function drawOriginCross(tilePx) {
    // Make (0,0) easy to find — tiny gold cross at the world origin tile.
    const ox = (0 - state.cameraX) * tilePx;
    const oy = (0 - state.cameraY) * tilePx;
    if (ox + tilePx < 0 || oy + tilePx < 0 || ox > canvas.width || oy > canvas.height) return;
    ctx.strokeStyle = "rgba(246,228,163,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + tilePx / 2, oy + 2);
    ctx.lineTo(ox + tilePx / 2, oy + tilePx - 2);
    ctx.moveTo(ox + 2, oy + tilePx / 2);
    ctx.lineTo(ox + tilePx - 2, oy + tilePx / 2);
    ctx.stroke();
  }

  // ---- palette ----
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + url));
      img.src = url;
    });
  }
  async function loadTilesets() {
    let body;
    try { body = await api("/api/world/_/tilesets"); }
    catch (err) {
      paletteEl.textContent = "Failed to load tilesets: " + err.message;
      return;
    }
    const tilesets = body.tilesets || [];
    if (!tilesets.length) {
      paletteEl.innerHTML = `<p class="muted small">No tilesets uploaded yet. Add some in <a class="link-btn" href="/maps.html">Tileset Library</a>.</p>`;
      return;
    }
    paletteEl.innerHTML = "";
    for (const ts of tilesets) {
      try {
        const img = await loadImage(ts.imageUrl);
        state.tilesets.set(ts.name, { meta: ts, image: img });
        renderPaletteEntry(ts, img);
      } catch (err) {
        const div = document.createElement("div");
        div.className = "palette-tileset";
        div.innerHTML = `<div class="palette-head"><span class="name">${ts.name}</span><span class="meta">image failed to load: ${err.message}</span></div>`;
        paletteEl.appendChild(div);
      }
    }
    // After tilesets are loaded, redraw the world so existing tiles appear.
    redraw();
  }
  function renderPaletteEntry(meta, img) {
    const wrap = document.createElement("div");
    wrap.className = "palette-tileset";
    wrap.innerHTML = `
      <div class="palette-head">
        <span class="name">${meta.name}</span>
        <span class="meta">${meta.tileWidth}×${meta.tileHeight} · ${meta.tileCount} tiles · ${meta.columns} cols</span>
      </div>
      <div class="palette-stage">
        <canvas></canvas>
        <div class="selection"></div>
      </div>`;
    paletteEl.appendChild(wrap);
    const stageEl = wrap.querySelector(".palette-stage");
    const cv = wrap.querySelector("canvas");
    const sel = wrap.querySelector(".selection");
    const PALETTE_ZOOM = 2;
    cv.width = meta.imageWidth * PALETTE_ZOOM;
    cv.height = meta.imageHeight * PALETTE_ZOOM;
    const pctx = cv.getContext("2d");
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(img, 0, 0, meta.imageWidth, meta.imageHeight, 0, 0, cv.width, cv.height);
    // Grid overlay so the click targets are obvious.
    pctx.strokeStyle = "rgba(255,255,255,0.18)";
    pctx.lineWidth = 1;
    pctx.beginPath();
    for (let c = 0; c <= meta.columns; c++) {
      const x = (meta.margin + c * (meta.tileWidth + meta.spacing)) * PALETTE_ZOOM + 0.5;
      pctx.moveTo(x, 0); pctx.lineTo(x, cv.height);
    }
    const rows = Math.ceil(meta.tileCount / meta.columns);
    for (let r = 0; r <= rows; r++) {
      const y = (meta.margin + r * (meta.tileHeight + meta.spacing)) * PALETTE_ZOOM + 0.5;
      pctx.moveTo(0, y); pctx.lineTo(cv.width, y);
    }
    pctx.stroke();

    cv.addEventListener("click", (e) => {
      const rect = cv.getBoundingClientRect();
      const px = (e.clientX - rect.left) / PALETTE_ZOOM;
      const py = (e.clientY - rect.top) / PALETTE_ZOOM;
      const col = Math.floor((px - meta.margin) / (meta.tileWidth + meta.spacing));
      const row = Math.floor((py - meta.margin) / (meta.tileHeight + meta.spacing));
      if (col < 0 || col >= meta.columns || row < 0) return;
      const id = row * meta.columns + col;
      if (id >= meta.tileCount) return;
      // Clear other selections, mark this one.
      paletteEl.querySelectorAll(".selection").forEach((s) => s.style.display = "none");
      sel.style.left = (meta.margin + col * (meta.tileWidth + meta.spacing)) * PALETTE_ZOOM + "px";
      sel.style.top = (meta.margin + row * (meta.tileHeight + meta.spacing)) * PALETTE_ZOOM + "px";
      sel.style.width = meta.tileWidth * PALETTE_ZOOM + "px";
      sel.style.height = meta.tileHeight * PALETTE_ZOOM + "px";
      sel.style.display = "block";
      state.selected = { tileset: meta.name, tileId: id };
      selectedReadout.textContent = `${meta.name}:${id}`;
    });
  }

  // ---- boot ----
  async function boot() {
    try {
      const body = await api(`/api/world/${SHARD}`);
      state.world = body.world;
      state.tileSize = state.world.tileSize || 16;
    } catch (err) {
      setStatus("Failed to load shard: " + err.message + ". Are you logged in as admin?", true);
      return;
    }
    layerSelect.innerHTML = "";
    for (const l of state.world.layers) {
      const opt = document.createElement("option");
      opt.value = l.name;
      opt.textContent = l.name;
      layerSelect.appendChild(opt);
    }
    state.layer = state.world.layers[0]?.name || "ground";
    layerSelect.value = state.layer;
    fitCanvasToStage();
    recenter();
    await loadTilesets();
  }

  window.addEventListener("resize", fitCanvasToStage);
  boot();
})();
