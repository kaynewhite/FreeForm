(() => {
  const $ = (s, r = document) => r.querySelector(s);

  // ----- state -----
  const state = {
    manifest: null,
    savedSlices: {}, // url → { frames, frameW, frameH, offsetX, offsetY, gapX }
    weapon: "no-weapon",
    animation: "idle",
    frames: 4,
    fps: 8,
    scale: 3,
    playing: true,
    activeIndex: 0, // which preview card the raw-sheet panel mirrors
    rawZoom: 2,     // visual magnification of the raw sheet
    drag: null,     // { x0, y0, x1, y1 } in image pixel space while dragging
  };

  // Sensible defaults for "frames per direction" by animation. The user can
  // override; we just want a reasonable starting point so the preview reads
  // correctly the moment the page loads.
  const FRAME_DEFAULTS = {
    idle: 4,
    walking: 8,
    attack: 6,
    cast: 6,
    death: 6,
  };

  // For combined "UpLeftDownRight" sheets, the row order is encoded in the
  // filename. (Not Up,Down,Left,Right — Up,Left,Down,Right.)
  const COMBINED_ROW_ORDER = ["up", "left", "down", "right"];
  const ALL_DIRECTIONS = ["down", "left", "right", "up"];

  // ----- DOM -----
  const weaponSel = $("#weapon-select");
  const animSel = $("#anim-select");
  const framesInput = $("#frames-input");
  const fpsInput = $("#fps-input");
  const scaleInput = $("#scale-input");
  const playToggle = $("#play-toggle");
  const layoutHint = $("#layout-hint");
  const previewGrid = $("#preview-grid");
  const sheetImg = $("#sheet-img");
  const sheetOverlay = $("#sheet-overlay");
  const sheetStage = $("#sheet-stage");
  const sheetMeta = $("#sheet-meta");
  const statusMsg = $("#status-msg");
  const rawZoom = $("#raw-zoom");
  const applyAllBtn = $("#apply-all-btn");

  function setStatus(text, good = false) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("is-good", !!good);
  }

  // ----- persistence -----
  // Per-card debounced save to /api/sprites/slice. Drag-end / reset / apply-all
  // bypass the debounce and save (or delete) immediately.
  const saveTimers = new WeakMap();
  function scheduleSave(card, delay = 400) {
    clearTimeout(saveTimers.get(card));
    saveTimers.set(card, setTimeout(() => saveSlice(card), delay));
  }
  async function saveSlice(card) {
    if (!card || !card.url || !card.sheet) return;
    try {
      const r = await fetch("/api/sprites/slice", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: card.url,
          frames: card.frames,
          frameW: card.frameW,
          frameH: card.frameH,
          offsetX: card.offsetX,
          offsetY: card.offsetY,
          gapX: card.gapX,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      card.savedSlice = {
        frames: card.frames, frameW: card.frameW, frameH: card.frameH,
        offsetX: card.offsetX, offsetY: card.offsetY, gapX: card.gapX,
      };
      flashSaveBadge(card, "saved");
    } catch (err) {
      console.error("save slice failed", err);
      flashSaveBadge(card, "save failed", true);
    }
  }
  async function deleteSlice(card) {
    if (!card || !card.url) return;
    try {
      const r = await fetch(`/api/sprites/slice?url=${encodeURIComponent(card.url)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error(await r.text());
      card.savedSlice = null;
      flashSaveBadge(card, "reset");
    } catch (err) {
      console.error("delete slice failed", err);
      flashSaveBadge(card, "reset failed", true);
    }
  }
  function flashSaveBadge(card, text, bad = false) {
    const badge = card.tweak.querySelector(".save-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle("is-bad", bad);
    badge.classList.add("is-visible");
    clearTimeout(badge._t);
    badge._t = setTimeout(() => badge.classList.remove("is-visible"), 1400);
  }

  // ----- image cache -----
  const imageCache = new Map();
  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load " + url));
      img.src = url;
    });
    imageCache.set(url, p);
    return p;
  }

  // ----- manifest + saved-slices fetch -----
  async function loadManifest() {
    const [mRes, sRes] = await Promise.all([
      fetch("/api/sprites/manifest", { credentials: "same-origin" }),
      fetch("/api/sprites/slices",   { credentials: "same-origin" }),
    ]);
    if (mRes.status === 401 || mRes.status === 403) {
      setStatus("Admins only — log in as the admin to view this page.");
      return;
    }
    if (!mRes.ok) { setStatus("Failed to load manifest."); return; }
    state.manifest = await mRes.json();
    state.savedSlices = sRes.ok ? await sRes.json() : {};
    populateControls();
    rebuild();
  }
  function lookupSaved(url) {
    return (state.savedSlices && state.savedSlices[url]) || null;
  }

  // ----- controls -----
  function populateControls() {
    const anims = ["idle", "walking", "attack", "cast", "death"];
    animSel.innerHTML = "";
    for (const a of anims) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      animSel.appendChild(o);
    }
    animSel.value = state.animation;

    const seen = new Set();
    for (const anim of anims) {
      const variants = state.manifest.animations[anim] || {};
      Object.keys(variants).forEach((v) => seen.add(v));
    }
    const order = ["no-weapon", "with-dagger", "with-club", "with-bow", "with-slingshot", "with-katana"];
    const ordered = [
      ...order.filter((v) => seen.has(v)),
      ...[...seen].filter((v) => !order.includes(v)).sort(),
    ];
    weaponSel.innerHTML = "";
    for (const v of ordered) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v === "no-weapon" ? "No weapon" : v.replace("with-", "");
      weaponSel.appendChild(o);
    }
    weaponSel.value = state.weapon;
  }

  function syncFromControls() {
    state.weapon = weaponSel.value;
    state.animation = animSel.value;
    state.frames = clamp(parseInt(framesInput.value, 10) || 1, 1, 64);
    state.fps = clamp(parseInt(fpsInput.value, 10) || 1, 1, 60);
    state.scale = clamp(parseInt(scaleInput.value, 10) || 1, 1, 8);
    state.playing = playToggle.checked;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  weaponSel.addEventListener("change", () => { syncFromControls(); applyDefaultFrames(); rebuild(); });
  animSel.addEventListener("change", () => { syncFromControls(); applyDefaultFrames(); rebuild(); });
  framesInput.addEventListener("input", () => { syncFromControls(); rebuild(); });
  fpsInput.addEventListener("input", syncFromControls);
  scaleInput.addEventListener("input", () => {
    syncFromControls();
    for (const c of previewCards) sizePreviewCanvas(c);
  });
  playToggle.addEventListener("change", syncFromControls);

  rawZoom.addEventListener("input", () => {
    state.rawZoom = clamp(parseInt(rawZoom.value, 10) || 1, 1, 8);
    applyRawZoom();
  });

  applyAllBtn.addEventListener("click", () => {
    const src = previewCards[state.activeIndex];
    if (!src || !src.sheet) return;
    for (const c of previewCards) {
      if (c === src || !c.sheet) continue;
      c.frameW = src.frameW;
      c.frameH = src.frameH;
      c.offsetX = src.offsetX;
      c.gapX = src.gapX;
      // Combined sheets: keep each row's Y; per-direction sheets: copy Y too.
      if (c.sheet !== src.sheet) c.offsetY = src.offsetY;
      c.frames = src.frames;
      writeInputsFrom(c);
      sizePreviewCanvas(c);
      updateCardMeta(c);
      saveSlice(c);
    }
    saveSlice(src);
    setStatus("Applied slice to all directions.", true);
    setTimeout(() => setStatus(""), 1800);
  });

  function applyDefaultFrames() {
    framesInput.value = String(FRAME_DEFAULTS[state.animation] || 4);
    state.frames = parseInt(framesInput.value, 10);
  }

  // ----- rendering -----
  // Each preview card has its own slice settings so you can dial in sheets
  // that have padding, inconsistent frame widths, or off-center crops.
  let previewCards = [];
  let rafId = null;

  function rebuild() {
    cancelAnimationFrame(rafId);
    previewCards = [];
    state.activeIndex = 0;
    previewGrid.innerHTML = "";
    sheetImg.removeAttribute("src");
    sheetOverlay.width = sheetOverlay.height = 0;
    sheetMeta.textContent = "—";

    const variants = state.manifest?.animations?.[state.animation] || {};
    const entries = variants[state.weapon] || [];
    if (!entries.length) {
      layoutHint.textContent = `No "${state.animation}" sheets uploaded for ${state.weapon}.`;
      return;
    }

    const isDeath = state.animation === "death";
    const combined = entries.find((e) => e.combined);
    const perDir = entries.filter((e) => !e.combined && e.direction);
    const single = entries.find((e) => !e.combined && !e.direction);

    if (isDeath && single) {
      layoutHint.textContent = `Death is a single non-directional strip — 1 row × N frames.`;
      buildPerDirection([{ ...single, direction: "death" }], false);
      return;
    }
    if (combined) {
      layoutHint.textContent = `Combined sheet — 4 rows × N frames, row order Up · Left · Down · Right.`;
      buildCombined(combined);
      return;
    }
    if (perDir.length) {
      const haveAll = ALL_DIRECTIONS.every((d) => perDir.some((e) => e.direction === d));
      layoutHint.textContent = haveAll
        ? `Per-direction strips — 4 separate sheets, each 1 row × N frames.`
        : `Per-direction strips — ${perDir.length}/4 directions present.`;
      buildPerDirection(perDir, true);
    }
  }

  function buildPerDirection(entries, useDirNames) {
    // Build cards in stable direction order so the grid reads down/left/right/up.
    const ordered = useDirNames
      ? [...entries].sort((a, b) => ALL_DIRECTIONS.indexOf(a.direction) - ALL_DIRECTIONS.indexOf(b.direction))
      : entries;

    for (const e of ordered) {
      const card = makeCard(useDirNames ? e.direction : "death", e.url);
      const saved = lookupSaved(e.url);
      card.savedSlice = saved;
      previewGrid.appendChild(card.el);
      previewCards.push(card);
      loadImage(e.url).then((img) => {
        card.sheet = img;
        if (saved) {
          Object.assign(card, saved);
        } else {
          card.frameW = Math.max(1, Math.floor(img.naturalWidth / state.frames));
          card.frameH = img.naturalHeight;
          card.offsetX = 0;
          card.offsetY = 0;
          card.gapX = 0;
          card.frames = state.frames;
        }
        writeInputsFrom(card);
        sizePreviewCanvas(card);
        updateCardMeta(card);
        if (card === previewCards[0]) showRaw(card);
        startLoop();
      }).catch(() => {
        card.el.classList.add("is-missing");
        card.foot.querySelector(".frame-info").textContent = "load failed";
      });
    }
    if (useDirNames) {
      const present = new Set(ordered.map((e) => e.direction));
      for (const d of ALL_DIRECTIONS) {
        if (present.has(d)) continue;
        const card = makeCard(d, null);
        card.el.classList.add("is-missing");
        card.foot.querySelector(".frame-info").textContent = "no sheet";
        previewGrid.appendChild(card.el);
      }
    }
  }

  function buildCombined(entry) {
    // One image, but four directions each persisted separately. We key per-row
    // saves with synthetic "#row=N" suffixes on the URL.
    for (let i = 0; i < 4; i++) {
      const card = makeCard(COMBINED_ROW_ORDER[i], `${entry.url}#row=${i}`);
      card.row = i;
      previewGrid.appendChild(card.el);
      previewCards.push(card);
    }
    loadImage(entry.url).then((img) => {
      const rowH = Math.max(1, Math.floor(img.naturalHeight / 4));
      const frameW = Math.max(1, Math.floor(img.naturalWidth / state.frames));
      for (const card of previewCards) {
        card.sheet = img;
        const saved = lookupSaved(card.url);
        card.savedSlice = saved;
        if (saved) {
          Object.assign(card, saved);
        } else {
          card.frameW = frameW;
          card.frameH = rowH;
          card.offsetX = 0;
          card.offsetY = card.row * rowH;
          card.gapX = 0;
          card.frames = state.frames;
        }
        writeInputsFrom(card);
        sizePreviewCanvas(card);
        updateCardMeta(card);
      }
      showRaw(previewCards[0]);
      startLoop();
    }).catch(() => setStatus("Failed to load combined sheet."));
  }

  function makeCard(direction, url) {
    const el = document.createElement("div");
    el.className = "preview-card";
    el.tabIndex = 0;

    const label = document.createElement("div");
    label.className = "preview-label";
    label.textContent = direction.toUpperCase();

    const wrap = document.createElement("div");
    wrap.className = "preview-canvas-wrap";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    const foot = document.createElement("div");
    foot.className = "preview-foot";
    foot.innerHTML = `<div>${direction}</div><div class="frame-info">…</div>`;

    // Per-card slice controls
    const tweak = document.createElement("div");
    tweak.className = "preview-tweak";
    tweak.innerHTML = `
      <label>N<input type="number" data-k="frames" min="1" max="64" /></label>
      <label>W<input type="number" data-k="frameW" min="1" /></label>
      <label>H<input type="number" data-k="frameH" min="1" /></label>
      <label>X<input type="number" data-k="offsetX" min="0" /></label>
      <label>Y<input type="number" data-k="offsetY" min="0" /></label>
      <label title="Horizontal gap between frames">G<input type="number" data-k="gapX" min="0" /></label>
      <button type="button" class="t-reset" title="Reset to auto-computed defaults (deletes saved settings)">⟲</button>
      <span class="save-badge" aria-live="polite"></span>
    `;

    const card = {
      el, canvas, ctx: canvas.getContext("2d"),
      foot, tweak, direction, url,
      sheet: null,
      frameW: 1, frameH: 1, offsetX: 0, offsetY: 0, gapX: 0, frames: state.frames,
      row: 0,
    };

    // Wire the input listeners
    tweak.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const k = inp.dataset.k;
        const v = Math.max(parseInt(inp.min, 10) || 0, parseInt(inp.value, 10) || 0);
        card[k] = v;
        if (k === "frameW" || k === "frameH") sizePreviewCanvas(card);
        updateCardMeta(card);
        if (card === previewCards[state.activeIndex]) drawSheetOverlay();
        scheduleSave(card);
      });
    });
    tweak.querySelector(".t-reset").addEventListener("click", () => {
      resetCard(card);
      deleteSlice(card);
      delete state.savedSlices[card.url];
    });

    el.addEventListener("click", () => focusCard(card));
    el.addEventListener("focus", () => focusCard(card));

    el.append(label, wrap, foot, tweak);
    return card;
  }

  function writeInputsFrom(card) {
    card.tweak.querySelector('[data-k="frames"]').value = card.frames;
    card.tweak.querySelector('[data-k="frameW"]').value = card.frameW;
    card.tweak.querySelector('[data-k="frameH"]').value = card.frameH;
    card.tweak.querySelector('[data-k="offsetX"]').value = card.offsetX;
    card.tweak.querySelector('[data-k="offsetY"]').value = card.offsetY;
    card.tweak.querySelector('[data-k="gapX"]').value = card.gapX;
  }

  function resetCard(card) {
    if (!card.sheet) return;
    card.gapX = 0;
    if (typeof card.row === "number" && card.row > 0) {
      // combined sheet card
      card.frameW = Math.max(1, Math.floor(card.sheet.naturalWidth / state.frames));
      card.frameH = Math.max(1, Math.floor(card.sheet.naturalHeight / 4));
      card.offsetX = 0;
      card.offsetY = card.row * card.frameH;
    } else if (typeof card.row === "number" && previewCards.some((c) => c !== card && c.sheet === card.sheet)) {
      // top row of a combined sheet (row=0)
      card.frameW = Math.max(1, Math.floor(card.sheet.naturalWidth / state.frames));
      card.frameH = Math.max(1, Math.floor(card.sheet.naturalHeight / 4));
      card.offsetX = 0;
      card.offsetY = 0;
    } else {
      // per-direction sheet
      card.frameW = Math.max(1, Math.floor(card.sheet.naturalWidth / state.frames));
      card.frameH = card.sheet.naturalHeight;
      card.offsetX = 0;
      card.offsetY = 0;
    }
    card.frames = state.frames;
    writeInputsFrom(card);
    sizePreviewCanvas(card);
    updateCardMeta(card);
    if (card === previewCards[state.activeIndex]) drawSheetOverlay();
  }

  function focusCard(card) {
    const idx = previewCards.indexOf(card);
    if (idx < 0) return;
    state.activeIndex = idx;
    previewCards.forEach((c) => c.el.classList.toggle("is-active", c === card));
    showRaw(card);
  }

  function sizePreviewCanvas(card) {
    const w = Math.max(1, card.frameW);
    const h = Math.max(1, card.frameH);
    card.canvas.width = w;
    card.canvas.height = h;
    card.canvas.style.width = `${w * state.scale}px`;
    card.canvas.style.height = `${h * state.scale}px`;
    card.ctx.imageSmoothingEnabled = false;
  }

  function updateCardMeta(card) {
    if (!card.sheet) return;
    const sw = card.sheet.naturalWidth;
    const sh = card.sheet.naturalHeight;
    const gap = card.gapX ? ` +${card.gapX}gap` : "";
    card.foot.querySelector(".frame-info").textContent =
      `sheet ${sw}×${sh} · slice ${card.frameW}×${card.frameH} @ (${card.offsetX},${card.offsetY})${gap}`;
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    let last = performance.now();
    let frameIndex = 0;
    let acc = 0;
    function tick(now) {
      const dt = (now - last) / 1000; last = now;
      if (state.playing) acc += dt;
      const interval = 1 / state.fps;
      while (acc >= interval) {
        acc -= interval;
        frameIndex += 1;
      }
      for (const c of previewCards) {
        if (!c.sheet) continue;
        const idx = frameIndex % Math.max(1, c.frames);
        c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
        const sx = c.offsetX + idx * (c.frameW + c.gapX);
        const sy = c.offsetY;
        c.ctx.drawImage(c.sheet, sx, sy, c.frameW, c.frameH, 0, 0, c.frameW, c.frameH);
      }
      drawSheetOverlay(frameIndex);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  // ----- raw-sheet view (mirrors the active card) -----
  function showRaw(card) {
    if (!card || !card.url) return;
    sheetImg.src = card.url;
    sheetImg.onload = () => {
      sheetOverlay.width = sheetImg.naturalWidth;
      sheetOverlay.height = sheetImg.naturalHeight;
      applyRawZoom();
      updateRawMeta(card);
      drawSheetOverlay();
    };
  }

  function applyRawZoom() {
    if (!sheetImg.naturalWidth) return;
    const z = state.rawZoom;
    const w = sheetImg.naturalWidth * z;
    const h = sheetImg.naturalHeight * z;
    sheetImg.style.width = `${w}px`;
    sheetImg.style.height = `${h}px`;
    sheetOverlay.style.width = `${w}px`;
    sheetOverlay.style.height = `${h}px`;
  }

  function updateRawMeta(card) {
    if (!card) return;
    const gap = card.gapX ? ` +${card.gapX}gap` : "";
    sheetMeta.textContent =
      `${card.direction.toUpperCase()} · ${sheetImg.naturalWidth}×${sheetImg.naturalHeight} px · ` +
      `slice ${card.frameW}×${card.frameH} @ (${card.offsetX},${card.offsetY})${gap} · ${card.frames} frames · ` +
      `${state.rawZoom}× zoom`;
  }

  function drawSheetOverlay(frameIndex = 0) {
    const card = previewCards[state.activeIndex];
    if (!card || !card.sheet) return;
    if (sheetImg.src.indexOf(card.url.split("/").pop()) === -1) return;

    const ctx = sheetOverlay.getContext("2d");
    const w = sheetOverlay.width;
    const h = sheetOverlay.height;
    ctx.clearRect(0, 0, w, h);

    // Faint per-frame grid for the active card's slice settings (handles gaps)
    ctx.strokeStyle = "rgba(246,228,163,0.45)";
    ctx.lineWidth = 1;
    for (let i = 0; i < card.frames; i++) {
      const x = card.offsetX + i * (card.frameW + card.gapX);
      ctx.strokeRect(x + 0.5, card.offsetY + 0.5, card.frameW - 1, card.frameH - 1);
    }
    // Faintly shade the gap regions so they're visible
    if (card.gapX > 0) {
      ctx.fillStyle = "rgba(140, 220, 255, 0.12)";
      for (let i = 0; i < card.frames - 1; i++) {
        const x = card.offsetX + i * (card.frameW + card.gapX) + card.frameW;
        ctx.fillRect(x, card.offsetY, card.gapX, card.frameH);
      }
    }

    // Highlight the currently-playing frame
    const idx = frameIndex % Math.max(1, card.frames);
    ctx.strokeStyle = "#ffd76b";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      card.offsetX + idx * (card.frameW + card.gapX) + 1,
      card.offsetY + 1,
      card.frameW - 2,
      card.frameH - 2
    );

    // Live drag rectangle + ghost preview of the N repeats stepping right
    if (state.drag) {
      const r = normalizeDrag(state.drag);
      const stride = r.w + card.gapX;
      ctx.strokeStyle = "rgba(140, 220, 255, 0.45)";
      ctx.lineWidth = 1;
      for (let i = 0; i < card.frames; i++) {
        const x = r.x + i * stride;
        if (x + r.w > w) break;
        ctx.strokeRect(x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#7fdcff";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.setLineDash([]);
    }
  }

  function normalizeDrag(d) {
    return {
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.max(1, Math.abs(d.x1 - d.x0)),
      h: Math.max(1, Math.abs(d.y1 - d.y0)),
    };
  }

  // ----- drag-to-crop on the raw sheet -----
  function eventToImagePx(e) {
    const rect = sheetStage.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const x = Math.max(0, Math.min(sheetImg.naturalWidth,
      Math.round(cx / state.rawZoom)));
    const y = Math.max(0, Math.min(sheetImg.naturalHeight,
      Math.round(cy / state.rawZoom)));
    return { x, y };
  }

  sheetStage.addEventListener("mousedown", (e) => {
    if (!sheetImg.naturalWidth) return;
    e.preventDefault();
    const p = eventToImagePx(e);
    state.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drawSheetOverlay();
  });
  window.addEventListener("mousemove", (e) => {
    if (!state.drag) return;
    const p = eventToImagePx(e);
    state.drag.x1 = p.x; state.drag.y1 = p.y;
    const r = normalizeDrag(state.drag);
    sheetMeta.textContent =
      `dragging · slice would be ${r.w}×${r.h} @ (${r.x},${r.y}) · ${previewCards[state.activeIndex]?.frames || 0} frames`;
    drawSheetOverlay();
  });
  window.addEventListener("mouseup", () => {
    if (!state.drag) return;
    const r = normalizeDrag(state.drag);
    state.drag = null;
    const card = previewCards[state.activeIndex];
    if (card && r.w >= 2 && r.h >= 2) {
      card.frameW = r.w;
      card.frameH = r.h;
      card.offsetX = r.x;
      card.offsetY = r.y;
      writeInputsFrom(card);
      sizePreviewCanvas(card);
      updateCardMeta(card);
      updateRawMeta(card);
      saveSlice(card); // drag-end saves immediately
    }
    drawSheetOverlay();
  });

  // ----- init -----
  applyDefaultFrames();
  loadManifest();
})();
