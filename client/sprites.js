"use strict";
/* ═══════════════════════════════════════════════════════════════
   Freeform Mana — Sprite Editor  (complete rewrite)
   Two-column dashboard: sidebar + canvas viewport.
   Layout profiles: Strip-H, Strip-V, Grid Matrix, Irregular.
   Canvas pan/zoom, click-drag crop, arrow-key micro-adjust,
   Alt+drag anchor point.
═══════════════════════════════════════════════════════════════ */

// ── Constants ────────────────────────────────────────────────
const SOLO_DIRS      = ["down","left","right","up"];
const COMBINED_ORDER = ["up","left","down","right"];
const DIR_LABEL      = { down:"Down", left:"Left", right:"Right", up:"Up", all:"All", death:"Death" };
const ANCHOR_COL     = "#e040fb";
const FRAME_FILL     = "rgba(61,158,255,0.12)";
const FRAME_STROKE   = "rgba(61,158,255,0.50)";
const ACTIVE_STROKE  = "#ffd76b";
const EDIT_STROKE    = "#00d4ff";
const DIM_FILL       = "rgba(0,0,0,0.52)";
const CROP_STROKE    = "rgba(255,220,60,0.9)";
const CHECKER_SZ     = 10;

// ── State ────────────────────────────────────────────────────
const state = {
  characters:  [],
  manifest:    null,
  savedSlices: {},
  cards:       {},        // dir → card
  activeDir:   null,
  dirtyDirs:   new Set(),
  playing:     true,
  syncing:     false,     // suppress re-entrant input events
  spaceDown:   false,
  vp: {                   // viewport
    panX:0, panY:0, zoom:1,
    panning:false, panStart:null,
    cropping:false, cropA:null, cropB:null,
    anchorDrag:false,
    lastMouse:null,
  },
};

// ── DOM refs ─────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const charSel      = $("character-select");
const weaponSel    = $("weapon-select");
const animSel      = $("anim-select");
const profileSel   = $("profile-select");
const fpsInput     = $("fps-input");
const scaleInput   = $("scale-input");
const playToggle   = $("play-toggle");
const anchorXIn    = $("anchor-x");
const anchorYIn    = $("anchor-y");
const saveBtn      = $("save-all-btn");
const saveCnt      = $("save-count");
const statusMsg    = $("status-msg");
const dirTabsEl    = $("dir-tabs");
const zoomSlider   = $("zoom-slider");
const zoomDisplay  = $("zoom-display");
const fitBtn       = $("fit-btn");
const oneBtn       = $("one-btn");
const sheetMeta    = $("sheet-meta");
const emptyHint    = $("empty-hint");
const sheetVp      = $("sheet-viewport");
const sheetCanvas  = $("sheet-canvas");
const previewCvs   = $("preview-canvas");
const prevDirBadge = $("preview-dir-badge");
const panelStrip   = $("panel-strip");
const panelGrid    = $("panel-grid");
const panelIrr     = $("panel-irregular");
// strip inputs
const sN   = $("strip-n"),  sGap = $("strip-gap"),
      sFW  = $("strip-fw"), sFH  = $("strip-fh"),
      sOX  = $("strip-ox"), sOY  = $("strip-oy");
// grid inputs
const gR  = $("grid-rows"), gC  = $("grid-cols"),
      gFW = $("grid-fw"),   gFH = $("grid-fh"),
      gOX = $("grid-ox"),   gOY = $("grid-oy"),
      gGX = $("grid-gx"),   gGY = $("grid-gy");
// irregular inputs
const iN  = $("irr-n"), iFr = $("irr-frame"),
      iX  = $("irr-x"), iY  = $("irr-y"),
      iW  = $("irr-w"), iH  = $("irr-h");

// ── Canvas contexts ──────────────────────────────────────────
const sheetCtx   = sheetCanvas.getContext("2d");
const previewCtx = previewCvs.getContext("2d");
let   checkerPat = null;

function makeChecker() {
  const sz = CHECKER_SZ, pc = Object.assign(document.createElement("canvas"), { width:sz*2, height:sz*2 });
  const px = pc.getContext("2d");
  px.fillStyle = "#131824"; px.fillRect(0,0,sz*2,sz*2);
  px.fillStyle = "#0d1119"; px.fillRect(0,0,sz,sz); px.fillRect(sz,sz,sz,sz);
  checkerPat = sheetCtx.createPattern(pc, "repeat");
}

// ── Image cache ──────────────────────────────────────────────
const imgCache = {};
function loadImage(url) {
  if (imgCache[url]) return Promise.resolve(imgCache[url]);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => { imgCache[url] = img; res(img); };
    img.onerror = rej;
    img.src     = url;
  });
}

// ── Card factory ─────────────────────────────────────────────
function makeCard(dir, url, row = 0) {
  return { dir, url, row,
    sheet:null, savedSlice:null,
    profile:"strip-h",
    gridRows:1, gridCols:4,
    frames:4, frameW:64, frameH:64,
    offsetX:0, offsetY:0, gapX:0, gapY:0,
    frameRects:null, activeFrame:0,
    anchorX:0.5, anchorY:1.0,
    fps:8, scale:3, frameIdx:0, acc:0,
  };
}

