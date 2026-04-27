(() => {
  const $ = (s, r = document) => r.querySelector(s);

  // ----- state -----
  const state = {
    manifest: null,
    weapon: "no-weapon",
    animation: "idle",
    frames: 4,
    fps: 8,
    scale: 3,
    playing: true,
    activeIndex: 0, // which preview card the raw-sheet panel mirrors
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
  const sheetMeta = $("#sheet-meta");
  const statusMsg = $("#status-msg");

  function setStatus(text, good = false) {
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("is-good", !!good);
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

  // ----- manifest fetch -----
  async function loadManifest() {
    const r = await fetch("/api/sprites/manifest", { credentials: "same-origin" });
    if (r.status === 401 || r.status === 403) {
      setStatus("Admins only — log in as the admin to view this page.");
      return;
    }
    if (!r.ok) { setStatus("Failed to load manifest."); return; }
    state.manifest = await r.json();
    populateControls();
    rebuild();
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
      previewGrid.appendChild(card.el);
      previewCards.push(card);
      loadImage(e.url).then((img) => {
        card.sheet = img;
        card.frameW = Math.max(1, Math.floor(img.naturalWidth / state.frames));
        card.frameH = img.naturalHeight;
        card.offsetX = 0;
        card.offsetY = 0;
        card.frames = state.frames;
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
    for (let i = 0; i < 4; i++) {
      const card = makeCard(COMBINED_ROW_ORDER[i], entry.url);
      card.row = i;
      previewGrid.appendChild(card.el);
      previewCards.push(card);
    }
    loadImage(entry.url).then((img) => {
      const rowH = Math.max(1, Math.floor(img.naturalHeight / 4));
      const frameW = Math.max(1, Math.floor(img.naturalWidth / state.frames));
      for (const card of previewCards) {
        card.sheet = img;
        card.frameW = frameW;
        card.frameH = rowH;
        card.offsetX = 0;
        card.offsetY = card.row * rowH;
        card.frames = state.frames;
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
      <button type="button" class="t-reset" title="Reset to auto-computed defaults">⟲</button>
    `;

    const card = {
      el, canvas, ctx: canvas.getContext("2d"),
      foot, tweak, direction, url,
      sheet: null,
      frameW: 1, frameH: 1, offsetX: 0, offsetY: 0, frames: state.frames,
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
      });
    });
    tweak.querySelector(".t-reset").addEventListener("click", () => resetCard(card));

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
  }

  function resetCard(card) {
    if (!card.sheet) return;
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
    card.foot.querySelector(".frame-info").textContent =
      `sheet ${sw}×${sh} · slice ${card.frameW}×${card.frameH} @ (${card.offsetX},${card.offsetY})`;
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
        const sx = c.offsetX + idx * c.frameW;
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
      sheetOverlay.style.width = `${sheetImg.naturalWidth}px`;
      sheetOverlay.style.height = `${sheetImg.naturalHeight}px`;
      sheetImg.style.width = `${sheetImg.naturalWidth}px`;
      sheetImg.style.height = `${sheetImg.naturalHeight}px`;
      sheetMeta.textContent =
        `${card.direction.toUpperCase()} · ${sheetImg.naturalWidth}×${sheetImg.naturalHeight} px · ` +
        `slice ${card.frameW}×${card.frameH} @ (${card.offsetX},${card.offsetY}) · ${card.frames} frames`;
      drawSheetOverlay();
    };
  }

  function drawSheetOverlay(frameIndex = 0) {
    const card = previewCards[state.activeIndex];
    if (!card || !card.sheet) return;
    if (sheetImg.src.indexOf(card.url.split("/").pop()) === -1) return;

    const ctx = sheetOverlay.getContext("2d");
    const w = sheetOverlay.width;
    const h = sheetOverlay.height;
    ctx.clearRect(0, 0, w, h);

    // Faint frame grid for the active card's slice settings
    ctx.strokeStyle = "rgba(246,228,163,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= card.frames; i++) {
      const x = card.offsetX + i * card.frameW;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, card.offsetY);
      ctx.lineTo(x + 0.5, card.offsetY + card.frameH);
      ctx.stroke();
    }
    // Top + bottom rules
    ctx.beginPath();
    ctx.moveTo(card.offsetX, card.offsetY + 0.5);
    ctx.lineTo(card.offsetX + card.frames * card.frameW, card.offsetY + 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(card.offsetX, card.offsetY + card.frameH - 0.5);
    ctx.lineTo(card.offsetX + card.frames * card.frameW, card.offsetY + card.frameH - 0.5);
    ctx.stroke();

    // Highlight the currently-playing frame
    const idx = frameIndex % Math.max(1, card.frames);
    ctx.strokeStyle = "#ffd76b";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      card.offsetX + idx * card.frameW + 1,
      card.offsetY + 1,
      card.frameW - 2,
      card.frameH - 2
    );
  }

  // ----- init -----
  applyDefaultFrames();
  loadManifest();
})();
