(() => {
  const $ = (s, r = document) => r.querySelector(s);

  /* ────────────────────────────────────────────── state */
  const state = {
    manifest: null,
    savedSlices: {},
    characters: [],
    character: "admin",
    weapon: "no-weapon",
    animation: "idle",
    frames: 4,
    fps: 8,
    scale: 3,
    playing: true,
    activeIndex: 0,
    rawZoom: 2,
    drag: null,
  };

  const FRAME_DEFAULTS = { idle: 4, walking: 8, attack: 6, cast: 6, death: 6 };
  const COMBINED_ROW_ORDER = ["up", "left", "down", "right"];
  const ALL_DIRECTIONS = ["down", "left", "right", "up"];

  /* ────────────────────────────────────────────── DOM refs */
  const characterSel     = $("#character-select");
  const applyOtherCharBtn = $("#apply-other-char-btn");
  const weaponSel        = $("#weapon-select");
  const animSel          = $("#anim-select");
  const framesInput      = $("#frames-input");
  const fpsInput         = $("#fps-input");
  const scaleInput       = $("#scale-input");
  const playToggle       = $("#play-toggle");
  const layoutHint       = $("#layout-hint");
  const previewGrid      = $("#preview-grid");
  const sheetImg         = $("#sheet-img");
  const sheetOverlay     = $("#sheet-overlay");
  const sheetStage       = $("#sheet-stage");
  const sheetMeta        = $("#sheet-meta");
  const statusMsg        = $("#status-msg");
  const rawZoomInput     = $("#raw-zoom");
  const applyAllBtn      = $("#apply-all-btn");
  const mirrorBtn        = $("#mirror-btn");
  const fitZoomBtn       = $("#fit-zoom-btn");
  const saveBtn          = $("#save-all-btn");
  const saveCountEl      = $("#save-count");

  /* ────────────────────────────────────────────── status */
  let statusTimer = null;
  function setStatus(text, good = false, autoClearMs = 0) {
    clearTimeout(statusTimer);
    statusMsg.textContent = text || "";
    statusMsg.classList.toggle("is-good", !!good);
    if (autoClearMs > 0) statusTimer = setTimeout(() => setStatus(""), autoClearMs);
  }

  /* ────────────────────────────────────────────── persistence */
  const dirtyCards = new Set();

  function markDirty(card) {
    if (!card || !card.url) return;
    dirtyCards.add(card);
    flashSaveBadge(card, "● unsaved", false, true);
    refreshSaveButton();
  }
  function markClean(card) {
    if (!card) return;
    dirtyCards.delete(card);
    refreshSaveButton();
  }
  function refreshSaveButton() {
    const n = dirtyCards.size;
    saveBtn.disabled = n === 0;
    saveBtn.classList.toggle("has-unsaved", n > 0);
    saveCountEl.textContent = String(n);
    saveCountEl.hidden = n === 0;
  }

  async function saveAllDirty() {
    if (!dirtyCards.size) return;
    const cards = [...dirtyCards];
    saveBtn.disabled = true;
    setStatus(`Saving ${cards.length}…`);
    let ok = 0, bad = 0;
    await Promise.all(cards.map(async (c) => {
      try { await saveSlice(c); ok++; } catch { bad++; }
    }));
    setStatus(
      bad ? `Saved ${ok}, failed ${bad}.` : `Saved ${ok} slice${ok === 1 ? "" : "s"}.`,
      !bad, bad ? 0 : 2500
    );
    refreshSaveButton();
  }
  saveBtn.addEventListener("click", saveAllDirty);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      saveAllDirty();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (!dirtyCards.size) return;
    e.preventDefault();
    e.returnValue = "";
  });

  async function saveSlice(card) {
    if (!card || !card.url || !card.sheet) return;
    const r = await fetch("/api/sprites/slice", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slicePayload(card)),
    });
    if (!r.ok) {
      flashSaveBadge(card, "save failed", true);
      throw new Error(await r.text());
    }
    card.savedSlice = clonePayload(card);
    state.savedSlices[card.url] = card.savedSlice;
    markClean(card);
    flashSaveBadge(card, "saved");
  }

  function slicePayload(card) {
    return {
      url: card.url,
      frames: card.frames,
      frameW: card.frameW,
      frameH: card.frameH,
      offsetX: card.offsetX,
      offsetY: card.offsetY,
      gapX: card.gapX,
      perFrame: !!card.perFrame,
      frameRects: card.perFrame
        ? card.frameRects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
        : null,
      fps: card.fps,
      scale: card.scale,
    };
  }
  function clonePayload(card) {
    return JSON.parse(JSON.stringify(slicePayload(card)));
  }

  async function deleteSlice(card) {
    if (!card || !card.url) return;
    const r = await fetch(`/api/sprites/slice?url=${encodeURIComponent(card.url)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!r.ok) {
      flashSaveBadge(card, "reset failed", true);
      return;
    }
    // Only clear state on confirmed success
    delete state.savedSlices[card.url];
    card.savedSlice = null;
    markClean(card);
    flashSaveBadge(card, "reset");
  }

  function flashSaveBadge(card, text, bad = false, sticky = false) {
    const badge = card.tweak.querySelector(".save-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle("is-bad", bad);
    badge.classList.toggle("is-unsaved", !!sticky);
    badge.classList.add("is-visible");
    clearTimeout(badge._t);
    if (!sticky) {
      badge._t = setTimeout(() => {
        badge.classList.remove("is-visible", "is-unsaved");
      }, 1400);
    }
  }

  /* ────────────────────────────────────────────── image cache */
  // Always cache by base URL (strip #row=N so combined-sheet rows share one entry)
  const imageCache = new Map();
  function loadImage(url) {
    const base = url.split("#")[0];
    if (imageCache.has(base)) return imageCache.get(base);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load " + base));
      img.src = base;
    });
    imageCache.set(base, p);
    return p;
  }

  /* ────────────────────────────────────────────── character list */
  async function loadCharacterList() {
    try {
      const r = await fetch("/api/sprites/characters", { credentials: "same-origin" });
      const body = await r.json();
      state.characters = Array.isArray(body.characters) ? body.characters : [];
    } catch { state.characters = []; }

    characterSel.innerHTML = "";
    const list = state.characters.length
      ? state.characters
      : [{ id: "admin", label: "Admin", hasSheets: false }];
    for (const c of list) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label + (c.hasSheets ? "" : " (no sheets yet)");
      characterSel.appendChild(o);
    }
    if (![...characterSel.options].some((o) => o.value === state.character)) {
      state.character = characterSel.options[0]?.value || "admin";
    }
    characterSel.value = state.character;
  }

  /* ────────────────────────────────────────────── manifest */
  async function loadManifest() {
    const [mRes, sRes] = await Promise.all([
      fetch("/api/sprites/manifest?character=" + encodeURIComponent(state.character), { credentials: "same-origin" }),
      fetch("/api/sprites/slices", { credentials: "same-origin" }),
    ]);
    if (mRes.status === 401 || mRes.status === 403) {
      setStatus("Admin access required — log in as admin first.");
      return;
    }
    if (!mRes.ok) { setStatus("Failed to load manifest."); return; }
    state.manifest = await mRes.json();
    state.savedSlices = sRes.ok ? await sRes.json() : {};
    populateControls();
    rebuild();
    const hasAny = Object.values(state.manifest.animations || {}).some((v) => Object.keys(v).length);
    if (!hasAny) {
      setStatus(
        `No spritesheets found for "${state.character}". ` +
        `Drop PNGs/JPGs into client/assets/sprites/${state.character}/base/<anim>-spritesheets/<variant>/.`
      );
    } else {
      setStatus("");
    }
  }

  characterSel.addEventListener("change", () => {
    state.character = characterSel.value;
    loadManifest();
  });

  applyOtherCharBtn.addEventListener("click", async () => {
    const others = state.characters.filter((c) => c.id !== state.character);
    if (!others.length) {
      alert("No other character folders found. Create one under client/assets/sprites/<name>/base/ first.");
      return;
    }
    const list = others.map((c, i) => `${i + 1}. ${c.label} (${c.id})`).join("\n");
    const pick = prompt(
      `Copy every saved slice from "${state.character}" to which character?\n\n${list}\n\nEnter the number:`,
      "1"
    );
    if (!pick) return;
    const idx = parseInt(pick, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= others.length) return;
    const target = others[idx];
    if (!confirm(`Overwrite "${target.label}"'s existing slice settings for any matching sheets?`)) return;
    try {
      const r = await fetch("/api/sprites/copy-slices", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: state.character, to: target.id }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || r.statusText);
      setStatus(`Copied ${body.copied} slice(s) to ${target.label} (${body.skipped} skipped — no matching file on disk).`, true, 4000);
    } catch (err) {
      setStatus("Copy failed: " + err.message);
    }
  });

  function lookupSaved(url) {
    return (state.savedSlices && state.savedSlices[url]) || null;
  }

  /* ────────────────────────────────────────────── controls */
  function populateControls() {
    const anims = ["idle", "walking", "attack", "cast", "death"];
    animSel.innerHTML = "";
    for (const a of anims) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a[0].toUpperCase() + a.slice(1);
      animSel.appendChild(o);
    }
    animSel.value = state.animation;

    const seen = new Set();
    for (const anim of anims) {
      Object.keys(state.manifest.animations[anim] || {}).forEach((v) => seen.add(v));
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
    state.weapon = weaponSel.value;
  }

  function syncFromControls() {
    state.weapon    = weaponSel.value;
    state.animation = animSel.value;
    state.frames    = clamp(parseInt(framesInput.value, 10) || 1, 1, 64);
    state.fps       = clamp(parseInt(fpsInput.value, 10) || 1, 1, 60);
    state.scale     = clamp(parseInt(scaleInput.value, 10) || 1, 1, 8);
    state.playing   = playToggle.checked;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  weaponSel.addEventListener("change", () => { syncFromControls(); applyDefaultFrames(); rebuild(); });
  animSel.addEventListener("change",   () => { syncFromControls(); applyDefaultFrames(); rebuild(); });
  framesInput.addEventListener("input", () => { syncFromControls(); rebuild(); });

  fpsInput.addEventListener("input", () => {
    syncFromControls();
    const card = previewCards[state.activeIndex];
    if (!card) return;
    card.fps = state.fps;
    updateCardMeta(card);
    markDirty(card);
  });
  scaleInput.addEventListener("input", () => {
    syncFromControls();
    const card = previewCards[state.activeIndex];
    if (!card) return;
    card.scale = state.scale;
    sizePreviewCanvas(card);
    updateCardMeta(card);
    markDirty(card);
  });
  playToggle.addEventListener("change", syncFromControls);

  rawZoomInput.addEventListener("input", () => {
    state.rawZoom = clamp(parseInt(rawZoomInput.value, 10) || 1, 1, 8);
    applyRawZoom();
  });

  if (fitZoomBtn) {
    fitZoomBtn.addEventListener("click", () => {
      const frame = $("#sheet-frame");
      if (!sheetImg.naturalWidth || !frame) return;
      const avail = frame.clientWidth - 32; // ~1rem padding each side
      const z = clamp(Math.floor(avail / sheetImg.naturalWidth), 1, 8);
      rawZoomInput.value = String(z);
      state.rawZoom = z;
      applyRawZoom();
    });
  }

  applyAllBtn.addEventListener("click", () => {
    const src = previewCards[state.activeIndex];
    if (!src || !src.sheet) { setStatus("No active card to copy from."); return; }
    let count = 0;
    for (const c of previewCards) {
      if (c === src || !c.sheet) continue;
      c.frameW = src.frameW;
      c.frameH = src.frameH;
      c.offsetX = src.offsetX;
      // For combined sheets (same image, rows share sheet object), keep per-row Y offset
      if (c.sheet !== src.sheet) c.offsetY = src.offsetY;
      c.gapX    = src.gapX;
      c.frames  = src.frames;
      c.perFrame = !!src.perFrame;
      c.frameRects = src.perFrame ? src.frameRects.map((r) => ({ ...r })) : null;
      c.fps   = src.fps;
      c.scale = src.scale;
      c.activeFrame = 0;
      ensureFrameRectsShape(c);
      rebuildActiveFrameSelect(c);
      writeInputsFrom(c);
      sizePreviewCanvas(c);
      updateCardMeta(c);
      markDirty(c);
      count++;
    }
    markDirty(src);
    setStatus(
      count
        ? `Applied slice to ${count} other direction${count === 1 ? "" : "s"} — Save changes to commit.`
        : "Nothing to copy to (only one sheet loaded).",
      !!count, 3000
    );
  });

  const MIRROR_PARTNER = { right: "left", left: "right", down: "up", up: "down" };
  if (mirrorBtn) mirrorBtn.addEventListener("click", () => {
    const src = previewCards[state.activeIndex];
    if (!src || !src.sheet) { setStatus("Pick a direction card first."); return; }
    const partner = MIRROR_PARTNER[src.direction];
    if (!partner) { setStatus("No mirror partner — only Up / Down / Left / Right directions mirror."); return; }
    const dst = previewCards.find((c) => c.direction === partner && c.sheet);
    if (!dst) { setStatus(`No ${partner.toUpperCase()} sheet loaded — load it first.`); return; }
    dst.frameW = src.frameW; dst.frameH = src.frameH;
    dst.offsetX = src.offsetX; dst.offsetY = src.offsetY;
    dst.gapX   = src.gapX;    dst.frames  = src.frames;
    dst.fps    = src.fps;     dst.scale   = src.scale;
    dst.perFrame = !!src.perFrame;
    dst.frameRects = src.perFrame ? src.frameRects.map((r) => ({ ...r })) : null;
    dst.activeFrame = 0;
    ensureFrameRectsShape(dst);
    rebuildActiveFrameSelect(dst);
    writeInputsFrom(dst);
    sizePreviewCanvas(dst);
    updateCardMeta(dst);
    markDirty(dst);
    setStatus(`Mirrored ${src.direction.toUpperCase()} → ${partner.toUpperCase()} — Save changes to commit.`, true, 3000);
  });

  function applyDefaultFrames() {
    framesInput.value = String(FRAME_DEFAULTS[state.animation] || 4);
    state.frames = parseInt(framesInput.value, 10);
  }

  /* ────────────────────────────────────────────── rebuild */
  let previewCards = [];
  let rafId = null;
  let loopGen = 0; // generation counter — stale loops exit early

  function rebuild() {
    loopGen++;
    cancelAnimationFrame(rafId);
    previewCards = [];
    state.activeIndex = 0;
    previewGrid.innerHTML = "";
    sheetImg.removeAttribute("src");
    sheetOverlay.width = sheetOverlay.height = 0;
    sheetMeta.textContent = "—";

    const variants = state.manifest?.animations?.[state.animation] || {};
    const entries  = variants[state.weapon] || [];
    if (!entries.length) {
      layoutHint.textContent = `No "${state.animation}" sheets for weapon variant "${state.weapon}".`;
      return;
    }

    const isDeath  = state.animation === "death";
    const combined = entries.find((e) => e.combined);
    const perDir   = entries.filter((e) => !e.combined && e.direction);
    const single   = entries.find((e) => !e.combined && !e.direction);

    if (isDeath && single) {
      layoutHint.textContent = "Death — single non-directional strip (1 row × N frames).";
      buildPerDirection([{ ...single, direction: "death" }], false);
    } else if (!combined && !perDir.length && single) {
      layoutHint.textContent = "Single non-directional strip — 1 row × N frames (shared across all facings).";
      buildPerDirection([{ ...single, direction: "all" }], false);
    } else if (combined) {
      layoutHint.textContent = "Combined sheet — 4 rows × N frames · row order: Up · Left · Down · Right.";
      buildCombined(combined);
    } else if (perDir.length) {
      const haveAll = ALL_DIRECTIONS.every((d) => perDir.some((e) => e.direction === d));
      layoutHint.textContent = haveAll
        ? "Per-direction strips — 4 separate sheets (1 row × N frames each)."
        : `Per-direction strips — ${perDir.length} / 4 directions present.`;
      buildPerDirection(perDir, true);
    }
  }

  function buildPerDirection(entries, useDirNames) {
    const ordered = useDirNames
      ? [...entries].sort((a, b) => ALL_DIRECTIONS.indexOf(a.direction) - ALL_DIRECTIONS.indexOf(b.direction))
      : entries;

    const myGen = loopGen;
    let firstLoaded = false;

    for (const e of ordered) {
      const fallback = e.direction === "all" ? "all" : "death";
      const card = makeCard(useDirNames ? e.direction : fallback, e.url);
      card.savedSlice = lookupSaved(e.url);
      previewGrid.appendChild(card.el);
      previewCards.push(card);

      loadImage(e.url).then((img) => {
        if (myGen !== loopGen) return;
        card.sheet = img;
        const saved = card.savedSlice;
        if (saved) {
          hydrateFromSaved(card, saved);
        } else {
          card.frameW  = Math.max(1, Math.floor(img.naturalWidth / state.frames));
          card.frameH  = img.naturalHeight;
          card.offsetX = 0; card.offsetY = 0; card.gapX = 0;
          card.frames  = state.frames;
          card.fps     = state.fps;
          card.scale   = state.scale;
        }
        ensureFrameRectsShape(card);
        rebuildActiveFrameSelect(card);
        writeInputsFrom(card);
        sizePreviewCanvas(card);
        updateCardMeta(card);

        if (card === previewCards[0]) {
          previewCards[0].el.classList.add("is-active");
          showRaw(card);
          syncGlobalsToCard(card);
        }
        if (!firstLoaded) { firstLoaded = true; startLoop(myGen); }
      }).catch(() => {
        if (myGen !== loopGen) return;
        card.el.classList.add("is-missing");
        card.foot.querySelector(".frame-info").textContent = "load failed";
      });
    }

    // Placeholder cards for missing directions
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
    const myGen = loopGen;
    for (let i = 0; i < 4; i++) {
      // URL carries #row=N so lookupSaved can distinguish rows
      const card = makeCard(COMBINED_ROW_ORDER[i], `${entry.url}#row=${i}`);
      card.row = i;
      previewGrid.appendChild(card.el);
      previewCards.push(card);
    }
    loadImage(entry.url).then((img) => {
      if (myGen !== loopGen) return;
      const rowH  = Math.max(1, Math.round(img.naturalHeight / 4));
      const frameW = Math.max(1, Math.floor(img.naturalWidth / state.frames));
      for (const card of previewCards) {
        card.sheet = img;
        const saved = lookupSaved(card.url);
        card.savedSlice = saved;
        if (saved) {
          hydrateFromSaved(card, saved);
        } else {
          card.frameW  = frameW; card.frameH  = rowH;
          card.offsetX = 0;      card.offsetY = card.row * rowH;
          card.gapX    = 0;      card.frames  = state.frames;
          card.fps     = state.fps; card.scale = state.scale;
        }
        ensureFrameRectsShape(card);
        rebuildActiveFrameSelect(card);
        writeInputsFrom(card);
        sizePreviewCanvas(card);
        updateCardMeta(card);
      }
      previewCards[0].el.classList.add("is-active");
      showRaw(previewCards[0]);
      syncGlobalsToCard(previewCards[0]);
      startLoop(myGen);
    }).catch(() => {
      if (myGen !== loopGen) return;
      setStatus("Failed to load combined sheet.");
    });
  }

  /* ────────────────────────────────────────────── card data helpers */
  function hydrateFromSaved(card, saved) {
    card.frames  = saved.frames;
    card.frameW  = saved.frameW; card.frameH = saved.frameH;
    card.offsetX = saved.offsetX; card.offsetY = saved.offsetY;
    card.gapX    = saved.gapX || 0;
    card.perFrame = !!saved.perFrame;
    card.frameRects = saved.perFrame && Array.isArray(saved.frameRects)
      ? saved.frameRects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
      : null;
    card.fps   = Number.isInteger(saved.fps)   ? saved.fps   : state.fps;
    card.scale = Number.isInteger(saved.scale) ? saved.scale : state.scale;
    card.activeFrame = 0;
  }

  // Push the active card's values into the global toolbar inputs
  function syncGlobalsToCard(card) {
    if (!card) return;
    if (Number.isInteger(card.fps))    { fpsInput.value    = String(card.fps);    state.fps    = card.fps;    }
    if (Number.isInteger(card.scale))  { scaleInput.value  = String(card.scale);  state.scale  = card.scale;  }
    if (Number.isInteger(card.frames)) { framesInput.value = String(card.frames); state.frames = card.frames; }
  }

  function ensureFrameRectsShape(card) {
    if (!card.perFrame) {
      card.activeFrame = clamp(card.activeFrame || 0, 0, Math.max(0, card.frames - 1));
      return;
    }
    if (!Array.isArray(card.frameRects)) card.frameRects = [];
    while (card.frameRects.length < card.frames) {
      const last = card.frameRects[card.frameRects.length - 1]
        || { x: card.offsetX, y: card.offsetY, w: card.frameW, h: card.frameH };
      card.frameRects.push({ x: last.x + last.w, y: last.y, w: last.w, h: last.h });
    }
    if (card.frameRects.length > card.frames) card.frameRects.length = card.frames;
    card.activeFrame = clamp(card.activeFrame || 0, 0, card.frames - 1);
  }

  function rebuildActiveFrameSelect(card) {
    const sel = card.pfRow.querySelector('[data-k="activeFrame"]');
    sel.innerHTML = "";
    for (let i = 0; i < card.frames; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `Frame ${i + 1} / ${card.frames}`;
      sel.appendChild(o);
    }
    sel.value = String(clamp(card.activeFrame || 0, 0, card.frames - 1));
    sel.disabled = !card.perFrame;
    card.pfRow.querySelector('[data-k="perFrame"]').checked = !!card.perFrame;
    card.pfRow.classList.toggle("is-on", !!card.perFrame);
  }

  function writeInputsFrom(card) {
    card.tweak.querySelector('[data-k="frames"]').value = card.frames;
    if (card.perFrame && card.frameRects && card.frameRects[card.activeFrame]) {
      const r = card.frameRects[card.activeFrame];
      card.tweak.querySelector('[data-k="frameW"]').value = r.w;
      card.tweak.querySelector('[data-k="frameH"]').value = r.h;
      card.tweak.querySelector('[data-k="offsetX"]').value = r.x;
      card.tweak.querySelector('[data-k="offsetY"]').value = r.y;
    } else {
      card.tweak.querySelector('[data-k="frameW"]').value = card.frameW;
      card.tweak.querySelector('[data-k="frameH"]').value = card.frameH;
      card.tweak.querySelector('[data-k="offsetX"]').value = card.offsetX;
      card.tweak.querySelector('[data-k="offsetY"]').value = card.offsetY;
    }
    const gapInp = card.tweak.querySelector('[data-k="gapX"]');
    gapInp.value = card.gapX;
    gapInp.disabled = !!card.perFrame;
    gapInp.title = card.perFrame
      ? "Disabled in per-frame mode — each frame encodes its own position."
      : "Horizontal gap between frames (px)";
  }

  function resetCard(card) {
    if (!card.sheet) return;
    card.gapX = 0; card.perFrame = false; card.frameRects = null; card.activeFrame = 0;
    card.fps   = state.fps; card.scale = state.scale;
    card.acc   = 0; card.frameIndex = 0;

    const isCombined = typeof card.row === "number" &&
      previewCards.some((c) => c !== card && c.sheet === card.sheet);
    if (isCombined) {
      card.frameW  = Math.max(1, Math.floor(card.sheet.naturalWidth / state.frames));
      card.frameH  = Math.max(1, Math.round(card.sheet.naturalHeight / 4));
      card.offsetX = 0;
      card.offsetY = card.row * card.frameH;
    } else {
      card.frameW  = Math.max(1, Math.floor(card.sheet.naturalWidth / state.frames));
      card.frameH  = card.sheet.naturalHeight;
      card.offsetX = 0; card.offsetY = 0;
    }
    card.frames = state.frames;
    rebuildActiveFrameSelect(card);
    writeInputsFrom(card);
    sizePreviewCanvas(card);
    updateCardMeta(card);
    if (card === previewCards[state.activeIndex]) {
      drawSheetOverlay();
      updateRawMeta(card);
    }
  }

  /* ────────────────────────────────────────────── card factory */
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

    const tweak = document.createElement("div");
    tweak.className = "preview-tweak";
    tweak.innerHTML = `
      <label title="Number of frames in this strip">N<input type="number" data-k="frames" min="1" max="64" /></label>
      <label title="Frame width (px)">W<input type="number" data-k="frameW" min="1" /></label>
      <label title="Frame height (px)">H<input type="number" data-k="frameH" min="1" /></label>
      <label title="X pixel of first frame's left edge">X<input type="number" data-k="offsetX" min="0" /></label>
      <label title="Y pixel of first frame's top edge">Y<input type="number" data-k="offsetY" min="0" /></label>
      <label title="Horizontal gap between frames (px)">G<input type="number" data-k="gapX" min="0" /></label>
      <button type="button" class="t-reset" title="Reset to auto-computed defaults and delete saved settings">⟲</button>
      <span class="save-badge" aria-live="polite"></span>
    `;

    const pfRow = document.createElement("div");
    pfRow.className = "preview-tweak-pf";
    pfRow.innerHTML = `
      <label class="pf-toggle" title="Per-frame: each frame has its own crop rect — for sheets with non-uniform frame sizes or positions.">
        <input type="checkbox" data-k="perFrame" />
        <span>Per-frame</span>
      </label>
      <label class="pf-active">
        <span>Editing</span>
        <select data-k="activeFrame"></select>
      </label>
    `;

    const card = {
      el, canvas, ctx: canvas.getContext("2d"),
      foot, tweak, pfRow, direction, url,
      sheet: null, savedSlice: null,
      frameW: 1, frameH: 1, offsetX: 0, offsetY: 0, gapX: 0,
      frames: state.frames, perFrame: false, frameRects: null, activeFrame: 0,
      row: 0, fps: state.fps, scale: state.scale,
      frameIndex: 0, acc: 0,
    };

    tweak.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", () => onCardInput(card, inp))
    );
    tweak.querySelector(".t-reset").addEventListener("click", async () => {
      resetCard(card);
      await deleteSlice(card);
    });

    pfRow.querySelector('[data-k="perFrame"]').addEventListener("change", (e) => {
      togglePerFrame(card, e.target.checked);
    });
    pfRow.querySelector('[data-k="activeFrame"]').addEventListener("change", (e) => {
      card.activeFrame = clamp(parseInt(e.target.value, 10) || 0, 0, card.frames - 1);
      writeInputsFrom(card);
      if (card === previewCards[state.activeIndex]) {
        drawSheetOverlay();
        updateRawMeta(card);
      }
    });

    el.addEventListener("click", () => focusCard(card));
    el.addEventListener("focus", () => focusCard(card));

    el.append(label, wrap, foot, tweak, pfRow);
    return card;
  }

  /* ────────────────────────────────────────────── card events */
  function onCardInput(card, inp) {
    const k   = inp.dataset.k;
    const raw = parseInt(inp.value, 10);
    const minV = parseInt(inp.min, 10) || 0;
    const v   = Math.max(minV, Number.isFinite(raw) ? raw : minV);

    if (k === "frames") {
      card.frames = Math.max(1, v);
      ensureFrameRectsShape(card);
      rebuildActiveFrameSelect(card);
    } else if (card.perFrame && card.frameRects && k !== "gapX") {
      const r = card.frameRects[card.activeFrame];
      if (!r) return;
      if      (k === "frameW")  r.w = Math.max(1, v);
      else if (k === "frameH")  r.h = Math.max(1, v);
      else if (k === "offsetX") r.x = Math.max(0, v);
      else if (k === "offsetY") r.y = Math.max(0, v);
    } else {
      card[k] = v;
    }

    sizePreviewCanvas(card);
    updateCardMeta(card);
    if (card === previewCards[state.activeIndex]) {
      drawSheetOverlay();
      updateRawMeta(card);
    }
    markDirty(card);
  }

  function togglePerFrame(card, on) {
    card.perFrame = !!on;
    if (card.perFrame && (!Array.isArray(card.frameRects) || card.frameRects.length !== card.frames)) {
      card.frameRects = [];
      for (let i = 0; i < card.frames; i++) {
        card.frameRects.push({
          x: card.offsetX + i * (card.frameW + card.gapX),
          y: card.offsetY,
          w: card.frameW,
          h: card.frameH,
        });
      }
      card.activeFrame = 0;
    }
    ensureFrameRectsShape(card);
    rebuildActiveFrameSelect(card);
    writeInputsFrom(card);
    sizePreviewCanvas(card);
    updateCardMeta(card);
    if (card === previewCards[state.activeIndex]) {
      drawSheetOverlay();
      updateRawMeta(card);
    }
    markDirty(card);
  }

  function focusCard(card) {
    const idx = previewCards.indexOf(card);
    if (idx < 0) return;
    state.activeIndex = idx;
    previewCards.forEach((c) => c.el.classList.toggle("is-active", c === card));
    showRaw(card);
    syncGlobalsToCard(card);
    writeInputsFrom(card);
  }

  /* ────────────────────────────────────────────── canvas sizing + meta */
  function previewBounds(card) {
    if (card.perFrame && card.frameRects?.length) {
      let w = 1, h = 1;
      for (const r of card.frameRects) {
        if (r.w > w) w = r.w;
        if (r.h > h) h = r.h;
      }
      return { w, h };
    }
    return { w: Math.max(1, card.frameW), h: Math.max(1, card.frameH) };
  }

  function sizePreviewCanvas(card) {
    const b = previewBounds(card);
    const s = Math.max(1, card.scale || state.scale);
    card.canvas.width  = b.w; card.canvas.height = b.h;
    card.canvas.style.width  = `${b.w * s}px`;
    card.canvas.style.height = `${b.h * s}px`;
    card.ctx.imageSmoothingEnabled = false;
  }

  function updateCardMeta(card) {
    if (!card.sheet) return;
    const sw = card.sheet.naturalWidth, sh = card.sheet.naturalHeight;
    const fps = card.fps || state.fps, sc = card.scale || state.scale;
    if (card.perFrame && card.frameRects) {
      const r = card.frameRects[card.activeFrame] || { x: 0, y: 0, w: 0, h: 0 };
      card.foot.querySelector(".frame-info").textContent =
        `${sw}×${sh} · per-frame · #${card.activeFrame + 1}/${card.frames}: ${r.w}×${r.h}@(${r.x},${r.y}) · ${fps}fps ${sc}×`;
    } else {
      const gap = card.gapX ? ` +${card.gapX}gap` : "";
      card.foot.querySelector(".frame-info").textContent =
        `${sw}×${sh} · ${card.frameW}×${card.frameH}@(${card.offsetX},${card.offsetY})${gap} · ${card.frames}fr ${fps}fps ${sc}×`;
    }
  }

  /* ────────────────────────────────────────────── render loop */
  function startLoop(gen) {
    cancelAnimationFrame(rafId);
    let last = performance.now();
    function tick(now) {
      if (gen !== loopGen) return; // stale — a newer rebuild superseded us
      const dt = (now - last) / 1000; last = now;
      for (const c of previewCards) {
        if (!c.sheet) continue;
        if (!Number.isFinite(c.acc)) c.acc = 0;
        if (!Number.isInteger(c.frameIndex)) c.frameIndex = 0;
        if (state.playing) c.acc += dt;
        const fps = Math.max(1, c.fps || state.fps);
        while (c.acc >= 1 / fps) { c.acc -= 1 / fps; c.frameIndex++; }
        const idx = c.frameIndex % Math.max(1, c.frames);
        c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
        let sx, sy, sw, sh;
        if (c.perFrame && c.frameRects && c.frameRects[idx]) {
          ({ x: sx, y: sy, w: sw, h: sh } = c.frameRects[idx]);
        } else {
          sx = c.offsetX + idx * (c.frameW + c.gapX);
          sy = c.offsetY; sw = c.frameW; sh = c.frameH;
        }
        if (sw > 0 && sh > 0) c.ctx.drawImage(c.sheet, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      const active = previewCards[state.activeIndex];
      drawSheetOverlay(active ? (active.frameIndex || 0) : 0);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  /* ────────────────────────────────────────────── raw sheet panel */

  // FIX: handle combined sheets (same image URL, only #row=N differs) and
  // already-cached images that won't re-fire onload.
  function showRaw(card) {
    if (!card || !card.url) return;
    const baseUrl = card.url.split("#")[0]; // strip #row=N

    function onReady() {
      sheetOverlay.width  = sheetImg.naturalWidth;
      sheetOverlay.height = sheetImg.naturalHeight;
      applyRawZoom();
      updateRawMeta(card);
      drawSheetOverlay();
    }

    // Compare against current absolute src (browser resolves relative URLs)
    const absBase = new URL(baseUrl, location.href).href;
    const curBase = sheetImg.src ? sheetImg.src.split("#")[0] : "";

    if (curBase === absBase && sheetImg.complete && sheetImg.naturalWidth > 0) {
      // Same image already fully loaded — skip the src assignment, just redraw
      onReady();
    } else {
      sheetImg.onload  = onReady;
      sheetImg.onerror = () => { sheetMeta.textContent = "Error loading image."; };
      sheetImg.src = baseUrl;
    }
  }

  function applyRawZoom() {
    if (!sheetImg.naturalWidth) return;
    const z = state.rawZoom;
    const w = sheetImg.naturalWidth  * z;
    const h = sheetImg.naturalHeight * z;
    sheetImg.style.width  = `${w}px`;
    sheetImg.style.height = `${h}px`;
    sheetOverlay.style.width  = `${w}px`;
    sheetOverlay.style.height = `${h}px`;
  }

  function updateRawMeta(card) {
    if (!card || !sheetImg.naturalWidth) return;
    const dir = card.direction.toUpperCase();
    const iw  = sheetImg.naturalWidth, ih = sheetImg.naturalHeight;
    if (card.perFrame && card.frameRects) {
      const r = card.frameRects[card.activeFrame] || { x: 0, y: 0, w: 0, h: 0 };
      sheetMeta.textContent =
        `${dir} · ${iw}×${ih}px · per-frame · ` +
        `editing ${card.activeFrame + 1}/${card.frames}: ${r.w}×${r.h} @ (${r.x},${r.y}) · zoom ${state.rawZoom}×`;
    } else {
      const gap = card.gapX ? ` · gap ${card.gapX}px` : "";
      sheetMeta.textContent =
        `${dir} · ${iw}×${ih}px · slice ${card.frameW}×${card.frameH} @ (${card.offsetX},${card.offsetY})${gap} · ` +
        `${card.frames} frames · zoom ${state.rawZoom}×`;
    }
  }

  function isCombinedCard(card) {
    // A card is a "row" of a combined sheet if other cards share the same sheet image
    return typeof card.row === "number" &&
      previewCards.some((c) => c !== card && c.sheet != null && c.sheet === card.sheet);
  }

  function drawSheetOverlay(frameIndex = 0) {
    const card = previewCards[state.activeIndex];
    // FIX: reliable check — don't use filename indexOf; check image readiness directly
    if (!card || !card.sheet || !sheetImg.complete || !sheetImg.naturalWidth) return;

    const ctx = sheetOverlay.getContext("2d");
    const w   = sheetOverlay.width, h = sheetOverlay.height;
    ctx.clearRect(0, 0, w, h);

    // For combined sheets: dim all rows except the active one
    if (isCombinedCard(card)) {
      const rowH = Math.round(h / 4);
      ctx.fillStyle = "rgba(0,0,0,0.52)";
      for (let r = 0; r < 4; r++) {
        if (r === card.row) continue;
        ctx.fillRect(0, r * rowH, w, rowH);
      }
      // Label the active row
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, card.row * rowH, 42, 15);
      ctx.fillStyle = "#ffd76b";
      ctx.font = "bold 10px monospace";
      ctx.fillText(`▶ ${COMBINED_ROW_ORDER[card.row].toUpperCase()}`, 3, card.row * rowH + 11);
      ctx.restore();
    }

    if (card.perFrame && card.frameRects) {
      // All frame rects (faint gold)
      ctx.strokeStyle = "rgba(246,228,163,0.4)";
      ctx.lineWidth = 1;
      for (const r of card.frameRects) {
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      // Playing frame (bright gold)
      const playR = card.frameRects[frameIndex % Math.max(1, card.frames)];
      if (playR) {
        ctx.strokeStyle = "#ffd76b"; ctx.lineWidth = 2;
        ctx.strokeRect(playR.x + 1, playR.y + 1, playR.w - 2, playR.h - 2);
      }
      // Active/editing frame (cyan dashed, drawn on top)
      const editR = card.frameRects[card.activeFrame];
      if (editR) {
        ctx.strokeStyle = "#7fdcff"; ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(editR.x + 1, editR.y + 1, editR.w - 2, editR.h - 2);
        ctx.setLineDash([]);
        // Frame number label
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(editR.x, editR.y, 24, 13);
        ctx.fillStyle = "#7fdcff";
        ctx.font = "bold 9px monospace";
        ctx.fillText(`#${card.activeFrame + 1}`, editR.x + 2, editR.y + 10);
      }
    } else {
      // Uniform grid
      ctx.strokeStyle = "rgba(246,228,163,0.4)"; ctx.lineWidth = 1;
      for (let i = 0; i < card.frames; i++) {
        const x = card.offsetX + i * (card.frameW + card.gapX);
        ctx.strokeRect(x + 0.5, card.offsetY + 0.5, card.frameW - 1, card.frameH - 1);
      }
      // Gap shading
      if (card.gapX > 0) {
        ctx.fillStyle = "rgba(140,220,255,0.12)";
        for (let i = 0; i < card.frames - 1; i++) {
          const x = card.offsetX + i * (card.frameW + card.gapX) + card.frameW;
          ctx.fillRect(x, card.offsetY, card.gapX, card.frameH);
        }
      }
      // Active (playing) frame highlight
      const idx = frameIndex % Math.max(1, card.frames);
      ctx.strokeStyle = "#ffd76b"; ctx.lineWidth = 2;
      ctx.strokeRect(
        card.offsetX + idx * (card.frameW + card.gapX) + 1,
        card.offsetY + 1,
        card.frameW - 2,
        card.frameH - 2
      );
    }

    // Live drag ghost
    if (state.drag) {
      const r = normalizeDrag(state.drag);
      if (!card.perFrame) {
        const stride = r.w + card.gapX;
        ctx.strokeStyle = "rgba(140,220,255,0.4)"; ctx.lineWidth = 1;
        for (let i = 0; i < card.frames; i++) {
          const x = r.x + i * stride;
          if (x + r.w > w) break;
          ctx.strokeRect(x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        }
      }
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#7fdcff"; ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.setLineDash([]);
    }
  }

  /* ────────────────────────────────────────────── drag-to-crop */
  function eventToImagePx(e) {
    const rect = sheetStage.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    const cx   = src.clientX - rect.left;
    const cy   = src.clientY - rect.top;
    return {
      x: clamp(Math.round(cx / state.rawZoom), 0, sheetImg.naturalWidth  || 0),
      y: clamp(Math.round(cy / state.rawZoom), 0, sheetImg.naturalHeight || 0),
    };
  }

  function startDrag(e) {
    if (!sheetImg.naturalWidth) return;
    e.preventDefault();
    const p = eventToImagePx(e);
    state.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drawSheetOverlay();
  }
  function moveDrag(e) {
    if (!state.drag) return;
    const p = eventToImagePx(e);
    state.drag.x1 = p.x; state.drag.y1 = p.y;
    const r = normalizeDrag(state.drag);
    const card = previewCards[state.activeIndex];
    sheetMeta.textContent = card?.perFrame
      ? `Dragging frame ${card.activeFrame + 1}/${card.frames} · ${r.w}×${r.h} @ (${r.x},${r.y})`
      : `Dragging · ${r.w}×${r.h} @ (${r.x},${r.y}) · ${card?.frames || 0} frames`;
    drawSheetOverlay();
  }
  function commitDrag() {
    if (!state.drag) return;
    const r    = normalizeDrag(state.drag);
    state.drag = null;
    const card = previewCards[state.activeIndex];
    if (!card || r.w < 2 || r.h < 2) { drawSheetOverlay(); return; }

    if (card.perFrame && card.frameRects) {
      const fr = card.frameRects[card.activeFrame];
      if (fr) { fr.x = r.x; fr.y = r.y; fr.w = r.w; fr.h = r.h; }
      // Auto-advance to the next frame so rapid dragging slices all frames quickly
      if (card.activeFrame < card.frames - 1) {
        card.activeFrame++;
        const sel = card.pfRow.querySelector('[data-k="activeFrame"]');
        if (sel) sel.value = String(card.activeFrame);
      }
    } else {
      card.frameW = r.w; card.frameH = r.h;
      card.offsetX = r.x; card.offsetY = r.y;
    }
    writeInputsFrom(card);
    sizePreviewCanvas(card);
    updateCardMeta(card);
    updateRawMeta(card);
    markDirty(card);
    drawSheetOverlay();
  }

  sheetStage.addEventListener("mousedown",  startDrag);
  sheetStage.addEventListener("touchstart", startDrag, { passive: false });
  window.addEventListener("mousemove",  moveDrag);
  window.addEventListener("touchmove",  (e) => moveDrag(e), { passive: true });
  window.addEventListener("mouseup",  commitDrag);
  window.addEventListener("touchend", commitDrag);

  function normalizeDrag(d) {
    return {
      x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
      w: Math.max(1, Math.abs(d.x1 - d.x0)),
      h: Math.max(1, Math.abs(d.y1 - d.y0)),
    };
  }

  /* ────────────────────────────────────────────── init */
  applyDefaultFrames();
  (async () => {
    await loadCharacterList();
    await loadManifest();
  })();
})();