function hydrateCard(card, saved) {
  card.savedSlice = saved;
  card.profile    = saved.profile  || (saved.perFrame ? "irregular" : "strip-h");
  card.gridRows   = saved.gridRows || 1;
  card.gridCols   = saved.gridCols || (saved.frames || 4);
  card.frames     = saved.frames   || 4;
  card.frameW     = saved.frameW   || 64;
  card.frameH     = saved.frameH   || 64;
  card.offsetX    = saved.offsetX  || 0;
  card.offsetY    = saved.offsetY  || 0;
  card.gapX       = saved.gapX    || 0;
  card.gapY       = saved.gapY    || 0;
  card.anchorX    = saved.anchorX  != null ? saved.anchorX : 0.5;
  card.anchorY    = saved.anchorY  != null ? saved.anchorY : 1.0;
  card.fps        = saved.fps   || 8;
  card.scale      = saved.scale || 3;
  card.frameRects = (saved.perFrame && Array.isArray(saved.frameRects))
    ? saved.frameRects.map(r => ({ ...r })) : null;
  card.activeFrame = 0; card.frameIdx = 0; card.acc = 0;
}

// ── Payload (server-compatible, extends old fields) ──────────
function slicePayload(card) {
  const af = getAnimFrames(card);
  return {
    url:      card.url,
    profile:  card.profile,
    gridRows: card.gridRows,
    gridCols: card.gridCols,
    gapY:     card.gapY,
    anchorX:  card.anchorX,
    anchorY:  card.anchorY,
    frames:   af.length,
    frameW:   card.frameW,
    frameH:   card.frameH,
    offsetX:  card.offsetX,
    offsetY:  card.offsetY,
    gapX:     card.gapX,
    perFrame: card.profile === "irregular",
    frameRects: (card.profile === "irregular" && card.frameRects)
      ? card.frameRects.map(r => ({ x:r.x, y:r.y, w:r.w, h:r.h })) : null,
    fps:   card.fps,
    scale: card.scale,
  };
}

// ── Frame geometry ───────────────────────────────────────────
function getFrameRects(card) {
  if (card.profile === "irregular") {
    return (card.frameRects || []).map((r,i) => ({ ...r, frameIdx:i }));
  }
  if (card.profile === "grid") {
    const rects = [];
    for (let r = 0; r < card.gridRows; r++)
      for (let c = 0; c < card.gridCols; c++)
        rects.push({
          x: card.offsetX + c * (card.frameW + card.gapX),
          y: card.offsetY + r * (card.frameH + card.gapY),
          w: card.frameW, h: card.frameH,
          row:r, col:c, frameIdx: r*card.gridCols+c,
        });
    return rects;
  }
  if (card.profile === "strip-h") {
    return Array.from({length: card.frames}, (_, i) => ({
      x: card.offsetX + i*(card.frameW+card.gapX),
      y: card.offsetY, w: card.frameW, h: card.frameH, frameIdx:i,
    }));
  }
  if (card.profile === "strip-v") {
    return Array.from({length: card.frames}, (_, i) => ({
      x: card.offsetX,
      y: card.offsetY + i*(card.frameH+card.gapY),
      w: card.frameW, h: card.frameH, frameIdx:i,
    }));
  }
  return [];
}

function getAnimFrames(card) {
  const all = getFrameRects(card);
  return card.profile === "grid" ? all.filter(r => r.row === card.row) : all;
}

function ensureFrameRects(card, n) {
  if (!card.frameRects) card.frameRects = [];
  while (card.frameRects.length < n)
    card.frameRects.push({ x: card.offsetX, y: card.offsetY, w: card.frameW, h: card.frameH });
  card.frameRects.length = n;
}

// ── Dirty / save UI ─────────────────────────────────────────
function markDirty(dir)  { state.dirtyDirs.add(dir);    refreshTabDot(dir); refreshSaveBtn(); }
function markClean(dir)  { state.dirtyDirs.delete(dir); refreshTabDot(dir); refreshSaveBtn(); }
function refreshSaveBtn() {
  const n = state.dirtyDirs.size;
  saveBtn.disabled = n === 0;
  saveBtn.classList.toggle("has-unsaved", n > 0);
  saveCnt.hidden = n === 0;
  saveCnt.textContent = String(n);
}
function refreshTabDot(dir) {
  const tab = dirTabsEl.querySelector(`[data-dir="${dir}"]`);
  if (!tab) return;
  const card = state.cards[dir];
  const isDirty  = state.dirtyDirs.has(dir);
  const hasSaved = !!(card && card.savedSlice);
  tab.classList.toggle("is-dirty", isDirty);
  tab.classList.toggle("is-saved", !isDirty && hasSaved);
}
function setStatus(msg, cls = "") {
  statusMsg.textContent = msg;
  statusMsg.className   = "status-msg" + (cls ? " " + cls : "");
}

// ── Profile panel switcher ───────────────────────────────────
function showProfilePanel(prof) {
  panelStrip.classList.toggle("is-active", prof === "strip-h" || prof === "strip-v");
  panelGrid.classList.toggle("is-active",  prof === "grid");
  panelIrr.classList.toggle("is-active",   prof === "irregular");
  const gapLbl = document.querySelector("#strip-gap-wrap .field-label");
  if (gapLbl) gapLbl.textContent = prof === "strip-v" ? "Gap Y (px)" : "Gap X (px)";
}

