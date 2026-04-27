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
    // Animations: in the order they appear in the doc.
    const anims = ["idle", "walking", "attack", "cast", "death"];
    animSel.innerHTML = "";
    for (const a of anims) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      animSel.appendChild(o);
    }
    animSel.value = state.animation;

    // Weapons: union of all variants seen across animations, with no-weapon first
    // and the 5 starter weapons next per design doc §3.7.
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
  scaleInput.addEventListener("input", () => { syncFromControls(); rebuild(); });
  playToggle.addEventListener("change", syncFromControls);

  function applyDefaultFrames() {
    framesInput.value = String(FRAME_DEFAULTS[state.animation] || 4);
    state.frames = parseInt(framesInput.value, 10);
  }

  // ----- rendering -----
  let previewCards = []; // [{direction, canvas, ctx, sheet, frameW, frameH, row}]
  let rafId = null;

  function rebuild() {
    cancelAnimationFrame(rafId);
    previewCards = [];
    previewGrid.innerHTML = "";
    sheetImg.removeAttribute("src");
    sheetOverlay.width = sheetOverlay.height = 0;

    const variants = state.manifest?.animations?.[state.animation] || {};
    const entries = variants[state.weapon] || [];
    if (!entries.length) {
      layoutHint.textContent = `No "${state.animation}" sheets uploaded for ${state.weapon}.`;
      return;
    }

    const isDeath = state.animation === "death";
    const combined = entries.find((e) => e.combined);
    const perDir = entries.filter((e) => !e.combined && e.direction);
    const single = entries.find((e) => !e.combined && !e.direction); // only used for death

    if (isDeath && single) {
      layoutHint.textContent = `Death is one non-directional sheet. Strip layout: 1 row × N frames.`;
      buildPerDirection([{ ...single, direction: "death" }], false);
      previewRawSheet(single.url);
      return;
    }

    if (combined) {
      layoutHint.textContent = `Combined sheet — 4 rows × N frames, row order Up · Left · Down · Right.`;
      buildCombined(combined);
      previewRawSheet(combined.url);
      return;
    }

    if (perDir.length) {
      const haveAll = ALL_DIRECTIONS.every((d) => perDir.some((e) => e.direction === d));
      layoutHint.textContent = haveAll
        ? `Per-direction strips — 4 separate sheets, each 1 row × N frames.`
        : `Per-direction strips — ${perDir.length}/4 directions present.`;
      buildPerDirection(perDir, true);
      // Show whichever sheet matches the currently-displayed first card.
      previewRawSheet(perDir[0].url);
      return;
    }
  }

  function buildPerDirection(entries, useDirNames) {
    for (const e of entries) {
      const card = makeCard(useDirNames ? e.direction : "death");
      previewGrid.appendChild(card.el);
      loadImage(e.url).then((img) => {
        const frameW = Math.floor(img.naturalWidth / state.frames);
        const frameH = img.naturalHeight;
        card.sheet = img;
        card.frameW = frameW;
        card.frameH = frameH;
        card.row = 0;
        card.foot.querySelector(".frame-info").textContent =
          `${img.naturalWidth}×${img.naturalHeight} → frame ${frameW}×${frameH}`;
        sizePreviewCanvas(card);
        previewCards.push(card);
        startLoop();
      }).catch((err) => {
        card.el.classList.add("is-missing");
        card.foot.querySelector(".frame-info").textContent = "load failed";
      });
    }
    // Add placeholders for missing directions so the grid stays 4-wide.
    if (useDirNames) {
      const present = new Set(entries.map((e) => e.direction));
      for (const d of ALL_DIRECTIONS) {
        if (present.has(d)) continue;
        const card = makeCard(d);
        card.el.classList.add("is-missing");
        card.foot.querySelector(".frame-info").textContent = "no sheet";
        previewGrid.appendChild(card.el);
      }
    }
  }

  function buildCombined(entry) {
    loadImage(entry.url).then((img) => {
      const rowH = Math.floor(img.naturalHeight / 4);
      const frameW = Math.floor(img.naturalWidth / state.frames);
      for (let i = 0; i < 4; i++) {
        const dir = COMBINED_ROW_ORDER[i];
        const card = makeCard(dir);
        previewGrid.appendChild(card.el);
        card.sheet = img;
        card.frameW = frameW;
        card.frameH = rowH;
        card.row = i;
        card.foot.querySelector(".frame-info").textContent =
          `frame ${frameW}×${rowH} (row ${i})`;
        sizePreviewCanvas(card);
        previewCards.push(card);
      }
      startLoop();
    }).catch(() => setStatus("Failed to load combined sheet."));
  }

  function makeCard(direction) {
    const el = document.createElement("div");
    el.className = "preview-card";
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
    el.append(label, wrap, foot);
    return { el, canvas, ctx: canvas.getContext("2d"), foot, direction };
  }

  function sizePreviewCanvas(card) {
    const w = card.frameW * state.scale;
    const h = card.frameH * state.scale;
    card.canvas.width = card.frameW;
    card.canvas.height = card.frameH;
    card.canvas.style.width = `${w}px`;
    card.canvas.style.height = `${h}px`;
    card.ctx.imageSmoothingEnabled = false;
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
        frameIndex = (frameIndex + 1) % state.frames;
      }
      for (const c of previewCards) {
        if (!c.sheet) continue;
        c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
        const sx = frameIndex * c.frameW;
        const sy = c.row * c.frameH;
        c.ctx.drawImage(c.sheet, sx, sy, c.frameW, c.frameH, 0, 0, c.frameW, c.frameH);
      }
      drawSheetOverlay(frameIndex);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  // ----- raw-sheet view with grid overlay -----
  let sheetMetaImg = null;
  function previewRawSheet(url) {
    sheetImg.src = url;
    sheetImg.onload = () => {
      sheetMetaImg = sheetImg;
      sheetOverlay.width = sheetImg.naturalWidth;
      sheetOverlay.height = sheetImg.naturalHeight;
      sheetOverlay.style.width = `${sheetImg.naturalWidth}px`;
      sheetOverlay.style.height = `${sheetImg.naturalHeight}px`;
      sheetImg.style.width = `${sheetImg.naturalWidth}px`;
      sheetImg.style.height = `${sheetImg.naturalHeight}px`;
      sheetMeta.textContent =
        `${sheetImg.naturalWidth}×${sheetImg.naturalHeight} px · ` +
        `frame ${Math.floor(sheetImg.naturalWidth / state.frames)}×` +
        `${sheetImg.naturalHeight} (assuming ${state.frames} frames per row)`;
      drawSheetOverlay(0);
    };
  }

  function drawSheetOverlay(frameIndex) {
    if (!sheetMetaImg) return;
    const ctx = sheetOverlay.getContext("2d");
    const w = sheetOverlay.width;
    const h = sheetOverlay.height;
    ctx.clearRect(0, 0, w, h);

    // Determine current layout: 1 row (per-direction or death) vs 4 rows (combined).
    const variants = state.manifest?.animations?.[state.animation] || {};
    const entries = variants[state.weapon] || [];
    const combined = entries.find((e) => e.combined);
    const rows = combined ? 4 : 1;
    const frameW = Math.floor(w / state.frames);
    const frameH = Math.floor(h / rows);

    // Faint full grid
    ctx.strokeStyle = "rgba(246,228,163,0.25)";
    ctx.lineWidth = 1;
    for (let i = 1; i < state.frames; i++) {
      const x = Math.floor(i * frameW) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.floor(r * frameH) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Highlight the currently-playing frame in each row
    ctx.strokeStyle = "#ffd76b";
    ctx.lineWidth = 2;
    for (let r = 0; r < rows; r++) {
      const x = frameIndex * frameW;
      const y = r * frameH;
      ctx.strokeRect(x + 1, y + 1, frameW - 2, frameH - 2);
    }
  }

  // ----- init -----
  applyDefaultFrames();
  loadManifest();
})();
