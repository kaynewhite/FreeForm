(() => {
  const $ = (s, r = document) => r.querySelector(s);

  // ----- DOM -----
  const uploadForm = $("#upload-form");
  const uploadName = $("#upload-name");
  const uploadFiles = $("#upload-files");
  const uploadMsg = $("#upload-msg");
  const mapList = $("#map-list");
  const viewerSection = $("#viewer-section");
  const viewerTitle = $("#viewer-title");
  const viewerMeta = $("#viewer-meta");
  const viewerZoom = $("#viewer-zoom");
  const viewerGrid = $("#viewer-grid");
  const viewerIds = $("#viewer-ids");
  const viewerClose = $("#viewer-close");
  const viewerTileInfo = $("#viewer-tile-info");
  const mapCanvas = $("#map-canvas");
  const mapStage = $("#map-stage");
  const statusMsg = $("#status-msg");

  function setStatus(text, good = false) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("is-good", !!good);
  }
  function setUploadMsg(text, good = false) {
    uploadMsg.textContent = text || "";
    uploadMsg.classList.toggle("is-good", !!good);
  }

  // ----- API helpers -----
  async function listMaps() {
    const r = await fetch("/api/maps", { credentials: "same-origin" });
    if (r.status === 401 || r.status === 403) {
      setStatus("Admins only — log in as the admin to view this page.");
      return null;
    }
    if (!r.ok) { setStatus("Failed to load tilesets."); return null; }
    return (await r.json()).maps || [];
  }

  async function uploadMap(name, files) {
    const fd = new FormData();
    fd.append("name", name);
    for (const f of files) fd.append("files", f, f.name);
    const r = await fetch("/api/maps/upload", {
      method: "POST",
      credentials: "same-origin",
      body: fd,
    });
    return r.json().then((b) => ({ ok: r.ok, body: b }));
  }

  async function deleteMap(name) {
    const r = await fetch(`/api/maps/${encodeURIComponent(name)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return r.ok;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function formatSize(b) {
    if (b < 1024) return `${b}B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
    return `${(b / 1048576).toFixed(2)}MB`;
  }

  // ----- list rendering -----
  function renderMapList(maps) {
    mapList.innerHTML = "";
    if (!maps.length) {
      mapList.innerHTML = `<p class="ctrl-hint">No tilesets uploaded yet.</p>`;
      return;
    }
    for (const m of maps) {
      const card = document.createElement("div");
      card.className = "map-card";
      card.dataset.name = m.name;

      const tsxFiles = m.files.filter((f) => f.ext === "tsx");
      const head = document.createElement("div");
      head.className = "map-card-head";
      head.innerHTML = `
        <h3 class="map-card-name">${escapeHtml(m.name)}</h3>
        <div class="map-card-actions">
          ${tsxFiles.map((f) => `<button type="button" data-act="view" data-file="${escapeHtml(f.name)}">View ${escapeHtml(f.name)}</button>`).join("")}
          <button type="button" class="danger" data-act="delete">Delete tileset</button>
        </div>
      `;

      const files = document.createElement("ul");
      files.className = "map-files";
      for (const f of m.files) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="ext ${f.ext}">${f.ext}</span>${escapeHtml(f.name)} <span style="color:var(--ink-mute);">(${formatSize(f.size)})</span>`;
        files.appendChild(li);
      }

      card.append(head, files);
      mapList.appendChild(card);

      head.querySelectorAll('button[data-act="view"]').forEach((btn) => {
        btn.addEventListener("click", () => openViewer(m.name, btn.dataset.file));
      });
      head.querySelector('button[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`Truly delete "${m.name}" and all its files? This cannot be undone.`)) return;
        const ok = await deleteMap(m.name);
        if (ok) {
          if (currentTileset?.mapName === m.name) closeViewer();
          await refresh();
          setStatus(`Deleted ${m.name}.`, true);
          setTimeout(() => setStatus(""), 1600);
        } else {
          setStatus(`Failed to delete ${m.name}.`);
        }
      });
    }
  }

  // ----- upload form -----
  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setUploadMsg("");
    const name = uploadName.value.trim();
    const files = Array.from(uploadFiles.files || []);
    if (!name || !files.length) {
      setUploadMsg("Pick a name and at least one file.");
      return;
    }
    // Friendly client-side check — server validates again.
    const hasTsx = files.some((f) => /\.tsx$/i.test(f.name));
    const hasImg = files.some((f) => /\.(png|jpe?g)$/i.test(f.name));
    if (!hasTsx || !hasImg) {
      setUploadMsg("Upload needs a .tsx file plus at least one .png or .jpg image.");
      return;
    }

    const btn = uploadForm.querySelector("button.primary");
    btn.disabled = true;
    const { ok, body } = await uploadMap(name, files);
    btn.disabled = false;
    if (!ok) { setUploadMsg(body?.error || "Upload failed."); return; }
    setUploadMsg(`Uploaded ${body.written.length} file(s) to "${name}".`, true);
    uploadFiles.value = "";
    await refresh();
  });

  // ----- TSX viewer -----
  // currentTileset = {
  //   mapName, tsxFile, name (from <tileset name>),
  //   tileWidth, tileHeight, columns, rows, tileCount, firstgid (if known),
  //   image, imageWidth, imageHeight, spacing, margin
  // }
  let currentTileset = null;
  let hoverTile = -1;

  function closeViewer() {
    currentTileset = null;
    hoverTile = -1;
    viewerSection.hidden = true;
    document.querySelectorAll(".map-card.is-active").forEach((el) => el.classList.remove("is-active"));
  }
  viewerClose.addEventListener("click", closeViewer);
  viewerZoom.addEventListener("input", () => { if (currentTileset) renderTileset(); });
  viewerGrid.addEventListener("change", () => { if (currentTileset) renderTileset(); });
  viewerIds.addEventListener("change", () => { if (currentTileset) renderTileset(); });

  async function openViewer(mapName, tsxFile) {
    setStatus("");
    document.querySelectorAll(".map-card.is-active").forEach((el) => el.classList.remove("is-active"));
    document.querySelector(`.map-card[data-name="${CSS.escape(mapName)}"]`)?.classList.add("is-active");
    viewerSection.hidden = false;
    viewerTitle.textContent = `${mapName} / ${tsxFile}`;
    viewerMeta.textContent = "Loading TSX…";
    viewerTileInfo.textContent = "Hover or click a tile to see its ID.";
    try {
      const doc = await fetchXml(fileUrl(mapName, tsxFile));
      const root = doc.documentElement;
      if (root.tagName !== "tileset") throw new Error("Not a Tiled .tsx (root is not <tileset>).");

      const name       = root.getAttribute("name") || tsxFile;
      const tileWidth  = parseInt(root.getAttribute("tilewidth"),  10);
      const tileHeight = parseInt(root.getAttribute("tileheight"), 10);
      let columns      = parseInt(root.getAttribute("columns"),  10) || 0;
      let tileCount    = parseInt(root.getAttribute("tilecount"), 10) || 0;
      const spacing    = parseInt(root.getAttribute("spacing"),  10) || 0;
      const margin     = parseInt(root.getAttribute("margin"),   10) || 0;

      const imgEl = root.querySelector("image");
      if (!imgEl) throw new Error("Tileset has no <image> element.");
      const image = await loadImage(fileUrl(mapName, imgEl.getAttribute("source")));
      const imageWidth  = parseInt(imgEl.getAttribute("width"),  10) || image.naturalWidth;
      const imageHeight = parseInt(imgEl.getAttribute("height"), 10) || image.naturalHeight;

      // Derive columns/rows from image dimensions if TSX didn't say.
      if (!columns) {
        columns = Math.max(1, Math.floor((imageWidth - 2 * margin + spacing) / (tileWidth + spacing)));
      }
      const rows = Math.max(1, Math.floor((imageHeight - 2 * margin + spacing) / (tileHeight + spacing)));
      if (!tileCount) tileCount = columns * rows;

      currentTileset = {
        mapName, tsxFile, name,
        tileWidth, tileHeight, columns, rows, tileCount,
        spacing, margin,
        image, imageWidth, imageHeight,
      };
      hoverTile = -1;
      renderTileset();
    } catch (err) {
      console.error("[tilesets] viewer failed:", err);
      viewerMeta.textContent = `Failed to load: ${err.message}`;
    }
  }

  function fileUrl(mapName, file) {
    // TSX <image source="…"> can be relative; we only support same-folder
    // refs (basename only).
    const base = (file || "").split(/[\\/]/).pop();
    return `/api/maps/file/${encodeURIComponent(mapName)}/${encodeURIComponent(base)}`;
  }

  async function fetchXml(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error(`XML parse error in ${url}`);
    return doc;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image ${url}`));
      img.src = url;
    });
  }

  // ----- canvas render -----
  // Tile id is local to this tileset (0-based). When the tileset is referenced
  // from a TMX, its global id (gid) will be `firstgid + localId`. The local id
  // is what we display so admins can refer to tiles unambiguously inside the
  // /command we and /command server_edit workflows.
  function tileSrcRect(t, idx) {
    const cx = idx % t.columns;
    const cy = Math.floor(idx / t.columns);
    return {
      sx: t.margin + cx * (t.tileWidth + t.spacing),
      sy: t.margin + cy * (t.tileHeight + t.spacing),
      sw: t.tileWidth,
      sh: t.tileHeight,
    };
  }

  function renderTileset() {
    const t = currentTileset;
    if (!t) return;
    const zoom = parseInt(viewerZoom.value, 10) || 1;
    const w = t.imageWidth;
    const h = t.imageHeight;

    mapCanvas.width = w;
    mapCanvas.height = h;
    mapCanvas.style.width = `${w * zoom}px`;
    mapCanvas.style.height = `${h * zoom}px`;
    const ctx = mapCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(t.image, 0, 0);

    if (viewerGrid.checked) {
      ctx.strokeStyle = "rgba(246, 228, 163, 0.45)";
      ctx.lineWidth = 1;
      for (let i = 0; i < t.tileCount; i++) {
        const r = tileSrcRect(t, i);
        ctx.strokeRect(r.sx + 0.5, r.sy + 0.5, r.sw - 1, r.sh - 1);
      }
    }

    if (viewerIds.checked) {
      // Only draw IDs when zoomed enough that the text actually fits.
      const fontPx = Math.max(8, Math.min(t.tileWidth, t.tileHeight) - 2);
      ctx.font = `bold ${fontPx}px monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < t.tileCount; i++) {
        const r = tileSrcRect(t, i);
        const label = String(i);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(r.sx, r.sy, ctx.measureText(label).width + 4, fontPx);
        ctx.fillStyle = "#ffd76b";
        ctx.fillText(label, r.sx + 2, r.sy);
      }
    }

    // Hover/click highlight.
    if (hoverTile >= 0 && hoverTile < t.tileCount) {
      const r = tileSrcRect(t, hoverTile);
      ctx.strokeStyle = "#7fdcff";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.sx + 1, r.sy + 1, r.sw - 2, r.sh - 2);
      ctx.setLineDash([]);
    }

    viewerMeta.textContent =
      `${t.name} · ${t.tileWidth}×${t.tileHeight}px tiles · ${t.columns} cols × ${t.rows} rows · ${t.tileCount} tiles · ` +
      `image ${t.imageWidth}×${t.imageHeight}px · ${zoom}× zoom`;
  }

  // Hover/click → tile id lookup. We translate stage coords to image px via zoom.
  function eventToTile(e) {
    const t = currentTileset;
    if (!t) return -1;
    const zoom = parseInt(viewerZoom.value, 10) || 1;
    const rect = mapStage.getBoundingClientRect();
    const x = ((e.touches ? e.touches[0].clientX : e.clientX) - rect.left) / zoom;
    const y = ((e.touches ? e.touches[0].clientY : e.clientY) - rect.top)  / zoom;
    if (x < t.margin || y < t.margin) return -1;
    const cx = Math.floor((x - t.margin) / (t.tileWidth + t.spacing));
    const cy = Math.floor((y - t.margin) / (t.tileHeight + t.spacing));
    if (cx < 0 || cx >= t.columns || cy < 0 || cy >= t.rows) return -1;
    const idx = cy * t.columns + cx;
    return idx < t.tileCount ? idx : -1;
  }

  mapStage.addEventListener("mousemove", (e) => {
    const t = currentTileset;
    if (!t) return;
    const idx = eventToTile(e);
    if (idx === hoverTile) return;
    hoverTile = idx;
    renderTileset();
    if (idx >= 0) {
      const r = tileSrcRect(t, idx);
      viewerTileInfo.textContent =
        `Tile id ${idx} (col ${idx % t.columns}, row ${Math.floor(idx / t.columns)}) · src @ (${r.sx},${r.sy})`;
    } else {
      viewerTileInfo.textContent = "Hover or click a tile to see its ID.";
    }
  });
  mapStage.addEventListener("mouseleave", () => {
    if (hoverTile === -1) return;
    hoverTile = -1;
    renderTileset();
    viewerTileInfo.textContent = "Hover or click a tile to see its ID.";
  });
  mapStage.addEventListener("click", (e) => {
    const t = currentTileset;
    if (!t) return;
    const idx = eventToTile(e);
    if (idx < 0) return;
    // Copy the tile id to the clipboard for quick pasting into /command we.
    const text = String(idx);
    navigator.clipboard?.writeText(text).then(
      () => { viewerTileInfo.textContent = `Tile id ${idx} copied to clipboard.`; },
      () => { viewerTileInfo.textContent = `Tile id ${idx} (clipboard unavailable).`; }
    );
  });

  // ----- init -----
  async function refresh() {
    const maps = await listMaps();
    if (maps) renderMapList(maps);
  }
  refresh();
})();