// ── Sidebar ↔ Card sync ──────────────────────────────────────
function syncSidebarFromCard(card) {
  if (!card) return;
  state.syncing = true;

  profileSel.value  = card.profile;
  showProfilePanel(card.profile);
  fpsInput.value    = card.fps;
  scaleInput.value  = card.scale;
  anchorXIn.value   = card.anchorX.toFixed(2);
  anchorYIn.value   = card.anchorY.toFixed(2);

  // strip
  sN.value  = card.frames;  sFW.value = card.frameW; sFH.value = card.frameH;
  sOX.value = card.offsetX; sOY.value = card.offsetY;
  sGap.value = card.profile === "strip-v" ? card.gapY : card.gapX;
  // grid
  gR.value  = card.gridRows; gC.value  = card.gridCols;
  gFW.value = card.frameW;   gFH.value = card.frameH;
  gOX.value = card.offsetX;  gOY.value = card.offsetY;
  gGX.value = card.gapX;     gGY.value = card.gapY;
  // irregular
  const irrCount = card.frameRects ? card.frameRects.length : card.frames;
  iN.value = irrCount;
  rebuildIrrSelect(card);

  prevDirBadge.textContent = DIR_LABEL[card.dir] || card.dir;
  state.syncing = false;
}

function syncCardFromSidebar(card) {
  if (!card || state.syncing) return;
  const prof = profileSel.value;
  card.profile = prof;
  card.fps     = clamp(int(fpsInput.value,   8),  1, 60);
  card.scale   = clamp(int(scaleInput.value, 3),  1, 8);
  card.anchorX = clamp(parseFloat(anchorXIn.value) || 0.5, 0, 1);
  card.anchorY = clamp(parseFloat(anchorYIn.value) || 1.0, 0, 1);

  if (prof === "strip-h" || prof === "strip-v") {
    card.frames  = Math.max(1, int(sN.value,  1));
    card.frameW  = Math.max(1, int(sFW.value, 64));
    card.frameH  = Math.max(1, int(sFH.value, 64));
    card.offsetX = Math.max(0, int(sOX.value, 0));
    card.offsetY = Math.max(0, int(sOY.value, 0));
    const gap    = Math.max(0, int(sGap.value, 0));
    card.gapX    = prof === "strip-v" ? 0 : gap;
    card.gapY    = prof === "strip-v" ? gap : 0;
    card.gridRows = 1; card.gridCols = card.frames;
  } else if (prof === "grid") {
    card.gridRows = Math.max(1, int(gR.value,  4));
    card.gridCols = Math.max(1, int(gC.value,  4));
    card.frameW   = Math.max(1, int(gFW.value, 64));
    card.frameH   = Math.max(1, int(gFH.value, 64));
    card.offsetX  = Math.max(0, int(gOX.value, 0));
    card.offsetY  = Math.max(0, int(gOY.value, 0));
    card.gapX     = Math.max(0, int(gGX.value, 0));
    card.gapY     = Math.max(0, int(gGY.value, 0));
    card.frames   = card.gridRows * card.gridCols;
  } else if (prof === "irregular") {
    const n = Math.max(1, int(iN.value, 1));
    ensureFrameRects(card, n);
    card.frames = n;
    const fi    = card.activeFrame;
    if (card.frameRects && card.frameRects[fi]) {
      card.frameRects[fi].x = Math.max(0, int(iX.value, 0));
      card.frameRects[fi].y = Math.max(0, int(iY.value, 0));
      card.frameRects[fi].w = Math.max(1, int(iW.value, 64));
      card.frameRects[fi].h = Math.max(1, int(iH.value, 64));
    }
  }
}

function syncIrrFromFrame(card) {
  if (!card.frameRects) return;
  const r = card.frameRects[card.activeFrame] || { x:0,y:0,w:64,h:64 };
  state.syncing = true;
  iX.value = r.x; iY.value = r.y; iW.value = r.w; iH.value = r.h;
  state.syncing = false;
}

function rebuildIrrSelect(card) {
  iFr.innerHTML = "";
  const n = card.frameRects ? card.frameRects.length : (card.frames||4);
  for (let i = 0; i < n; i++) {
    const o = Object.assign(document.createElement("option"), { value:i, textContent:`Frame ${i+1}` });
    iFr.appendChild(o);
  }
  iFr.value = card.activeFrame || 0;
  syncIrrFromFrame(card);
}

// ── Viewport helpers ─────────────────────────────────────────
function i2s(ix, iy) { // image → screen
  const v = state.vp;
  return { x: ix*v.zoom + v.panX, y: iy*v.zoom + v.panY };
}
function s2i(sx, sy) { // screen → image
  const v = state.vp;
  return { x: (sx-v.panX)/v.zoom, y: (sy-v.panY)/v.zoom };
}
function setZoom(z, cx, cy) {
  const v = state.vp;
  z = clamp(z, 0.1, 10);
  if (cx != null) {
    v.panX = cx - (cx - v.panX) * (z / v.zoom);
    v.panY = cy - (cy - v.panY) * (z / v.zoom);
  }
  v.zoom = z;
  zoomSlider.value      = z;
  zoomDisplay.textContent = z.toFixed(2) + "×";
}
function fitImage(card) {
  if (!card || !card.sheet) return;
  const vw = sheetCanvas.width, vh = sheetCanvas.height;
  const iw = card.sheet.naturalWidth, ih = card.sheet.naturalHeight;
  const z  = clamp(Math.min((vw/iw)*0.88, (vh/ih)*0.88), 0.1, 10);
  setZoom(z);
  state.vp.panX = (vw - iw*state.vp.zoom) / 2;
  state.vp.panY = (vh - ih*state.vp.zoom) / 2;
}

