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
  const viewerClose = $("#viewer-close");
  const layerToggles = $("#layer-toggles");
  const mapCanvas = $("#map-canvas");
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
    if (!r.ok) { setStatus("Failed to load maps."); return null; }
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

  // ----- map list rendering -----
  let currentMaps = [];

  function renderMapList(maps) {
    currentMaps = maps;
    mapList.innerHTML = "";
    if (!maps.length) {
      mapList.innerHTML = `<p class="ctrl-hint">No maps uploaded yet.</p>`;
      return;
    }
    for (const m of maps) {
      const card = document.createElement("div");
      card.className = "map-card";
      card.dataset.name = m.name;

      const tmxFiles = m.files.filter((f) => f.ext === "tmx");
      const head = document.createElement("div");
      head.className = "map-card-head";
      head.innerHTML = `
        <h3 class="map-card-name">${escapeHtml(m.name)}</h3>
        <div class="map-card-actions">
          ${tmxFiles.map((f) => `<button type="button" data-act="view" data-file="${escapeHtml(f.name)}">View ${escapeHtml(f.name)}</button>`).join("")}
          <button type="button" class="danger" data-act="delete">Delete map</button>
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
          if (currentMap?.mapName === m.name) closeViewer();
          await refresh();
          setStatus(`Deleted ${m.name}.`, true);
          setTimeout(() => setStatus(""), 1600);
        } else {
          setStatus(`Failed to delete ${m.name}.`);
        }
      });
    }
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
    const btn = uploadForm.querySelector("button.primary");
    btn.disabled = true;
    const { ok, body } = await uploadMap(name, files);
    btn.disabled = false;
    if (!ok) { setUploadMsg(body?.error || "Upload failed."); return; }
    setUploadMsg(`Uploaded ${body.written.length} file(s) to "${name}".`, true);
    uploadFiles.value = "";
    await refresh();
  });

  // ----- viewer -----
  // Tiled spec — flip flags packed into the high bits of each gid.
  const FLIPPED_HORIZONTAL = 0x80000000;
  const FLIPPED_VERTICAL   = 0x40000000;
  const FLIPPED_DIAGONAL   = 0x20000000;
  const GID_MASK           = 0x1FFFFFFF;

  let currentMap = null; // { mapName, mapFile, doc, tilesets:[], layers:[] }

  function closeViewer() {
    currentMap = null;
    viewerSection.hidden = true;
    layerToggles.innerHTML = "";
    document.querySelectorAll(".map-card.is-active").forEach((el) => el.classList.remove("is-active"));
  }
  viewerClose.addEventListener("click", closeViewer);
  viewerZoom.addEventListener("input", () => {
    if (currentMap) renderMap();
  });

  async function openViewer(mapName, mapFile) {
    setStatus("");
    document.querySelectorAll(".map-card.is-active").forEach((el) => el.classList.remove("is-active"));
    document.querySelector(`.map-card[data-name="${CSS.escape(mapName)}"]`)?.classList.add("is-active");
    viewerSection.hidden = false;
    viewerTitle.textContent = `${mapName} / ${mapFile}`;
    viewerMeta.textContent = "Loading TMX…";
    layerToggles.innerHTML = "";
    try {
      const doc = await fetchXml(fileUrl(mapName, mapFile));
      const map = parseMap(doc);
      // Resolve every tileset (external TSX or embedded) and load its image.
      const tilesets = await Promise.all(
        map.tilesetRefs.map(async (ts) => {
          let tileWidth, tileHeight, image, columns, imageWidth, imageHeight, name;
          if (ts.source) {
            const tsDoc = await fetchXml(fileUrl(mapName, ts.source));
            const root = tsDoc.documentElement;
            tileWidth  = parseInt(root.getAttribute("tilewidth"), 10);
            tileHeight = parseInt(root.getAttribute("tileheight"), 10);
            columns    = parseInt(root.getAttribute("columns"), 10) || 0;
            name       = root.getAttribute("name") || ts.source;
            const imgEl = root.querySelector("image");
            if (!imgEl) throw new Error(`Tileset ${ts.source} has no <image>.`);
            image = await loadImage(fileUrl(mapName, imgEl.getAttribute("source")));
            imageWidth  = parseInt(imgEl.getAttribute("width"),  10) || image.naturalWidth;
            imageHeight = parseInt(imgEl.getAttribute("height"), 10) || image.naturalHeight;
          } else {
            tileWidth  = ts.tilewidth;
            tileHeight = ts.tileheight;
            columns    = ts.columns;
            name       = ts.name || "embedded";
            if (!ts.imageSource) throw new Error(`Embedded tileset has no <image>.`);
            image = await loadImage(fileUrl(mapName, ts.imageSource));
            imageWidth  = ts.imageWidth  || image.naturalWidth;
            imageHeight = ts.imageHeight || image.naturalHeight;
          }
          if (!columns) columns = Math.max(1, Math.floor(imageWidth / tileWidth));
          const rows = Math.max(1, Math.floor(imageHeight / tileHeight));
          return {
            firstgid: ts.firstgid,
            tileWidth, tileHeight, columns, rows,
            image, imageWidth, imageHeight, name,
            lastgid: ts.firstgid + columns * rows - 1,
          };
        })
      );

      currentMap = {
        mapName, mapFile, doc,
        width: map.width, height: map.height,
        tileWidth: map.tileWidth, tileHeight: map.tileHeight,
        layers: map.layers, tilesets,
        layerVisible: Object.fromEntries(map.layers.map((l) => [l.name, l.visible])),
      };
      buildLayerToggles();
      renderMap();
    } catch (err) {
      console.error("[maps] viewer failed:", err);
      viewerMeta.textContent = `Failed to load: ${err.message}`;
    }
  }

  function fileUrl(mapName, file) {
    // Tiled paths can use forward slashes; we only support files in the same
    // map directory (filenames only, no subfolders).
    const base = file.split(/[\\/]/).pop();
    return `/api/maps/file/${encodeURIComponent(mapName)}/${encodeURIComponent(base)}`;
  }

  async function fetchXml(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error(`XML parse error in ${url}`);
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

  function parseMap(doc) {
    const root = doc.documentElement;
    if (root.tagName !== "map") throw new Error("Not a Tiled .tmx (root is not <map>).");
    const orientation = root.getAttribute("orientation") || "orthogonal";
    if (orientation !== "orthogonal") {
      throw new Error(`Only orthogonal maps supported (this is "${orientation}").`);
    }
    const width  = parseInt(root.getAttribute("width"),  10);
    const height = parseInt(root.getAttribute("height"), 10);
    const tileWidth  = parseInt(root.getAttribute("tilewidth"),  10);
    const tileHeight = parseInt(root.getAttribute("tileheight"), 10);

    const tilesetRefs = [];
    for (const ts of root.querySelectorAll(":scope > tileset")) {
      const firstgid = parseInt(ts.getAttribute("firstgid"), 10);
      const source = ts.getAttribute("source");
      if (source) {
        tilesetRefs.push({ firstgid, source });
      } else {
        const imgEl = ts.querySelector(":scope > image");
        tilesetRefs.push({
          firstgid,
          name: ts.getAttribute("name"),
          tilewidth:  parseInt(ts.getAttribute("tilewidth"),  10),
          tileheight: parseInt(ts.getAttribute("tileheight"), 10),
          columns:    parseInt(ts.getAttribute("columns"), 10) || 0,
          imageSource: imgEl?.getAttribute("source") || null,
          imageWidth:  imgEl ? parseInt(imgEl.getAttribute("width"),  10) || 0 : 0,
          imageHeight: imgEl ? parseInt(imgEl.getAttribute("height"), 10) || 0 : 0,
        });
      }
    }

    const layers = [];
    for (const layer of root.querySelectorAll(":scope > layer")) {
      const lw = parseInt(layer.getAttribute("width"),  10);
      const lh = parseInt(layer.getAttribute("height"), 10);
      const data = layer.querySelector(":scope > data");
      if (!data) continue;
      const encoding = data.getAttribute("encoding") || "xml";
      let gids;
      if (encoding === "csv") {
        gids = data.textContent
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length)
          .map((s) => Number(s) >>> 0);
      } else if (encoding === "" || encoding === "xml") {
        gids = Array.from(data.querySelectorAll(":scope > tile"))
          .map((t) => Number(t.getAttribute("gid") || "0") >>> 0);
      } else {
        throw new Error(`Layer encoding "${encoding}" not supported (use CSV or XML).`);
      }
      layers.push({
        name: layer.getAttribute("name") || `layer_${layers.length}`,
        width: lw, height: lh,
        gids,
        visible: layer.getAttribute("visible") !== "0",
        opacity: layer.hasAttribute("opacity") ? parseFloat(layer.getAttribute("opacity")) : 1,
      });
    }

    return { width, height, tileWidth, tileHeight, tilesetRefs, layers };
  }

  function buildLayerToggles() {
    layerToggles.innerHTML = "";
    for (const l of currentMap.layers) {
      const id = `layer_${l.name}`;
      const lbl = document.createElement("label");
      lbl.innerHTML = `
        <input type="checkbox" id="${id}" ${currentMap.layerVisible[l.name] ? "checked" : ""}/>
        <span>${escapeHtml(l.name)}</span>
      `;
      lbl.querySelector("input").addEventListener("change", (e) => {
        currentMap.layerVisible[l.name] = e.target.checked;
        renderMap();
      });
      layerToggles.appendChild(lbl);
    }
  }

  function findTileset(gid) {
    let best = null;
    for (const ts of currentMap.tilesets) {
      if (ts.firstgid <= gid && gid <= ts.lastgid && (!best || ts.firstgid > best.firstgid)) {
        best = ts;
      }
    }
    return best;
  }

  function renderMap() {
    if (!currentMap) return;
    const zoom = parseInt(viewerZoom.value, 10) || 1;
    const { width, height, tileWidth, tileHeight, layers, tilesets } = currentMap;
    const w = width * tileWidth;
    const h = height * tileHeight;

    mapCanvas.width = w;
    mapCanvas.height = h;
    mapCanvas.style.width = `${w * zoom}px`;
    mapCanvas.style.height = `${h * zoom}px`;
    const ctx = mapCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    let drawn = 0;
    for (const layer of layers) {
      if (!currentMap.layerVisible[layer.name]) continue;
      const oldAlpha = ctx.globalAlpha;
      ctx.globalAlpha = oldAlpha * (layer.opacity ?? 1);
      for (let i = 0; i < layer.gids.length; i++) {
        const raw = layer.gids[i];
        const gid = raw & GID_MASK;
        if (!gid) continue;
        const ts = findTileset(gid);
        if (!ts) continue;
        const local = gid - ts.firstgid;
        const sx = (local % ts.columns) * ts.tileWidth;
        const sy = Math.floor(local / ts.columns) * ts.tileHeight;
        const dx = (i % layer.width) * tileWidth;
        const dy = Math.floor(i / layer.width) * tileHeight;

        const flipH = !!(raw & FLIPPED_HORIZONTAL);
        const flipV = !!(raw & FLIPPED_VERTICAL);
        const flipD = !!(raw & FLIPPED_DIAGONAL);

        if (!flipH && !flipV && !flipD) {
          ctx.drawImage(ts.image, sx, sy, ts.tileWidth, ts.tileHeight, dx, dy, tileWidth, tileHeight);
        } else {
          ctx.save();
          ctx.translate(dx + tileWidth / 2, dy + tileHeight / 2);
          if (flipD) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); }
          if (flipH) ctx.scale(-1, 1);
          if (flipV) ctx.scale(1, -1);
          ctx.drawImage(ts.image, sx, sy, ts.tileWidth, ts.tileHeight, -tileWidth / 2, -tileHeight / 2, tileWidth, tileHeight);
          ctx.restore();
        }
        drawn++;
      }
      ctx.globalAlpha = oldAlpha;
    }

    viewerMeta.textContent =
      `${width}×${height} tiles · ${tileWidth}×${tileHeight}px tiles · ${tilesets.length} tileset(s) · ${drawn} tiles drawn · ${zoom}× zoom`;
  }

  // ----- init -----
  async function refresh() {
    const maps = await listMaps();
    if (maps) renderMapList(maps);
  }
  refresh();
})();