// ── Canvas resize ────────────────────────────────────────────
function resizeCanvas() {
  const vw = sheetVp.clientWidth, vh = sheetVp.clientHeight;
  if (sheetCanvas.width === vw && sheetCanvas.height === vh) return;
  sheetCanvas.width  = vw;
  sheetCanvas.height = vh;
  checkerPat = null;
}
const ro = new ResizeObserver(resizeCanvas);
ro.observe(sheetVp);

// ── Sheet rendering ──────────────────────────────────────────
function drawSheet() {
  const W = sheetCanvas.width, H = sheetCanvas.height;
  sheetCtx.clearRect(0, 0, W, H);
  if (!checkerPat) makeChecker();
  sheetCtx.fillStyle = checkerPat;
  sheetCtx.fillRect(0, 0, W, H);

  const card = activeCard();
  if (!card || !card.sheet) { emptyHint.classList.remove("is-hidden"); return; }
  emptyHint.classList.add("is-hidden");

  const v   = state.vp;
  const iw  = card.sheet.naturalWidth  * v.zoom;
  const ih  = card.sheet.naturalHeight * v.zoom;

  // draw image
  sheetCtx.save();
  sheetCtx.imageSmoothingEnabled = false;
  sheetCtx.drawImage(card.sheet, v.panX, v.panY, iw, ih);
  sheetCtx.restore();

  drawFrameOverlay(card);
  drawAnchorPoint(card);
  if (v.cropping && v.cropA && v.cropB) drawCropPreview();

  // status bar
  if (v.lastMouse) {
    const ip = s2i(v.lastMouse.x, v.lastMouse.y);
    const af = getAnimFrames(card);
    sheetMeta.textContent =
      `cursor:(${ip.x|0}, ${ip.y|0})  ·  ${card.dir}  ·  ${card.sheet.naturalWidth}×${card.sheet.naturalHeight}  ·  frames:${af.length}  ·  zoom:${v.zoom.toFixed(2)}×`;
  }
}

function drawFrameOverlay(card) {
  const all   = getFrameRects(card);
  const anim  = getAnimFrames(card);
  const v     = state.vp;
  const zoom  = v.zoom;

  // dim inactive grid rows
  if (card.profile === "grid" && card.sheet) {
    const imgW = card.sheet.naturalWidth  * zoom;
    sheetCtx.fillStyle = DIM_FILL;
    for (let r = 0; r < card.gridRows; r++) {
      if (r === card.row) continue;
      const sy = v.panY + (card.offsetY + r*(card.frameH+card.gapY)) * zoom;
      sheetCtx.fillRect(v.panX, sy, imgW, card.frameH * zoom);
    }
  }

  // faint fill + stroke for every frame
  for (const r of all) {
    const sp = i2s(r.x, r.y);
    const sw = r.w*zoom, sh = r.h*zoom;
    sheetCtx.fillStyle   = FRAME_FILL;
    sheetCtx.strokeStyle = FRAME_STROKE;
    sheetCtx.lineWidth   = 1;
    sheetCtx.fillRect(sp.x, sp.y, sw, sh);
    sheetCtx.strokeRect(sp.x+0.5, sp.y+0.5, sw-1, sh-1);
  }

  // gold highlight: currently playing frame
  const fi   = card.frameIdx % Math.max(1, anim.length);
  const afr  = anim[fi];
  if (afr) {
    const sp = i2s(afr.x, afr.y);
    sheetCtx.strokeStyle = ACTIVE_STROKE;
    sheetCtx.lineWidth   = 2;
    sheetCtx.strokeRect(sp.x+1, sp.y+1, afr.w*zoom-2, afr.h*zoom-2);
  }

  // cyan dashed: editing per-frame rect
  if (card.profile === "irregular" && card.frameRects) {
    const er = card.frameRects[card.activeFrame];
    if (er) {
      const sp = i2s(er.x, er.y);
      sheetCtx.strokeStyle = EDIT_STROKE;
      sheetCtx.lineWidth   = 1.5;
      sheetCtx.setLineDash([5,3]);
      sheetCtx.strokeRect(sp.x, sp.y, er.w*zoom, er.h*zoom);
      sheetCtx.setLineDash([]);
    }
  }

  // frame index labels (only when zoom is large enough)
  if (zoom >= 1.5 && anim.length <= 64) {
    const fs = Math.max(9, Math.min(11, zoom*7));
    sheetCtx.font          = `${fs}px monospace`;
    sheetCtx.fillStyle     = "rgba(255,255,255,0.6)";
    sheetCtx.textAlign     = "left";
    sheetCtx.textBaseline  = "top";
    for (const r of anim) {
      const sp = i2s(r.x+2, r.y+2);
      sheetCtx.fillText(String(r.frameIdx), sp.x, sp.y);
    }
    sheetCtx.textAlign    = "left";
    sheetCtx.textBaseline = "alphabetic";
  }
}

function drawAnchorPoint(card) {
  const anim = getAnimFrames(card);
  const fi   = card.frameIdx % Math.max(1, anim.length);
  const fr   = anim[fi];
  if (!fr) return;
  const ap   = i2s(fr.x + fr.w*card.anchorX, fr.y + fr.h*card.anchorY);
  const R = 5, L = 9;
  sheetCtx.save();
  // shadow
  sheetCtx.strokeStyle = "rgba(0,0,0,0.8)";
  sheetCtx.lineWidth   = 3;
  sheetCtx.beginPath();
  sheetCtx.moveTo(ap.x-L,ap.y); sheetCtx.lineTo(ap.x+L,ap.y);
  sheetCtx.moveTo(ap.x,ap.y-L); sheetCtx.lineTo(ap.x,ap.y+L);
  sheetCtx.stroke();
  // crosshair
  sheetCtx.strokeStyle = ANCHOR_COL;
  sheetCtx.lineWidth   = 1.5;
  sheetCtx.beginPath();
  sheetCtx.moveTo(ap.x-L,ap.y); sheetCtx.lineTo(ap.x+L,ap.y);
  sheetCtx.moveTo(ap.x,ap.y-L); sheetCtx.lineTo(ap.x,ap.y+L);
  sheetCtx.stroke();
  // circle shadow
  sheetCtx.beginPath(); sheetCtx.arc(ap.x,ap.y,R,0,Math.PI*2);
  sheetCtx.strokeStyle = "rgba(0,0,0,0.8)"; sheetCtx.lineWidth = 3; sheetCtx.stroke();
  // circle
  sheetCtx.beginPath(); sheetCtx.arc(ap.x,ap.y,R,0,Math.PI*2);
  sheetCtx.strokeStyle = ANCHOR_COL; sheetCtx.lineWidth = 1.5; sheetCtx.stroke();
  sheetCtx.restore();
}

function drawCropPreview() {
  const a = state.vp.cropA, b = state.vp.cropB;
  const sx = i2s(Math.min(a.x,b.x), Math.min(a.y,b.y));
  const ex = i2s(Math.max(a.x,b.x), Math.max(a.y,b.y));
  const w = ex.x-sx.x, h = ex.y-sx.y;
  if (w < 1 || h < 1) return;
  sheetCtx.save();
  sheetCtx.strokeStyle = CROP_STROKE;
  sheetCtx.lineWidth   = 1.5;
  sheetCtx.setLineDash([5,3]);
  sheetCtx.strokeRect(sx.x, sx.y, w, h);
  sheetCtx.setLineDash([]);
  sheetCtx.fillStyle = "rgba(255,220,60,0.06)";
  sheetCtx.fillRect(sx.x, sx.y, w, h);
  const pw = (Math.abs(b.x-a.x)|0), ph = (Math.abs(b.y-a.y)|0);
  sheetCtx.font = "11px monospace";
  sheetCtx.fillStyle    = CROP_STROKE;
  sheetCtx.textBaseline = "bottom";
  sheetCtx.textAlign    = "left";
  sheetCtx.fillText(`${pw}×${ph}`, sx.x+3, sx.y-2);
  sheetCtx.textBaseline = "alphabetic";
  sheetCtx.restore();
}

// ── Preview canvas ───────────────────────────────────────────
let prevTs = 0;
function drawPreview(ts) {
  const dt   = ts - prevTs; prevTs = ts;
  const pw = previewCvs.width, ph = previewCvs.height;
  previewCtx.clearRect(0,0,pw,ph);
  if (!checkerPat) makeChecker();
  previewCtx.fillStyle = checkerPat;
  previewCtx.fillRect(0,0,pw,ph);

  const card = activeCard();
  if (!card || !card.sheet) return;
  const frames = getAnimFrames(card);
  if (!frames.length) return;

  if (state.playing) {
    card.acc += dt;
    const spf = 1000 / Math.max(1, card.fps);
    while (card.acc >= spf) { card.acc -= spf; card.frameIdx = (card.frameIdx+1) % frames.length; }
  }
  const fr = frames[card.frameIdx % frames.length];
  if (!fr) return;
  const sc = card.scale, dw = fr.w*sc, dh = fr.h*sc;
  const dx = (pw-dw)/2, dy = (ph-dh)/2;
  previewCtx.save();
  previewCtx.imageSmoothingEnabled = false;
  previewCtx.drawImage(card.sheet, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh);
  previewCtx.restore();
}

// ── RAF loop ─────────────────────────────────────────────────
function loop(ts) {
  drawPreview(ts);
  drawSheet();
  requestAnimationFrame(loop);
}

// ── Active card ──────────────────────────────────────────────
function activeCard() { return state.activeDir ? state.cards[state.activeDir] : null; }

// ── Tabs ─────────────────────────────────────────────────────
function buildTabs(dirs) {
  dirTabsEl.innerHTML = "";
  for (const dir of dirs) {
    const btn = Object.assign(document.createElement("button"), {
      className: "dir-tab",
      innerHTML: `<span class="tab-dot"></span>${DIR_LABEL[dir]||dir}`,
    });
    btn.dataset.dir = dir;
    if (!state.cards[dir]) btn.classList.add("is-missing");
    btn.addEventListener("click", () => selectDir(dir));
    dirTabsEl.appendChild(btn);
  }
}
function selectDir(dir) {
  const card = state.cards[dir];
  if (!card) return;
  state.activeDir = dir;
  dirTabsEl.querySelectorAll(".dir-tab").forEach(t =>
    t.classList.toggle("is-active", t.dataset.dir === dir));
  syncSidebarFromCard(card);
  if (!card.sheet) {
    const imgUrl = card.url.replace(/#.*/, "");
    loadImage(imgUrl).then(img => { card.sheet = img; fitImage(card); })
      .catch(() => setStatus("Failed to load sheet.", "is-bad"));
  } else {
    fitImage(card);
  }
  emptyHint.classList.toggle("is-hidden", !!card.sheet);
}

// ── Manifest + sheet loading ─────────────────────────────────
async function loadCharacters() {
  const res = await fetch("/api/sprites/characters");
  if (res.status === 401 || res.status === 403) {
    emptyHint.querySelector("span").textContent  = "Admin access required.";
    emptyHint.querySelector("small").textContent = "Log in as an admin to use the sprite editor.";
    return;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) {
    emptyHint.querySelector("span").textContent = "Unexpected server response.";
    return;
  }
  state.characters = list;
  charSel.innerHTML = list.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  if (list.length) await loadManifest(list[0].id);
}

async function loadManifest(character) {
  const manifest = await (await fetch(`/api/sprites/manifest?character=${encodeURIComponent(character)}`)).json();
  state.manifest  = manifest;
  const slices    = await (await fetch("/api/sprites/slices")).json();
  state.savedSlices = slices;

  const weapons = Object.keys(manifest.weapons || {});
  weaponSel.innerHTML = weapons.map(w => `<option value="${w}">${w}</option>`).join("");
  const firstW = manifest.weapons[weapons[0]] || {};
  const anims  = Object.keys(firstW);
  animSel.innerHTML = anims.map(a => `<option value="${a}">${a}</option>`).join("");
  if (weapons.length && anims.length) await loadSheets(character, weapons[0], anims[0]);
}

async function loadSheets(character, weapon, anim) {
  state.cards     = {};
  state.dirtyDirs = new Set();
  state.activeDir = null;

  const animData = state.manifest?.weapons?.[weapon]?.[anim];
  if (!animData) { buildTabs([]); emptyHint.classList.remove("is-hidden"); return; }
  const saved = state.savedSlices;

  let dirs = [];
  if (animData.combined && animData.url) {
    const url = animData.url;
    COMBINED_ORDER.forEach((dir, row) => {
      const cardUrl = `${url}#row=${row}`;
      const card    = makeCard(dir, cardUrl, row);
      card.profile  = "grid"; card.gridRows = 4; card.gridCols = 4;
      if (saved[cardUrl]) hydrateCard(card, saved[cardUrl]);
      state.cards[dir] = card; dirs.push(dir);
    });
  } else if (animData.directions && Object.keys(animData.directions).length) {
    for (const [dir, url] of Object.entries(animData.directions)) {
      const card = makeCard(dir, url, 0);
      if (saved[url]) hydrateCard(card, saved[url]);
      state.cards[dir] = card; dirs.push(dir);
    }
  } else if (animData.url) {
    const dir  = animData.direction || "all";
    const card = makeCard(dir, animData.url, 0);
    if (saved[animData.url]) hydrateCard(card, saved[animData.url]);
    state.cards[dir] = card; dirs.push(dir);
  } else if (Array.isArray(animData.sheets)) {
    for (const sh of animData.sheets) {
      const dir  = sh.dir || sh.direction || "all";
      const card = makeCard(dir, sh.url, 0);
      if (saved[sh.url]) hydrateCard(card, saved[sh.url]);
      state.cards[dir] = card; dirs.push(dir);
    }
  }

  // canonical ordering
  const orderedDirs = [];
  for (const d of [...SOLO_DIRS, "all", "death"]) { if (state.cards[d]) orderedDirs.push(d); }
  for (const d of dirs)                            { if (!orderedDirs.includes(d)) orderedDirs.push(d); }

  buildTabs(orderedDirs);
  refreshSaveBtn();
  const first = orderedDirs[0];
  if (first) selectDir(first);
  else emptyHint.classList.remove("is-hidden");
}

// ── Save / Reset / Bulk ──────────────────────────────────────
async function saveAll() {
  let ok = 0, fail = 0;
  for (const dir of [...state.dirtyDirs]) {
    const card = state.cards[dir]; if (!card) continue;
    try {
      const r = await fetch("/api/sprites/slice", {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(slicePayload(card)),
      });
      if (!r.ok) throw new Error(await r.text());
      card.savedSlice = slicePayload(card);
      state.savedSlices[card.url] = card.savedSlice;
      markClean(dir); ok++;
    } catch(e) { console.error("save", dir, e); fail++; }
  }
  if (!fail) setStatus(`Saved ${ok} slice${ok===1?"":"s"}.`, "is-good");
  else       setStatus(`${ok} saved, ${fail} failed.`, "is-bad");
}

async function resetActive() {
  const card = activeCard(); if (!card) return;
  if (!card.savedSlice) { setStatus("Nothing saved to reset."); return; }
  if (!confirm(`Delete saved slice for "${card.dir}"?`)) return;
  try {
    await fetch("/api/sprites/slice", {
      method:"DELETE", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ url: card.url }),
    });
    card.savedSlice = null; card.frameRects = null; card.frameIdx = 0; card.acc = 0;
    delete state.savedSlices[card.url];
    markClean(card.dir); state.dirtyDirs.delete(card.dir);
    syncSidebarFromCard(card); setStatus("Slice reset.", "is-good");
  } catch(e) { setStatus("Reset failed: "+e.message, "is-bad"); }
}

function applyToAll() {
  const src = activeCard(); if (!src) return;
  for (const [dir, card] of Object.entries(state.cards)) {
    if (dir === src.dir) continue;
    copyParams(src, card); markDirty(dir);
  }
  setStatus("Applied to all directions.", "is-good");
}

function copyParams(src, dst) {
  ["profile","gridRows","gridCols","frames","frameW","frameH",
   "offsetX","offsetY","gapX","gapY","anchorX","anchorY","fps","scale"].forEach(k => dst[k] = src[k]);
  dst.frameRects = src.frameRects ? src.frameRects.map(r=>({...r})) : null;
}

function mirrorAcrossFacings() {
  const src = activeCard(); if (!src) return;
  const pairs = { right:"left", left:"right", up:"down", down:"up" };
  const opp   = pairs[src.dir];
  if (!opp || !state.cards[opp]) { setStatus("No mirror direction found."); return; }
  copyParams(src, state.cards[opp]); markDirty(opp);
  setStatus(`Mirrored ${src.dir} → ${opp}.`, "is-good");
}

async function applyToOtherChar() {
  const others = state.characters.filter(c => c.id !== charSel.value);
  if (!others.length) { setStatus("No other characters."); return; }
  const target = prompt(`Copy slices to which character?\n${others.map(c=>c.id).join(", ")}`);
  if (!target) return;
  try {
    const r    = await fetch("/api/sprites/copy-slices", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ from: charSel.value, to: target }),
    });
    const data = await r.json();
    setStatus(`Copied ${data.copied||0} slice(s) to ${target}.`, "is-good");
  } catch(e) { setStatus("Copy failed: "+e.message, "is-bad"); }
}

// ── Keyboard arrow adjustment ────────────────────────────────
function adjustCard(dx, dy) {
  const card = activeCard(); if (!card) return;
  if (card.profile === "irregular" && card.frameRects) {
    const r = card.frameRects[card.activeFrame];
    if (r) { r.x = Math.max(0,r.x+dx); r.y = Math.max(0,r.y+dy); }
    syncIrrFromFrame(card);
  } else {
    card.offsetX = Math.max(0,card.offsetX+dx);
    card.offsetY = Math.max(0,card.offsetY+dy);
    state.syncing = true;
    if (card.profile === "strip-h"||card.profile === "strip-v") {
      sOX.value = card.offsetX; sOY.value = card.offsetY;
    } else if (card.profile === "grid") {
      gOX.value = card.offsetX; gOY.value = card.offsetY;
    }
    state.syncing = false;
  }
  markDirty(card.dir);
}

// ── Anchor drag ──────────────────────────────────────────────
function moveAnchor(ix, iy) {
  const card = activeCard(); if (!card) return;
  const anim = getAnimFrames(card);
  const fr   = anim[card.frameIdx % Math.max(1,anim.length)];
  if (!fr) return;
  card.anchorX = clamp((ix-fr.x)/fr.w,0,1);
  card.anchorY = clamp((iy-fr.y)/fr.h,0,1);
  state.syncing = true;
  anchorXIn.value = card.anchorX.toFixed(2);
  anchorYIn.value = card.anchorY.toFixed(2);
  state.syncing = false;
  markDirty(card.dir);
}

// ── Apply crop drag ──────────────────────────────────────────
function applyCrop() {
  const v  = state.vp;
  if (!v.cropA || !v.cropB) return;
  const x1 = Math.round(Math.min(v.cropA.x,v.cropB.x));
  const y1 = Math.round(Math.min(v.cropA.y,v.cropB.y));
  const x2 = Math.round(Math.max(v.cropA.x,v.cropB.x));
  const y2 = Math.round(Math.max(v.cropA.y,v.cropB.y));
  const w  = x2-x1, h = y2-y1;
  if (w < 2 || h < 2) return;
  const card = activeCard(); if (!card) return;
  if (card.profile === "irregular") {
    ensureFrameRects(card, card.frames || 1);
    card.frameRects[card.activeFrame] = { x:x1, y:y1, w, h };
    card.frameW = w; card.frameH = h;
    syncIrrFromFrame(card);
  } else {
    card.offsetX = x1; card.offsetY = y1;
    card.frameW  = w;  card.frameH  = h;
  }
  syncSidebarFromCard(card);
  markDirty(card.dir);
}

// ── Mouse events ─────────────────────────────────────────────
function canvasXY(e) {
  const r = sheetCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onMousedown(e) {
  const { x, y } = canvasXY(e);
  const ip = s2i(x, y);
  const v  = state.vp;
  if (e.button === 1 || (e.button === 0 && state.spaceDown)) {
    v.panning = true; v.panStart = { x, y, panX:v.panX, panY:v.panY };
    sheetVp.classList.add("is-grabbing"); e.preventDefault(); return;
  }
  if (e.button === 0 && e.altKey) {
    v.anchorDrag = true; moveAnchor(ip.x, ip.y); e.preventDefault(); return;
  }
  if (e.button === 0) {
    v.cropping = true; v.cropA = { ...ip }; v.cropB = { ...ip };
  }
}
function onMousemove(e) {
  const { x, y } = canvasXY(e);
  const ip = s2i(x, y);
  const v  = state.vp;
  v.lastMouse = { x, y };
  if (v.panning && v.panStart) {
    v.panX = v.panStart.panX + (x - v.panStart.x);
    v.panY = v.panStart.panY + (y - v.panStart.y);
  } else if (v.anchorDrag) {
    moveAnchor(ip.x, ip.y);
  } else if (v.cropping) {
    v.cropB = { ...ip };
  }
}
function onMouseup() {
  const v = state.vp;
  if (v.panning) {
    v.panning = false; v.panStart = null;
    sheetVp.classList.remove("is-grabbing");
  }
  if (v.anchorDrag) v.anchorDrag = false;
  if (v.cropping) { v.cropping = false; applyCrop(); v.cropA = v.cropB = null; }
}
function onWheel(e) {
  e.preventDefault();
  const { x, y } = canvasXY(e);
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  setZoom(state.vp.zoom * (1 + delta*1.2), x, y);
}

// ── Keyboard ─────────────────────────────────────────────────
function onKeydown(e) {
  const focused = document.activeElement;
  const inInput = focused && focused.matches("input,select,textarea");
  if (e.code === "Space" && !inInput) { e.preventDefault(); state.spaceDown = true; sheetVp.classList.add("is-panning"); }
  if ((e.ctrlKey||e.metaKey) && e.key === "s") { e.preventDefault(); if (!saveBtn.disabled) saveAll(); }
  if (e.key.startsWith("Arrow") && !inInput) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key==="ArrowLeft")  adjustCard(-d, 0);
    if (e.key==="ArrowRight") adjustCard( d, 0);
    if (e.key==="ArrowUp")    adjustCard(0, -d);
    if (e.key==="ArrowDown")  adjustCard(0,  d);
  }
}
function onKeyup(e) {
  if (e.code === "Space") { state.spaceDown = false; sheetVp.classList.remove("is-panning"); }
}

// ── Wire all inputs ──────────────────────────────────────────
function wireInputs() {
  const onParam = () => {
    if (state.syncing) return;
    const card = activeCard(); if (!card) return;
    showProfilePanel(profileSel.value);
    syncCardFromSidebar(card);
    markDirty(card.dir);
  };
  [profileSel, sN, sGap, sFW, sFH, sOX, sOY,
   gR, gC, gFW, gFH, gOX, gOY, gGX, gGY,
   iN, iX, iY, iW, iH,
   anchorXIn, anchorYIn].forEach(el => el.addEventListener("input", onParam));

  fpsInput.addEventListener("input", () => {
    if (state.syncing) return;
    const c = activeCard(); if (!c) return;
    c.fps = clamp(int(fpsInput.value,8),1,60); markDirty(c.dir);
  });
  scaleInput.addEventListener("input", () => {
    if (state.syncing) return;
    const c = activeCard(); if (!c) return;
    c.scale = clamp(int(scaleInput.value,3),1,8); markDirty(c.dir);
  });
  iFr.addEventListener("change", () => {
    if (state.syncing) return;
    const c = activeCard(); if (!c) return;
    c.activeFrame = int(iFr.value,0); syncIrrFromFrame(c);
  });
  playToggle.addEventListener("change", () => { state.playing = playToggle.checked; });
  zoomSlider.addEventListener("input",  () => setZoom(parseFloat(zoomSlider.value)));
  fitBtn.addEventListener("click", () => fitImage(activeCard()));
  oneBtn.addEventListener("click", () => { setZoom(1); });
  saveBtn.addEventListener("click", saveAll);
  $("apply-all-btn").addEventListener("click", applyToAll);
  $("mirror-btn").addEventListener("click", mirrorAcrossFacings);
  $("reset-btn").addEventListener("click", resetActive);
  $("apply-other-char-btn").addEventListener("click", applyToOtherChar);
  charSel.addEventListener("change",   () => loadManifest(charSel.value));
  weaponSel.addEventListener("change", () => loadSheets(charSel.value, weaponSel.value, animSel.value));
  animSel.addEventListener("change",   () => loadSheets(charSel.value, weaponSel.value, animSel.value));

  // Canvas
  sheetCanvas.addEventListener("mousedown", onMousedown);
  window.addEventListener("mousemove", onMousemove);
  window.addEventListener("mouseup",   onMouseup);
  sheetCanvas.addEventListener("wheel", onWheel, { passive:false });
  sheetVp.addEventListener("contextmenu", e => e.preventDefault());

  // Keyboard
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup",   onKeyup);

  window.addEventListener("beforeunload", e => {
    if (state.dirtyDirs.size > 0) { e.preventDefault(); e.returnValue = ""; }
  });
}

// ── Utilities ────────────────────────────────────────────────
function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
function int(v,def)     { const n=parseInt(v); return isNaN(n)?def:n; }

// ── Boot ─────────────────────────────────────────────────────
(async function init() {
  makeChecker();
  sheetCanvas.width  = sheetVp.clientWidth;
  sheetCanvas.height = sheetVp.clientHeight;
  wireInputs();
  try { await loadCharacters(); }
  catch(err) {
    emptyHint.querySelector("span").textContent = "Failed to load manifest.";
    console.error(err);
  }
  requestAnimationFrame(loop);
})();
