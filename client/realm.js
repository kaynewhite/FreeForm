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

  // Hotbar slot button references (queried lazily because the buttons live
  // in the static markup).  We tag slot-2 with [data-equipped] when the
  // player toggles Mana Bolt on so the CSS pulse highlights it.
  const hbSlot2 = document.querySelector('.hb-slot[data-slot="2"]');

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

  const statsCast    = $("#stats-cast");

  // HUD portrait (in the bottom-center plate)
  const hudPortrait      = $("#hud-portrait-canvas");
  const hudPortraitCtx   = hudPortrait.getContext("2d");
  hudPortraitCtx.imageSmoothingEnabled = false;
  const hudPortraitEmpty = $("#hud-portrait-empty");

  // Output meter (scroll wheel adjusts in player mode; locked in editor mode).
  const outputBox    = $("#realm-output");
  const outFill      = $("#out-fill");
  const outNum       = $("#out-num");

  // Collapsible chat
  const chatPanel    = $("#realm-chat");
  const chatHead     = $("#chat-head");
  const chatBody     = $("#chat-body");
  const chatHint     = $("#chat-hint");
  const chatCollapseGlyph = $("#chat-collapse");

  // Modals (Atlas, Settings, Vessel, Satchel, Spellbook, Quests, Help)
  const modalVeil   = $("#modal-veil");
  const modals      = {
    map:        $("#modal-map"),
    settings:   $("#modal-settings"),
    character:  $("#modal-character"),
    inventory:  $("#modal-inventory"),
    spellbook:  $("#modal-spellbook"),
    quests:     $("#modal-quests"),
    help:       $("#modal-help"),
    spellwiz:   $("#modal-spellwiz"),
  };
  const codexButtons = document.querySelectorAll(".codex-btn[data-modal]");
  const atlasExpand  = $("#atlas-expand-btn");

  // Map-modal canvas + stat readouts
  const mapModalCanvas = $("#map-modal-canvas");
  const mapModalCtx    = mapModalCanvas.getContext("2d");
  mapModalCtx.imageSmoothingEnabled = false;
  const mapPos    = $("#map-pos");
  const mapSouls  = $("#map-souls");

  // Vessel-modal portrait + stat readouts
  const charModalPortrait    = $("#char-modal-portrait");
  const charModalPortraitCtx = charModalPortrait.getContext("2d");
  charModalPortraitCtx.imageSmoothingEnabled = false;
  const charModalRefs = {
    name:   $("#char-modal-name"),
    race:   $("#char-modal-race"),
    level:  $("#char-modal-level"),
    hp:     $("#char-modal-hp"),
    mp:     $("#char-modal-mp"),
    st:     $("#char-modal-st"),
    xp:     $("#char-modal-xp"),
    ctrl:   $("#char-modal-ctrl"),
    cast:   $("#char-modal-cast"),
    eff:    $("#char-modal-eff"),
    res:    $("#char-modal-res"),
    cls:    $("#char-modal-class"),
  };

  // Settings inputs (saved in localStorage so preferences persist)
  const setVantageHigh = $("#set-vantage-high");
  const setVantageLow  = $("#set-vantage-low");
  const setVol         = $("#set-vol");
  const setVolNum      = $("#set-vol-num");
  const setShowFps     = $("#set-show-fps");
  const setPixelPerf   = $("#set-pixel-perfect");
  const setShowGrid    = $("#set-show-grid");
  const setShowCoords  = $("#set-show-coords");
  const setMuteAmb     = $("#set-mute-amb");
  const setLeaveBtn    = $("#set-leave-btn");

  // Inventory placeholder grid (24 cells)
  (() => {
    const inv = $("#inv-grid");
    if (inv && !inv.childElementCount) {
      for (let i = 0; i < 24; i++) {
        const cell = document.createElement("div");
        cell.className = "inv-cell is-locked";
        inv.appendChild(cell);
      }
    }
  })();

  const paletteEl   = $("#realm-palette");
  const paletteBody = $("#palette-body");
  const paletteMode = $("#palette-mode");
  const paletteLayer= $("#palette-layer");
  const paletteBrush= $("#palette-brush");
  const paletteSel  = $("#palette-selected-readout");
  const paletteClose= $("#palette-close-btn");
  const paletteClear= $("#palette-clear-btn");
  const paletteFillMode = $("#palette-fill-mode");
  const paletteFillBtn  = $("#palette-fill-btn");
  // Loading veil — shown while loadWorld() is in flight so the player
  // never sees a half-rendered map.
  const loadingVeil = $("#realm-loading");
  const loadingTitle = $("#rl-title");
  const loadingBar   = $("#rl-bar-fill");
  function showLoadingVeil(msg) {
    if (!loadingVeil) return;
    if (msg && loadingTitle) loadingTitle.textContent = msg;
    if (loadingBar) {
      loadingBar.style.transition = "none";
      loadingBar.style.width = "8%";
      // Force a reflow so the next transition kicks in.
      void loadingBar.offsetWidth;
      loadingBar.style.transition = "width 1.2s ease-out";
      loadingBar.style.width = "82%";
    }
    loadingVeil.hidden = false;
  }
  function hideLoadingVeil() {
    if (!loadingVeil) return;
    if (loadingBar) {
      loadingBar.style.transition = "width 220ms ease-out";
      loadingBar.style.width = "100%";
    }
    setTimeout(() => { loadingVeil.hidden = true; }, 220);
  }

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

  // ---- sprite registry ----
  // Loads admin idle/walk sheets for all four facings, plus their slice
  // metadata, so the in-realm avatar animates with real art instead of a
  // placeholder circle. Players currently have no sheets uploaded — they
  // will fall through to the circle renderer.
  const SpriteSet = {
    loaded: false,
    slices: {},
    sheets: { admin: { idle: {}, walk: {}, cast: {} } }, // sheets[role][anim][facing] = { img, slice }
  };
  function _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + url));
      img.src = url;
    });
  }
  function _normalizeSlice(raw, img) {
    if (!raw) return {
      frames: 1, frameW: img.naturalWidth, frameH: img.naturalHeight,
      offsetX: 0, offsetY: 0, gapX: 0,
      perFrame: false, frameRects: null, fps: 8,
    };
    return {
      frames: raw.frames || 1,
      frameW: raw.frameW || img.naturalWidth,
      frameH: raw.frameH || img.naturalHeight,
      offsetX: raw.offsetX || 0,
      offsetY: raw.offsetY || 0,
      gapX: raw.gapX || 0,
      perFrame: !!raw.perFrame,
      frameRects: Array.isArray(raw.frameRects) ? raw.frameRects : null,
      fps: Math.max(1, Math.min(60, raw.fps || 8)),
    };
  }
  async function loadAdminSprites() {
    if (SpriteSet.loaded) return;
    try { SpriteSet.slices = await api("/api/sprites/slices") || {}; }
    catch { SpriteSet.slices = {}; }
    const ROOT = "/assets/sprites/admin/base";
    // We load idle/walk/cast for the four facings.  Cast sheets are the
    // "no-weapon attack" art per the design doc — when the avatar starts
    // a cast we briefly swap to the cast sheet snapped to the cardinal
    // facing closest to the cursor (handled by aimFromCursor).
    const ANIMS = {
      idle: `${ROOT}/idle-spritesheets/no-weapon/admin-idle`,
      walk: `${ROOT}/walking-spritesheets/no-weapon/admin-walk`,
      cast: `${ROOT}/cast-spritesheets/no-weapon/admin-cast`,
    };
    const DIRS = ["Up", "Down", "Left", "Right"];
    await Promise.all(Object.entries(ANIMS).flatMap(([anim, prefix]) =>
      DIRS.map(async (D) => {
        const url = `${prefix}${D}-spritesheet.png`;
        try {
          const img = await _loadImage(url);
          SpriteSet.sheets.admin[anim][D.toLowerCase()] = {
            img,
            slice: _normalizeSlice(SpriteSet.slices[url], img),
            url,
          };
        } catch { /* skip missing files silently */ }
      })
    ));
    SpriteSet.loaded = true;
  }
  function getSpriteForPlayer(p, anim) {
    if (!p.isAdmin) return null;
    // If a cast set is requested but not loaded, fall back to idle so
    // the avatar still renders rather than vanishing mid-cast.
    const set = SpriteSet.sheets.admin[anim]
             || SpriteSet.sheets.admin.idle;
    return set[p.facing] || set.down || null;
  }

  // ---- per-player render record (smooth-lerped visual position) ----
  // The server pushes authoritative state at 20Hz. We keep a separate
  // visual record per player and exponentially smooth it toward the target
  // every frame. That kills the visible jitter on the 50ms tick boundary
  // without needing real client-side prediction.
  function ensureRenderRec(p) {
    let rec = state.renderPlayers.get(p.id);
    if (!rec) {
      rec = {
        id: p.id, name: p.name, isAdmin: !!p.isAdmin, race: p.race,
        x: p.x, y: p.y,            // visual (lerped) position
        tx: p.x, ty: p.y,           // authoritative target
        facing: p.facing || "down",
        anim: p.anim || "idle",
        animTime: 0,                // accumulator for sprite frame timing
        bubble: null,               // { text, until }
      };
      state.renderPlayers.set(p.id, rec);
      return rec;
    }
    rec.name = p.name ?? rec.name;
    rec.isAdmin = !!(p.isAdmin ?? rec.isAdmin);
    rec.race = p.race ?? rec.race;
    rec.tx = p.x;
    rec.ty = p.y;
    rec.facing = p.facing || rec.facing;
    rec.anim = p.anim || rec.anim;
    return rec;
  }
  function lerpRenderPositions(dt) {
    // Strong smoothing factor — fast catch-up so input feels responsive,
    // but smooth enough to hide the 50ms ticks. About 1 tile of slop max.
    const k = 1 - Math.exp(-dt * 16);
    for (const rec of state.renderPlayers.values()) {
      rec.x += (rec.tx - rec.x) * k;
      rec.y += (rec.ty - rec.y) * k;
      // Snap when we're effectively there to avoid endless float drift.
      if (Math.abs(rec.tx - rec.x) < 0.005) rec.x = rec.tx;
      if (Math.abs(rec.ty - rec.y) < 0.005) rec.y = rec.ty;
      rec.animTime += dt;
    }
  }
  function attachBubble(playerId, text) {
    const rec = state.renderPlayers.get(playerId);
    if (!rec) return;
    rec.bubble = { text: text.slice(0, 120), until: performance.now() + 4500 };
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
    mouse: { x: 0, y: 0, tileX: 0, tileY: 0, worldX: 0, worldY: 0, leftDown: false, rightDown: false },

    // ---- character / vessel (snapshot from /api/characters/me at enter) ----
    // The base stat block (max_hp, mana_cap, stamina_cap, control, etc.)
    // comes from /api/characters/me on enter, but the LIVE vitals
    // (hp/mana/stamina) are server-authoritative — every welcome + state
    // packet overwrites state.cur with the truth from the tick loop.
    character: null,
    cur: { hp: 0, mp: 0, st: 0 },

    // ---- combat FX (transient, render-only) -----------------------------
    // swings: { id, x, y, facing, reach, arc, t0, weapon }  — fades over 220ms
    // pops:   { id, x, y, dmg, t0, dy }                     — floating numbers
    // hits:   targetId -> tFlashUntil                        — red avatar pulse
    fx: { swings: [], pops: [], hits: new Map(), bolts: [] },
    deadOverlay: null,           // { until, by } — death modal countdown

    // ---- realtime / multiplayer ----
    me: null,                   // { id, name, x, y, facing, isAdmin, race } — authoritative latest
    others: new Map(),          // id -> { id, name, x, y, facing, anim, isAdmin, race }
    // Visual records, one per player including self. We lerp these toward the
    // authoritative position every frame so 60fps render smooths out the 20Hz
    // server tick. Speech bubbles also live here so they follow the avatar.
    renderPlayers: new Map(),   // id -> { name, isAdmin, race, weapon, x, y, facing, anim, bubble }
    ws: null,
    wsReady: false,
    lastInputSent: { dx: 0, dy: 0, sprint: false, facing: "down", t: 0 },
    inputDirty: false,
    serverTickHz: 20,
    presence: 1,

    // Output meter (channeling power for casting). Scroll wheel changes this
    // in player mode; ignored in editor mode (where wheel zooms the camera).
    output: 100,

    // Slot-2 spell equipped state.  Pressing 2 toggles this — there is NO
    // auto-fire on the keystroke; the player must left- or right-click to
    // actually cast.  Empty string means "nothing equipped".
    equippedSpell: "",

    // Right-click charge-cast.  When the right button is held while a
    // spell is equipped we build a charge from the current Output dial,
    // then release it on mouseup.  The on-screen Output meter pulses gold
    // through the .is-charging class while this is active.
    charge: { active: false, t0: 0, output: 0 },

    // Drifting fore-glow particles for the void backdrop (violet & gold
    // motes).  Seeded once on first render and reused every frame.
    starParticles: null,

    // Chat panel collapse state. Persisted across re-enters.
    chatCollapsed: false,
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
  // (so the chat line shouldn't be echoed as plain speech).  Per design doc
  // §27 we cover the full Architect catalog (17 sub-tables) — most commands
  // are forwarded to the server as a {type:"command"} packet so the server's
  // existing /admin handler can dispatch them.
  function tryCommand(raw) {
    const text = raw.trim();
    if (!text.startsWith("/")) return false;
    const lower = text.toLowerCase();

    // Universal exits / help, available to every soul.
    if (lower === "/help" || lower === "/?") {
      openModal("help");
      chat("Help compendium opened.  Press H to toggle.", "cmd");
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

    // /command create_spell — open the 11-step inscribe wizard.
    if (lower === "/command create_spell" || lower === "/create_spell") {
      if (state.role !== "admin") {
        chat("Only the Architect may inscribe new spells.", "err");
        return true;
      }
      openSpellWizard();
      return true;
    }

    // /tp <x> <y>  — local self-teleport, sent to server for validation.
    // Pattern accepts both /tp x y and /teleport x y.
    const tpMatch = text.match(/^\/(?:tp|teleport)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i);
    if (tpMatch) {
      sendCommand({ verb: "tp", x: parseFloat(tpMatch[1]), y: parseFloat(tpMatch[2]) });
      return true;
    }

    // /goto <name>  — teleport to another player by display name.
    const gotoMatch = text.match(/^\/(?:goto|to)\s+(.+?)\s*$/i);
    if (gotoMatch) {
      sendCommand({ verb: "goto", target: gotoMatch[1] });
      return true;
    }

    // /summon <name>  — pull another player to your tile (admin).
    const sumMatch = text.match(/^\/summon\s+(.+?)\s*$/i);
    if (sumMatch) {
      if (state.role !== "admin") { chat("Architect only.", "err"); return true; }
      sendCommand({ verb: "summon", target: sumMatch[1] });
      return true;
    }

    // /home — return to spawn.
    if (lower === "/home" || lower === "/spawn") {
      sendCommand({ verb: "home" });
      return true;
    }

    // Generic catch-all: forward any other slash command verb to the
    // server so admin tooling on that side can answer.  Server replies
    // arrive as chat lines through the normal welcome/cmd channel.
    const parts = text.slice(1).split(/\s+/);
    const verb = parts.shift().toLowerCase();
    if (verb) {
      sendCommand({ verb, args: parts });
      return true;
    }

    chat(`Unknown command: ${text}`, "err");
    return true;
  }
  function sendCommand(payload) {
    if (!state.wsReady) {
      chat("The realm hasn't replied yet — try again in a moment.", "err");
      return;
    }
    try {
      state.ws.send(JSON.stringify({ type: "command", ...payload }));
    } catch (err) {
      chat("Command failed: " + err.message, "err");
    }
  }

  // ---- /command create_spell — 11-step inscribe wizard ----------------
  // Per design doc §16. The wizard collects identity → school → form →
  // targeting → reach → width → cost & cadence → effects → visuals →
  // sound → review, then emits the spell as a JSON blob into chat for
  // preview (server persistence lands in a follow-up).  The DOM was
  // already authored in index.html; this block wires the stepper, page
  // navigation, review build, and inscribe commit.
  let swStep = 1;
  const SW_LAST = 11;
  function $sw(id) { return document.getElementById(id); }
  function openSpellWizard() {
    swStep = 1;
    swSyncUI();
    openModal("spellwiz");
  }
  function swSyncUI() {
    const wiz = modals.spellwiz;
    if (!wiz) return;
    wiz.querySelectorAll(".spellwiz-stepper li[data-step]").forEach((li) => {
      li.classList.toggle("is-current", +li.dataset.step === swStep);
      li.classList.toggle("is-done", +li.dataset.step <  swStep);
    });
    wiz.querySelectorAll(".spellwiz-page[data-page]").forEach((sec) => {
      sec.classList.toggle("is-current", +sec.dataset.page === swStep);
      sec.hidden = (+sec.dataset.page !== swStep);
    });
    const back = $sw("sw-back"), next = $sw("sw-next"), save = $sw("sw-save");
    if (back) back.disabled = (swStep === 1);
    if (next) next.hidden   = (swStep === SW_LAST);
    if (save) save.hidden   = (swStep !== SW_LAST);
    if (swStep === SW_LAST) swRenderReview();
  }
  function swCollect() {
    return {
      name:   $sw("sw-name")?.value.trim() || "Untitled Spell",
      id:     ($sw("sw-id")?.value.trim() || "untitled_spell").toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      school: $sw("sw-school")?.value || "arcane",
      form:   $sw("sw-form")?.value   || "projectile",
      aim:    $sw("sw-aim")?.value    || "directional",
      reach:  parseFloat($sw("sw-reach")?.value || "8"),
      width:  parseFloat($sw("sw-width")?.value || "0.55"),
      cost:   parseInt($sw("sw-cost")?.value || "50", 10),
      cooldown_ms: parseInt($sw("sw-cd")?.value   || "0", 10),
      power:  parseFloat($sw("sw-power")?.value || "1"),
      damage: parseInt($sw("sw-dmg")?.value || "50", 10),
      glyph:  $sw("sw-glyph")?.value || "rune-arrow",
      colors: { core: $sw("sw-color-core")?.value || "#b070ff",
                trail: $sw("sw-color-trail")?.value || "#f6e4a3" },
      sound:  { cast: $sw("sw-snd-cast")?.value || "chime",
                hit:  $sw("sw-snd-hit")?.value  || "thump" },
    };
  }
  function swRenderReview() {
    const out = $sw("sw-review");
    if (!out) return;
    out.textContent = JSON.stringify(swCollect(), null, 2);
  }
  // Wire the wizard buttons exactly once.
  if (modals.spellwiz) {
    $sw("sw-back")?.addEventListener("click", () => { if (swStep > 1) { swStep--; swSyncUI(); } });
    $sw("sw-next")?.addEventListener("click", () => { if (swStep < SW_LAST) { swStep++; swSyncUI(); } });
    $sw("sw-save")?.addEventListener("click", () => {
      const spell = swCollect();
      chat(`Spell inscribed: ${spell.name} (${spell.id}). Preview JSON:`, "good");
      chat(JSON.stringify(spell), "cmd");
      closeModal();
    });
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = chatInput.value;
    chatInput.value = "";
    // Auto-blur so movement keys (WASD/T) work again until the player
    // explicitly re-opens chat with T.
    chatInput.blur();
    if (!raw.trim()) return;
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
    // T opens chat from anywhere in the realm. While typing, T just types
    // a "t" like any letter (default browser behavior, no override).
    if (key === "t" && !isTypingInChat()) {
      e.preventDefault();
      if (state.chatCollapsed) setChatCollapsed(false);
      chatInput.focus();
      return;
    }
    if (isTypingInChat()) return;
    // ── Hotbar quick-pick ─────────────────────────────────────────────
    // §19.1 — Keys 1-6 equip spell slots. F holds open the Spell Wheel.
    // Hotkeys only EQUIP — they never auto-fire (casting = left/right click).
    // Editor mode is build-only, so all of these are politely ignored
    // while the tile palette is up.
    if (!state.editor.open) {
      if (key >= "1" && key <= "6") {
        e.preventDefault();
        const slotBtn = document.querySelector(`.hb-slot[data-slot="${key}"]`);
        const spellId = slotBtn && slotBtn.dataset.spell;
        if (spellId) toggleEquipSpell(spellId);
        else toast(`Slot ${key} is empty — learn a spell from a grimoire to fill it.`);
        return;
      }
      if (key === "f" && !e.repeat) {
        e.preventDefault();
        showSpellWheel(true);
        return;
      }
    }
    if (key) state.keys.add(key);
  });
  document.addEventListener("keyup", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key === "f" && !state.editor.open) {
      e.preventDefault();
      showSpellWheel(false);
    }
    if (key) state.keys.delete(key);
  });

  // ---- mouse: paint / erase / hover readout ----
  function eventToTileCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tilePx = state.tileSize * state.zoom;
    // cameraX/Y is a FLOAT (camera is smoothly recentered every frame).
    // We have to add it BEFORE flooring, otherwise we get a non-integer tile
    // coordinate which the server rejects with 400 "invalid coords" — that's
    // exactly the silent paint-failure bug from before.
    const tx = Math.floor(px / tilePx + state.cameraX);
    const ty = Math.floor(py / tilePx + state.cameraY);
    return { x: tx, y: ty };
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) state.mouse.leftDown = true;
    if (e.button === 2) state.mouse.rightDown = true;
    if (state.editor.open && state.role === "admin") {
      const { x, y } = eventToTileCoords(e);
      paintAt(x, y, e.button === 2);
      return;
    }
    // ---- combat: spell casting (§19 — pure magic, no weapons) ----------
    // The active slot is whichever hb-slot has [data-equipped]:
    //   Left  = TAP cast @ 20% Output (quick, cheap poke).
    //   Right = HOLD to charge; release fires at your current Output%.
    // No spell equipped → clicks are silently ignored until a slot is
    // selected (press 1-6 to equip from the hotbar).
    if (state.editor.open) return;
    if (state.equippedSpell) {
      if (e.button === 0) {
        sendCast(state.equippedSpell, 0.20);
      } else if (e.button === 2) {
        state.charge.active = true;
        state.charge.t0 = performance.now();
        state.charge.output = state.output;
        outputBox && outputBox.classList.add("is-charging");
      }
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) state.mouse.leftDown = false;
    if (e.button === 2) state.mouse.rightDown = false;
    // Release a charged right-click cast (if one was building).
    if (e.button === 2 && state.charge.active) {
      const out = Math.max(0.05, Math.min(1, (state.output || 100) / 100));
      state.charge.active = false;
      outputBox && outputBox.classList.remove("is-charging");
      if (state.equippedSpell && !state.editor.open) {
        sendCast(state.equippedSpell, out);
      }
    }
  });
  canvas.addEventListener("mousemove", (e) => {
    const { x, y } = eventToTileCoords(e);
    state.mouse.tileX = x;
    state.mouse.tileY = y;
    // Float world coords (sub-tile precision) — used by sendCast() to aim
    // a spell at exactly where the cursor is, regardless of facing.
    const rect = canvas.getBoundingClientRect();
    const tilePx = state.tileSize * state.zoom;
    state.mouse.worldX = (e.clientX - rect.left) / tilePx + state.cameraX;
    state.mouse.worldY = (e.clientY - rect.top) / tilePx + state.cameraY;
    // (Coords readout is updated each frame from the player's own position
    // — see the tick loop — so it always reads as a tidy pair of integers.)
    // Drag-paint: holding the mouse button while moving keeps painting.
    if (state.editor.open && state.role === "admin") {
      if (state.mouse.leftDown)  paintAt(x, y, false);
      if (state.mouse.rightDown) paintAt(x, y, true);
    }
  });
  // Wheel does double duty:
  //   - Editor mode: zoom the camera (1× → 6×).
  //   - Player mode: drive the Output meter (1% → 100%, 5% per notch).
  // Per design doc §14: scroll = output, only zoom while building.
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    if (state.editor.open) {
      const next = Math.max(1, Math.min(6, state.zoom + dir));
      if (next !== state.zoom) state.zoom = next;
    } else {
      const next = Math.max(1, Math.min(100, state.output + dir * 5));
      if (next !== state.output) { state.output = next; refreshOutput(); }
    }
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
  // ---- fill modes (per design doc §27, fill / fill_rect / replace) ----
  // Operates on whatever's currently visible on screen — bounded by the
  // camera viewport, NOT the whole infinite map. Four modes:
  //   empty  — paint only viewport tiles that have no tile yet on this layer
  //   edges  — paint only the border ring of the viewport
  //   same   — find the tile under the cursor (or the viewport center if the
  //            cursor isn't over a tile) and replace every matching tile
  //            within the viewport with the selected one
  //   all    — paint every visible tile (overwrites)
  // Bounding box around every painted tile across every layer, padded by
  // one viewport so "fill the whole world" reaches a margin past the
  // existing canvas. Capped at ±150 tiles so even a totally empty world
  // produces a sane, useful brush instead of nothing — and so a careless
  // "world" fill never tries to send millions of tiles.
  function computeWorldBBox() {
    const PAD = 8;
    const HARD = 150;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const layer of state.world.layers) {
      for (const k in layer.tiles) {
        const c = k.indexOf(",");
        const tx = +k.slice(0, c), ty = +k.slice(c + 1);
        if (tx < x0) x0 = tx;
        if (tx > x1) x1 = tx;
        if (ty < y0) y0 = ty;
        if (ty > y1) y1 = ty;
      }
    }
    if (!isFinite(x0)) {
      // No painted tiles yet — center the world around the camera.
      const cx = Math.floor(state.cameraX + viewportTilesAcross() / 2);
      const cy = Math.floor(state.cameraY + viewportTilesDown()   / 2);
      return { x0: cx - 32, y0: cy - 24, x1: cx + 32, y1: cy + 24 };
    }
    x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    if (x1 - x0 > HARD * 2) { x0 = cx - HARD; x1 = cx + HARD; }
    if (y1 - y0 > HARD * 2) { y0 = cy - HARD; y1 = cy + HARD; }
    return { x0, y0, x1, y1 };
  }

  async function applyFillMode(mode) {
    if (!state.world) { chat("World not loaded yet.", "err"); return; }
    const layerName = state.editor.layer;
    const layer = state.world.layers.find((l) => l.name === layerName);
    if (!layer) { chat(`No layer "${layerName}".`, "err"); return; }
    if (!state.editor.selected) { chat("Pick a tile from the palette first.", "err"); return; }
    const tile = `${state.editor.selected.tileset}:${state.editor.selected.tileId}`;

    // Pick the bounding rect we're painting into.  For most modes this
    // is the current viewport.  The new "world" / "world-edges" modes
    // expand to a generous bounding box around every painted tile we
    // already have (capped so the brush can never blow up the server).
    let x0, y0, x1, y1;
    if (mode === "world" || mode === "world-edges") {
      const bb = computeWorldBBox();
      x0 = bb.x0; y0 = bb.y0; x1 = bb.x1; y1 = bb.y1;
    } else {
      x0 = Math.floor(state.cameraX);
      y0 = Math.floor(state.cameraY);
      const w = viewportTilesAcross();
      const h = viewportTilesDown();
      x1 = x0 + w - 1;
      y1 = y0 + h - 1;
    }
    // For 'same' we need a reference tile — prefer the cursor's tile if
    // it's in-frame, else the center of the viewport.
    let matchTile = null;
    if (mode === "same") {
      const cx = (state.mouse && state.mouse.tileX != null && state.mouse.tileX >= x0 && state.mouse.tileX <= x1)
        ? state.mouse.tileX : Math.floor((x0 + x1) / 2);
      const cy = (state.mouse && state.mouse.tileY != null && state.mouse.tileY >= y0 && state.mouse.tileY <= y1)
        ? state.mouse.tileY : Math.floor((y0 + y1) / 2);
      matchTile = layer.tiles[`${cx},${cy}`] || null;
    }
    const writes = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const isEdge = (x === x0 || x === x1 || y === y0 || y === y1);
        const key = `${x},${y}`;
        const cur = layer.tiles[key];
        let take = false;
        if (mode === "empty")            take = !cur;
        else if (mode === "edges")       take = isEdge;
        else if (mode === "world-edges") take = isEdge;
        else if (mode === "same")        take = (cur || null) === matchTile;
        else                             take = true; // 'all' or 'world'
        if (!take) continue;
        if (cur === tile) continue; // no-op
        writes.push({ x, y, tile });
      }
    }
    if (!writes.length) { chat(`Fill (${mode}): nothing to paint.`, "cmd"); return; }
    // Optimistically apply locally.
    const prev = new Map();
    for (const w of writes) {
      const k = `${w.x},${w.y}`;
      prev.set(k, layer.tiles[k]);
      layer.tiles[k] = w.tile;
    }
    try {
      // Chunk to keep request bodies sane on huge viewports.
      const CHUNK = 400;
      for (let i = 0; i < writes.length; i += CHUNK) {
        const slice = writes.slice(i, i + CHUNK);
        await api(`/api/world/${SHARD}/paint`, {
          method: "POST",
          body: JSON.stringify({ layer: layerName, tiles: slice }),
        });
      }
      chat(`Fill (${mode}): painted ${writes.length} tile${writes.length === 1 ? "" : "s"} on "${layerName}".`, "good");
    } catch (err) {
      // Roll back on failure.
      for (const [k, v] of prev) {
        if (v === undefined) delete layer.tiles[k];
        else layer.tiles[k] = v;
      }
      chat("Fill failed: " + err.message, "err");
    }
  }
  paletteFillBtn.addEventListener("click", () => applyFillMode(paletteFillMode.value));

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
  // Opening the editor hides the player-facing HUD (stat panel, hotbar,
  // output meter, presence, mini-map) so the admin sees the world cleanly.
  // Chat stays — the admin still needs to type slash commands.
  function openEditor(mode) {
    state.editor.open = true;
    state.editor.mode = mode;
    paletteMode.textContent = mode;
    editModeEl.textContent = mode;
    editFlag.hidden = false;
    paletteEl.hidden = false;
    realmEl.classList.add("is-editing");
    canvas.style.cursor = "crosshair";
    // Remember the player-mode camera zoom so we can restore it when the
    // editor closes — wheel-zoom is only allowed while building.
    state.playerZoom = state.zoom;
    chat(`Editor open — /${mode}. Pick a tile, click world to paint, right-click to erase.`, "cmd");
    ensureTilesetsLoaded();
  }
  function closeEditor() {
    state.editor.open = false;
    paletteEl.hidden = true;
    editFlag.hidden = true;
    realmEl.classList.remove("is-editing");
    // Restore the camera zoom the player chose for normal play (set in
    // Settings → Camera vantage). Without this, you'd carry an editor's
    // 6× zoom back into the world by accident.
    if (typeof state.playerZoom === "number") state.zoom = state.playerZoom;
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

  // The default backdrop used wherever no real ground tile is painted is
  // the deep void of space — black with a sparse field of stars. Drawn into
  // a single large off-screen canvas (256×256) and tiled across the
  // viewport. Two parallax layers of stars give a faint sense of depth
  // without costing per-frame work.
  // Painterly aurora — a soft radial blob blended over the starfield to
  // give the void a slow, breathing wash of color.  Used by render() with
  // two different palettes (violet + gold) for that "magical realism"
  // feel the design doc calls for.
  function drawAuroraBlob(cx, cy, r, hot, cold) {
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, hot);
    grd.addColorStop(1, cold);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grd;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  // Drifting violet/gold motes that float in front of the starfield.
  // Seeded once with stable random vectors so they keep their identity
  // across frames; positions are computed from `t * speed` directly so
  // we never accumulate float drift over a long session.
  function seedStarParticles(n) {
    const arr = [];
    const W = Math.max(window.innerWidth,  640);
    const H = Math.max(window.innerHeight, 480);
    for (let i = 0; i < n; i++) {
      const gold = Math.random() < 0.45;
      arr.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 6,   // px / second
        vy: (Math.random() - 0.5) * 6,
        r: 0.6 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.6 + Math.random() * 0.8,
        gold,
      });
    }
    return arr;
  }
  function drawStarParticles(t) {
    const W = window.innerWidth, H = window.innerHeight;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of state.starParticles) {
      // Wrap softly across the viewport so motes always reappear instead
      // of escaping into infinity.
      const x = ((p.x + p.vx * t) % W + W) % W;
      const y = ((p.y + p.vy * t) % H + H) % H;
      const a = 0.35 + 0.45 * Math.sin(t * p.twinkle + p.phase);
      const fill = p.gold
        ? `rgba(246,228,163,${0.25 + a * 0.55})`
        : `rgba(176,112,255,${0.20 + a * 0.55})`;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  let starfieldPattern = null;
  function makeStarfieldPattern() {
    const SIZE = 256;
    const g = document.createElement("canvas");
    g.width = SIZE; g.height = SIZE;
    const c = g.getContext("2d");
    // Base void — match the login screen's deep ink with just a hint of
    // violet so the field doesn't read as flat dead black against the
    // gold UI.  We bias slightly DARKER than login so painted ground
    // continues to pop.
    const grad = c.createRadialGradient(SIZE/2, SIZE/2, 0, SIZE/2, SIZE/2, SIZE * 0.75);
    grad.addColorStop(0, "#070512");
    grad.addColorStop(1, "#020106");
    c.fillStyle = grad;
    c.fillRect(0, 0, SIZE, SIZE);
    // Distant dust stars (1 px, dim).
    c.fillStyle = "rgba(180, 200, 255, 0.18)";
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      c.fillRect(x, y, 1, 1);
    }
    // Mid-field stars (1 px, brighter).
    c.fillStyle = "rgba(220, 230, 255, 0.55)";
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      c.fillRect(x, y, 1, 1);
    }
    // Foreground "near" stars with a soft cross-glow (sparingly).
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      const r = 1 + Math.floor(Math.random() * 2);
      const halo = c.createRadialGradient(x, y, 0, x, y, 4);
      halo.addColorStop(0, "rgba(255, 246, 220, 0.85)");
      halo.addColorStop(1, "rgba(255, 246, 220, 0)");
      c.fillStyle = halo;
      c.fillRect(x - 4, y - 4, 8, 8);
      c.fillStyle = "rgba(255, 250, 230, 0.95)";
      c.fillRect(x, y, r, r);
    }
    // Whisper of distant nebula — two faint blobs.
    for (const [cx, cy, hue] of [[60, 90, "rgba(80, 60, 160,"], [190, 170, "rgba(40, 90, 160,"]]) {
      const neb = c.createRadialGradient(cx, cy, 0, cx, cy, 70);
      neb.addColorStop(0, hue + "0.10)");
      neb.addColorStop(1, hue + "0)");
      c.fillStyle = neb;
      c.fillRect(cx - 70, cy - 70, 140, 140);
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

  // Screen-shake amplitude decays each frame; bumped by drawBolts on
  // bolt impact (and by anything else dramatic in the future). Tiny
  // amplitudes (<0.4 px) are zeroed so the world stops shimmering.
  function consumeShake() {
    const s = state.fx.shake || { amp: 0, until: 0 };
    if (!s.amp || performance.now() > s.until) return { x: 0, y: 0 };
    const a = s.amp;
    return {
      x: (Math.random() * 2 - 1) * a,
      y: (Math.random() * 2 - 1) * a,
    };
  }
  function pushShake(amp, ms) {
    state.fx.shake = state.fx.shake || { amp: 0, until: 0 };
    // Take the louder of the two so back-to-back impacts add weight.
    state.fx.shake.amp   = Math.max(state.fx.shake.amp, amp);
    state.fx.shake.until = Math.max(state.fx.shake.until, performance.now() + ms);
  }
  function tickShake() {
    const s = state.fx.shake;
    if (!s) return;
    s.amp *= 0.86;                       // smooth decay each frame
    if (s.amp < 0.4) s.amp = 0;
  }

  function render() {
    const tilePx = state.tileSize * state.zoom;
    const cols = viewportTilesAcross() + 1;
    const rows = viewportTilesDown() + 1;
    const camTileX = Math.floor(state.cameraX);
    const camTileY = Math.floor(state.cameraY);
    const offX = -(state.cameraX - camTileX) * tilePx;
    const offY = -(state.cameraY - camTileY) * tilePx;
    // Apply screen-shake to the entire frame (background-stars too — it
    // really does feel like the void itself is rocked when a high-Output
    // bolt slams home). We pair this with a single restore() at the end.
    const shake = consumeShake();
    ctx.save();
    if (shake.x || shake.y) ctx.translate(shake.x, shake.y);

    // Background = the deep void of space, tiled. The starfield pattern is
    // 256×256 (one tile of the pattern covers many world-tiles) so we
    // compute its tile size separately from world tilePx.
    if (!starfieldPattern) starfieldPattern = makeStarfieldPattern();
    const STAR_PX = starfieldPattern.width;
    // Slow parallax: stars drift at 30% of the camera so the world feels
    // big, not glued to the player.
    const sOffX = -((state.cameraX * tilePx * 0.3) % STAR_PX);
    const sOffY = -((state.cameraY * tilePx * 0.3) % STAR_PX);
    const sCols = Math.ceil(window.innerWidth  / STAR_PX) + 2;
    const sRows = Math.ceil(window.innerHeight / STAR_PX) + 2;
    for (let dy = -1; dy < sRows; dy++) {
      for (let dx = -1; dx < sCols; dx++) {
        ctx.drawImage(starfieldPattern, dx * STAR_PX + sOffX, dy * STAR_PX + sOffY);
      }
    }

    // ---- aurora veils — two slow-drifting violet/gold blobs that wash
    // across the void. Adds the painterly "majestic" feel without
    // touching painted ground. Drawn over the star tile but BEFORE
    // world layers so painted dirt still stamps cleanly.
    const t = performance.now() / 1000;
    drawAuroraBlob( window.innerWidth * 0.30 + Math.sin(t * 0.07) * 80,
                    window.innerHeight * 0.35 + Math.cos(t * 0.05) * 60,
                    Math.max(window.innerWidth, window.innerHeight) * 0.55,
                    "rgba(176,112,255,0.10)", "rgba(176,112,255,0)");
    drawAuroraBlob( window.innerWidth * 0.72 + Math.cos(t * 0.06) * 70,
                    window.innerHeight * 0.65 + Math.sin(t * 0.04) * 50,
                    Math.max(window.innerWidth, window.innerHeight) * 0.50,
                    "rgba(246,228,163,0.08)", "rgba(246,228,163,0)");

    // ---- drifting violet & gold motes (foreground void particles).
    // Seeded once and reused; each mote drifts on its own slow vector.
    if (!state.starParticles) state.starParticles = seedStarParticles(64);
    drawStarParticles(t);

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

    // Draw all visible avatars from the smoothed render records, sorted by
    // y so closer-to-camera souls overlap correctly. Self is flagged so it
    // gets the brighter ring and label.
    const meId = state.me?.id;
    const recs = Array.from(state.renderPlayers.values())
      .sort((a, b) => a.y - b.y);
    // Charge aura draws BEHIND the avatars (it's a ground glow), then
    // the avatars sit on top of it.
    drawChargeAura(tilePx);
    for (const rec of recs) drawPlayer(rec, tilePx, rec.id === meId);
    // Combat FX: swing arcs above avatars, damage pops above arcs, speech
    // bubbles above all of it.
    drawSwings(tilePx);
    drawBolts(tilePx);
    drawHitPops(tilePx);
    for (const rec of recs) drawBubble(rec, tilePx);

    // Editor overlays: light grid + cursor highlight.
    if (state.editor.open) {
      drawGrid(cols, rows, tilePx);
      drawCursor(tilePx);
    }

    // Origin cross — easy reference point for admins navigating with WASD.
    drawOriginCross(tilePx);

    // Death veil — drawn last so it covers every layer including the FX.
    if (state.deadOverlay) drawDeathVeil();

    // Pop the screen-shake transform pushed at the top of the frame and
    // decay the residual amplitude so the world settles smoothly.
    ctx.restore();
    tickShake();
  }

  // Charge aura — pulses under the caster while the right mouse button
  // is held with a spell equipped. Read by the main render() loop just
  // before the player avatars are drawn so the glow sits at the feet.
  function drawChargeAura(tilePx) {
    if (!state.charge || !state.charge.active || !state.me) return;
    const rec = state.renderPlayers.get(state.me.id);
    if (!rec) return;
    const { sx, sy } = worldToScreen(rec.x, rec.y, tilePx);
    const cx = sx + tilePx / 2;
    const cy = sy + tilePx / 2;
    // Charge ramps from 0→1 over ~600 ms then sustains; output in 0..1
    // determines max brightness so a tiny dial barely glows.
    const dt = (performance.now() - state.charge.t0) / 600;
    const amt = Math.max(0, Math.min(1, dt));
    const out = Math.max(0.05, Math.min(1, (state.output || 100) / 100));
    const r = tilePx * (0.85 + amt * 0.7);
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.012);
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy + tilePx * 0.25, tilePx * 0.1, cx, cy + tilePx * 0.25, r);
    g.addColorStop(0.00, `rgba(176,112,255,${0.55 * amt * pulse * (0.4 + 0.6 * out)})`);
    g.addColorStop(0.55, `rgba(91,140,255,${0.30 * amt * pulse * (0.4 + 0.6 * out)})`);
    g.addColorStop(1.00, "rgba(60,30,110,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy + tilePx * 0.25, r, 0, Math.PI * 2);
    ctx.fill();
    // A thin spinning ring of sparks at the casting hand to sell the
    // "drawing in mana" beat. Six dots orbiting at amt-scaled radius.
    const ringR = tilePx * (0.55 + amt * 0.35);
    const tnow = performance.now() * 0.005;
    for (let i = 0; i < 6; i++) {
      const a = tnow + (i / 6) * Math.PI * 2;
      const px = cx + Math.cos(a) * ringR;
      const py = cy + Math.sin(a) * ringR * 0.55;          // ellipse, sells "around the body"
      ctx.fillStyle = `rgba(246,228,163,${0.85 * amt})`;
      ctx.shadowColor = "rgba(246,228,163,0.85)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + amt * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- combat FX: slash arcs + floating damage numbers --------------
  // Both fade out over a fixed window (220 ms / 900 ms). We don't bother
  // with a separate animation rAF — the existing render loop already
  // runs at display rate and sweeps these every frame.
  const SWING_LIFE_MS = 220;
  const POP_LIFE_MS   = 900;
  function drawSwings(tilePx) {
    const now = performance.now();
    const fv = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
    const live = [];
    for (const sw of state.fx.swings) {
      const age = now - sw.t0;
      if (age >= SWING_LIFE_MS) continue;
      live.push(sw);
      const t = age / SWING_LIFE_MS;            // 0 → 1
      const alpha = 1 - t;
      const [dx, dy] = fv[sw.facing] || fv.down;
      // Anchor the arc to the swinger's snapshot pos, projected forward.
      const { sx, sy } = worldToScreen(sw.x, sw.y, tilePx);
      const cx = sx + tilePx / 2 + dx * tilePx * sw.reach * 0.55;
      const cy = sy + tilePx / 2 + dy * tilePx * sw.reach * 0.55;
      const r  = tilePx * (sw.reach * 0.55) * (0.7 + 0.3 * t);
      // Sweep angle: perpendicular to facing
      const baseAng = Math.atan2(dy, dx);
      const half = (Math.PI / 3) * (0.6 + 0.4 * t);
      ctx.save();
      // Layered arc: a wide soft halo behind, a bright thin stroke on
      // top.  Reads as a real blade glint instead of a flat curve.
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(246,228,163,0.75)";
      ctx.shadowBlur = 12;
      ctx.lineWidth = Math.max(4, tilePx * 0.30);
      ctx.strokeStyle = `rgba(246,228,163,${0.30 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, baseAng - half, baseAng + half);
      ctx.stroke();
      ctx.shadowBlur = 6;
      ctx.lineWidth = Math.max(2, tilePx * 0.14);
      ctx.strokeStyle = `rgba(255,250,225,${0.95 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, baseAng - half, baseAng + half);
      ctx.stroke();

      // Sparks at the leading tip — six small dots flung outward along
      // the swing direction.  Their offsets are seeded from sw.t0 so a
      // given swing always shows the same pattern of glints.
      const seed = sw.t0 % 1000;
      ctx.shadowBlur = 0;
      for (let i = 0; i < 6; i++) {
        const sa = baseAng + half * (0.7 - i * 0.16);
        const sd = r + (((seed + i * 53) % 9) - 4) * 0.6 + t * tilePx * 0.45;
        const sxk = cx + Math.cos(sa) * sd;
        const syk = cy + Math.sin(sa) * sd;
        const sr  = (1.4 + ((seed + i * 17) % 5) * 0.3) * (1 - t * 0.6);
        ctx.fillStyle = `rgba(255,236,180,${alpha * (0.8 - i * 0.1)})`;
        ctx.beginPath();
        ctx.arc(sxk, syk, sr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    state.fx.swings = live;
  }
  function drawHitPops(tilePx) {
    const now = performance.now();
    const live = [];
    for (const pop of state.fx.pops) {
      const age = now - pop.t0;
      if (age >= POP_LIFE_MS) continue;
      live.push(pop);
      const t = age / POP_LIFE_MS;
      const alpha = 1 - t;
      // Track the target if it's still around; else stick to snapshot pos.
      const rec = state.renderPlayers.get(pop.id);
      const wx = rec ? rec.x : pop.x;
      const wy = rec ? rec.y : pop.y;
      const { sx, sy } = worldToScreen(wx, wy, tilePx);
      const cx = sx + tilePx / 2;
      const cy = sy - 8 - t * 32;          // float upward over the life
      ctx.save();
      ctx.font = `700 ${Math.round(tilePx * 0.95)}px "Cinzel", serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(20,12,6,${0.85 * alpha})`;
      ctx.fillStyle   = `rgba(255,138,122,${alpha})`;
      const txt = `-${pop.dmg}`;
      ctx.strokeText(txt, cx, cy);
      ctx.fillText(txt, cx, cy);
      ctx.restore();
    }
    state.fx.pops = live;
  }

  // Mana Bolt — a TRAVELING violet/gold ball (NOT a beam).  It launches
  // from the caster's position, flies along the cast lane at the spell's
  // travel speed, leaves a fading gold trail, and pops on impact.  Per
  // design doc §14/§18 the projectile is sized & brightened by the
  // caster's Output dial so a 100% bolt feels much weightier.
  //
  // The trail is rendered as a soft alpha-falling line BEHIND the ball,
  // built from the same straight-line segment using a per-segment dash
  // gradient (cheap — no real particle physics needed).
  function drawBolts(tilePx) {
    const now = performance.now();
    const live = [];
    for (const b of state.fx.bolts) {
      const age = now - b.t0;
      if (age > b.travelMs + b.fadeMs) continue;
      live.push(b);

      const flightP = Math.min(1, age / Math.max(1, b.travelMs));
      const fadeAmt = age > b.travelMs ? Math.min(1, (age - b.travelMs) / b.fadeMs) : 0;
      const alpha = 1 - fadeAmt * 0.9;
      const out   = b.output;

      // Current ball position in screen space, plus a TRAILING anchor
      // (~0.7 tiles back along the lane) for the comet tail.
      const ballWX = b.fromX + (b.toX - b.fromX) * flightP;
      const ballWY = b.fromY + (b.toY - b.fromY) * flightP;
      const dxw = b.toX - b.fromX, dyw = b.toY - b.fromY;
      const lw = Math.hypot(dxw, dyw) || 1;
      const ux = dxw / lw, uy = dyw / lw;
      const trailLen = 0.7 + out * 1.1;          // tiles of gold tail
      const tailWX = ballWX - ux * trailLen;
      const tailWY = ballWY - uy * trailLen;

      const ball = worldToScreen(ballWX, ballWY, tilePx);
      const tail = worldToScreen(tailWX, tailWY, tilePx);
      const ballR = (tilePx * 0.18) + out * (tilePx * 0.22);

      ctx.save();
      ctx.lineCap = "round";

      // ---- gold trail — a wide soft segment that fades with age ------
      const trail = ctx.createLinearGradient(tail.sx, tail.sy, ball.sx, ball.sy);
      trail.addColorStop(0.00, "rgba(246,228,163,0)");
      trail.addColorStop(0.55, `rgba(246,228,163,${0.55 * alpha})`);
      trail.addColorStop(1.00, `rgba(255,236,180,${0.85 * alpha})`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = ballR * 1.05;
      ctx.shadowColor = "rgba(246,228,163,0.65)";
      ctx.shadowBlur = 10 + out * 12;
      ctx.beginPath();
      ctx.moveTo(tail.sx, tail.sy);
      ctx.lineTo(ball.sx, ball.sy);
      ctx.stroke();

      // ---- violet outer halo around the ball -------------------------
      ctx.shadowBlur = 0;
      const halo = ctx.createRadialGradient(ball.sx, ball.sy, 0, ball.sx, ball.sy, ballR * 2.4);
      halo.addColorStop(0.00, `rgba(176,112,255,${0.85 * alpha})`);
      halo.addColorStop(0.45, `rgba(143,90,230,${0.55 * alpha})`);
      halo.addColorStop(1.00, `rgba(60,30,110,0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(ball.sx, ball.sy, ballR * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // ---- blue inner shell ------------------------------------------
      ctx.fillStyle = `rgba(91,140,255,${alpha})`;
      ctx.shadowColor = "rgba(91,140,255,0.85)";
      ctx.shadowBlur = 14 + out * 10;
      ctx.beginPath();
      ctx.arc(ball.sx, ball.sy, ballR * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // ---- hot bright core (gold-white) ------------------------------
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,250,225,${alpha})`;
      ctx.beginPath();
      ctx.arc(ball.sx, ball.sy, ballR * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // ---- launch flash at the caster (early lifetime only) ----------
      if (flightP < 0.18) {
        const launchA = (0.18 - flightP) / 0.18;
        const origin  = worldToScreen(b.fromX, b.fromY, tilePx);
        const launchR = ballR * (1.4 + launchA * 1.2);
        const flash = ctx.createRadialGradient(origin.sx, origin.sy, 0, origin.sx, origin.sy, launchR);
        flash.addColorStop(0.00, `rgba(255,250,225,${0.85 * launchA})`);
        flash.addColorStop(0.45, `rgba(176,112,255,${0.55 * launchA})`);
        flash.addColorStop(1.00, "rgba(60,30,110,0)");
        ctx.fillStyle = flash;
        ctx.beginPath();
        ctx.arc(origin.sx, origin.sy, launchR, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- impact burst on landing -----------------------------------
      if (flightP >= 1) {
        // First frame of impact triggers a one-shot screen shake whose
        // amplitude scales with Output — a 100% bolt rocks the void, a
        // 20% poke barely registers.
        if (!b._shook) {
          b._shook = true;
          pushShake(2.4 + out * 7.5, 220);
        }
        const burstA = (1 - fadeAmt);
        const burstR = ballR * (1.8 + (1 - fadeAmt) * 1.7);
        const burst = ctx.createRadialGradient(ball.sx, ball.sy, 0, ball.sx, ball.sy, burstR);
        burst.addColorStop(0.00, `rgba(255,250,225,${0.98 * burstA})`);
        burst.addColorStop(0.35, `rgba(255,236,180,${0.85 * burstA})`);
        burst.addColorStop(0.65, `rgba(176,112,255,${0.55 * burstA})`);
        burst.addColorStop(1.00, "rgba(60,30,110,0)");
        ctx.fillStyle = burst;
        ctx.beginPath();
        ctx.arc(ball.sx, ball.sy, burstR, 0, Math.PI * 2);
        ctx.fill();
        // A brief outward shock-ring grows with the burst.
        ctx.strokeStyle = `rgba(255,236,180,${0.7 * burstA})`;
        ctx.lineWidth = Math.max(1.5, ballR * 0.35) * burstA;
        ctx.beginPath();
        ctx.arc(ball.sx, ball.sy, burstR * 1.05, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
    state.fx.bolts = live;
  }

  function drawDeathVeil() {
    const w = canvas.width, h = canvas.height;
    const now = performance.now();
    const left = Math.max(0, state.deadOverlay.until - now);
    const fade = Math.min(1, (4500 - left) / 600);
    ctx.save();
    ctx.fillStyle = `rgba(8,4,4,${0.78 * fade})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgba(255,108,108,${fade})`;
    ctx.font = `900 ${Math.round(Math.min(w, h) * 0.09)}px "Cinzel", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 18;
    ctx.fillText("YOU HAVE FALLEN", w/2, h/2 - 18);
    ctx.font = `500 ${Math.round(Math.min(w, h) * 0.028)}px "Cormorant Garamond", serif`;
    ctx.fillStyle = `rgba(246,228,163,${0.9 * fade})`;
    ctx.fillText(`Slain by ${state.deadOverlay.by} — the vessel is spent.`, w/2, h/2 + 30);
    ctx.restore();
  }

  // ---- avatar rendering ----
  // Players draw with their own sprite sheet when one is loaded; otherwise
  // we fall back to the race-tinted glowing pip so the world is still
  // legible. Name plate sits above the head and a soft elliptical shadow
  // grounds the avatar to the tile.
  const RACE_COLOR = {
    human: "#f4d499", orc: "#7fe39a", elf: "#b9e6e6",
    crystalline: "#cfe4ff", voidborn: "#caa6ff",
  };
  function drawPlayer(rec, tilePx, isSelf) {
    const { sx, sy } = worldToScreen(rec.x, rec.y, tilePx);
    const cx = sx + tilePx / 2;
    const cy = sy + tilePx / 2;
    // Cast trumps walk trumps idle: if we recently fired a spell (or the
    // server told us this player is casting), swap to the no-weapon CAST
    // sheet snapped to the cardinal we resolved at cast time.  Otherwise
    // walk vs idle by movement.
    const castEntry = isCasting(rec.id);
    let animKey;
    if (castEntry) {
      // Force the recorded cast facing onto the render record so the
      // direction-specific cast sheet is selected (rec.facing is the
      // server-authoritative facing, which may have already moved).
      rec.facing = castEntry.facing || rec.facing;
      animKey = "cast";
    } else if (rec.anim === "walk" || Math.hypot(rec.tx - rec.x, rec.ty - rec.y) > 0.05) {
      animKey = "walk";
    } else {
      animKey = "idle";
    }
    const sprite = getSpriteForPlayer(rec, animKey);
    if (sprite) {
      drawSpriteAvatar(sprite, rec, cx, cy, tilePx);
    } else {
      drawCirclePip(rec, cx, cy, tilePx, isSelf);
    }
    // Mana Shield aura — a pulsing cyan ring that fades as shield HP drops.
    if (rec.shield && rec.shield.until > performance.now()) {
      const age = performance.now() - (rec.shield.until - 8000);
      const hpFrac = Math.max(0, rec.shield.hp / (rec.shield.maxHp || 1));
      const alpha  = Math.min(0.85, hpFrac * 0.85);
      const r      = tilePx * (0.72 + 0.08 * Math.sin(age * 0.004));
      const grad   = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
      grad.addColorStop(0, `rgba(80,220,255,0)`);
      grad.addColorStop(0.7, `rgba(80,220,255,${(alpha * 0.3).toFixed(2)})`);
      grad.addColorStop(1, `rgba(120,240,255,${alpha.toFixed(2)})`);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(160,240,255,${(alpha * 0.9).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Name plate — small enough to read as a banner OVER the player's
    // head (it used to drift well above the avatar and dominate the
    // canvas). 10 px Cinzel, 12 px tall pill, anchored ~1.7 tiles above
    // the player center per design doc §8.
    const label = rec.name + (rec.isAdmin ? " ✦" : "");
    ctx.font = "600 10px 'Cinzel', 'Cormorant Garamond', serif";
    const w = ctx.measureText(label).width + 10;
    const ny = cy - tilePx * 1.7 - 14;
    ctx.fillStyle = "rgba(10,10,18,0.82)";
    ctx.fillRect(cx - w / 2, ny, w, 13);
    ctx.strokeStyle = isSelf ? "rgba(246,228,163,0.7)"
                              : "rgba(217,166,74,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2 + 0.5, ny + 0.5, w - 1, 12);
    ctx.fillStyle = isSelf ? "#f6e4a3" : (rec.isAdmin ? "#f6e4a3" : "#e9dfc6");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, ny + 7);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
  function drawCirclePip(rec, cx, cy, tilePx, isSelf) {
    const r  = tilePx * 0.42;
    const fill = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = isSelf ? 2.5 : 1.5;
    ctx.strokeStyle = rec.isAdmin ? "#f6e4a3" : (isSelf ? "rgba(246,228,163,0.9)" : "rgba(0,0,0,0.55)");
    ctx.beginPath();
    ctx.arc(cx, cy, r + (isSelf ? 1 : 0), 0, Math.PI * 2);
    ctx.stroke();
    const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [fx, fy] = dirs[rec.facing] || [0, 1];
    ctx.strokeStyle = "rgba(20,16,8,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + fx * r * 0.85, cy + fy * r * 0.85);
    ctx.stroke();
  }
  function drawSpriteAvatar(sprite, rec, cx, cy, tilePx) {
    const slice = sprite.slice;
    const frames = Math.max(1, slice.frames | 0);
    const idx = Math.floor(rec.animTime * slice.fps) % frames;
    let sx, sy, sw, sh;
    if (slice.perFrame && slice.frameRects && slice.frameRects[idx]) {
      ({ x: sx, y: sy, w: sw, h: sh } = slice.frameRects[idx]);
    } else {
      sx = slice.offsetX + idx * (slice.frameW + slice.gapX);
      sy = slice.offsetY;
      sw = slice.frameW;
      sh = slice.frameH;
    }
    // Scale so each sprite is roughly two tiles tall — feels right for a
    // top-down RPG (54px sprite at 16px tiles → ~1.7 tiles, then ×scale).
    const targetH = tilePx * 1.9;
    const scale = targetH / sh;
    const dw = sw * scale, dh = sh * scale;
    const dx = cx - dw / 2;
    const dy = cy - dh * 0.78;       // anchor near the feet, not the center
    // Soft shadow at the base
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + tilePx * 0.32, tilePx * 0.36, tilePx * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  // Speech bubble that floats above the avatar for a few seconds after
  // a chat message arrives. Wraps to fit a max width and adjusts its
  // height per line — clean parchment look matches the rest of the HUD.
  function drawBubble(rec, tilePx) {
    if (!rec.bubble) return;
    const now = performance.now();
    if (now > rec.bubble.until) { rec.bubble = null; return; }
    const { sx, sy } = worldToScreen(rec.x, rec.y, tilePx);
    const cx = sx + tilePx / 2;
    const baseY = sy + tilePx / 2 - tilePx * 0.85 - 18;

    ctx.font = "500 13px 'Cormorant Garamond', serif";
    const maxW = 220;
    const words = rec.bubble.text.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (ctx.measureText(trial).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    const lineH = 16;
    const padX = 8, padY = 5;
    let bw = 0;
    for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
    bw += padX * 2;
    const bh = lines.length * lineH + padY * 2;
    const bx = cx - bw / 2;
    const by = baseY - bh - 6;
    // Fade out in the last 600ms.
    const remain = rec.bubble.until - now;
    const alpha = remain < 600 ? remain / 600 : 1;
    ctx.globalAlpha = alpha;
    // panel + ornate gold edge
    ctx.fillStyle = "rgba(14,12,18,0.92)";
    ctx.strokeStyle = "rgba(217,166,74,0.7)";
    ctx.lineWidth = 1;
    roundRect(bx, by, bw, bh, 4);
    ctx.fill();
    ctx.stroke();
    // tail
    ctx.beginPath();
    ctx.moveTo(cx - 5, by + bh);
    ctx.lineTo(cx + 5, by + bh);
    ctx.lineTo(cx,     by + bh + 6);
    ctx.closePath();
    ctx.fillStyle = "rgba(14,12,18,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(217,166,74,0.7)";
    ctx.stroke();
    // text
    ctx.fillStyle = rec.isAdmin ? "#f6e4a3" : "#ece2c5";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, by + padY + i * lineH);
    }
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
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

  // Highlight whichever hotbar slot is currently equipped.
  // No fallback to a "basic attack" slot — there is no basic attack in
  // Freeform Mana (§7.1 — weapons do not exist).
  function paintEquipHighlight() {
    document.querySelectorAll(".hb-slot[data-equipped]")
      .forEach((b) => b.removeAttribute("data-equipped"));
    if (state.equippedSpell) {
      const btn = document.querySelector(`.hb-slot[data-spell="${state.equippedSpell}"]`)
               || document.querySelector(`.sw-slot[data-spell="${state.equippedSpell}"]`);
      if (btn) btn.setAttribute("data-equipped", "true");
    }
  }
  const SPELL_LABELS = {
    mana_shield: "Mana Shield",
    mana_bolt:   "Mana Bolt",
  };
  function spellLabel(id) { return SPELL_LABELS[id] || (id || "Spell"); }
  // Equip / un-equip a hotbar spell. Pressing the same key twice lowers
  // the hand. Casting is driven by mousedown/mouseup, not here.
  function toggleEquipSpell(spell) {
    if (state.equippedSpell === spell) {
      state.equippedSpell = "";
      paintEquipHighlight();
      chat(`${spellLabel(spell)} lowered.`, "cmd");
    } else {
      state.equippedSpell = spell;
      paintEquipHighlight();
      chat(`${spellLabel(spell)} raised — left-click taps (20%), right-click charges to Output%.`, "cmd");
    }
    showSpellWheel(false);
  }

  // Slot-2 cast.  The cursor gives a full 360° aim vector that we forward
  // to the server, plus the cardinal facing the sprite should rotate to
  // (the avatar art only has four facings).  Output is normalized into a
  // 0.05..1 unit float and capped server-side again.
  function aimFromCursor() {
    if (!state.me) return { facing: "down", aimX: 0, aimY: 1 };
    const dx = (state.mouse.worldX || 0) - (state.me.x || 0);
    const dy = (state.mouse.worldY || 0) - (state.me.y || 0);
    const len = Math.hypot(dx, dy);
    if (len < 0.05) {
      const f = state.me.facing || "down";
      const v = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] }[f];
      return { facing: f, aimX: v[0], aimY: v[1] };
    }
    const facing = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down"  : "up");
    return { facing, aimX: dx / len, aimY: dy / len };
  }
  function sendCast(spell, outputOverride) {
    if (!state.wsReady || !state.me) return;
    const { facing, aimX, aimY } = aimFromCursor();
    state.me.facing = facing;          // snap local sprite immediately
    const output = (typeof outputOverride === "number")
      ? Math.max(0.05, Math.min(1, outputOverride))
      : Math.max(0.05, Math.min(1, (state.output || 100) / 100));
    // Locally flag the caster as "casting" for ~360 ms so drawPlayer
    // swaps to the no-weapon CAST sprite, snapped to the cardinal we
    // just resolved.  The server doesn't need this — it's pure VFX.
    if (state.me.id != null) markCasting(state.me.id, facing, 360);
    try {
      state.ws.send(JSON.stringify({
        type: "cast", spell, facing, output, aimX, aimY,
      }));
    } catch {}
  }
  // Track per-player cast-anim windows so the sprite snaps to the cast
  // sheet for a brief beat after firing.  Keyed by player id; each entry
  // is `{ until, facing }`.  Cleaned up lazily during render.
  function markCasting(id, facing, ms) {
    if (!state.fx.casting) state.fx.casting = new Map();
    state.fx.casting.set(id, { until: performance.now() + (ms || 320), facing });
  }
  function isCasting(id) {
    if (!state.fx.casting) return null;
    const e = state.fx.casting.get(id);
    if (!e) return null;
    if (performance.now() > e.until) { state.fx.casting.delete(id); return null; }
    return e;
  }

  let lastTickTime = 0;
  function tick(now) {
    const dt = lastTickTime ? Math.min(0.1, (now - lastTickTime) / 1000) : 0;
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
      // While editing, pause input transmission so the avatar stays put.
      if (state.wsReady && (state.lastInputSent.dx || state.lastInputSent.dy)) {
        state.lastInputSent.dx = 0; state.lastInputSent.dy = 0;
        try { state.ws.send(JSON.stringify({ type: "input", dx: 0, dy: 0, sprint: false, facing: state.lastInputSent.facing })); } catch {}
      }
    } else {
      maybeSendInput();
    }

    // Smoothly interpolate every avatar's visual position toward its
    // server-authoritative target. This is what makes 60fps render look
    // fluid even though the server only ticks at 20Hz.
    lerpRenderPositions(dt);

    // Camera follows the smoothed self-record so it never jitters.
    if (!state.editor.open && state.me) {
      const meRec = state.renderPlayers.get(state.me.id);
      if (meRec) {
        const tilePx = state.tileSize * state.zoom;
        const cols = window.innerWidth  / tilePx;
        const rows = window.innerHeight / tilePx;
        state.cameraX = meRec.x - cols / 2 + 0.5;
        state.cameraY = meRec.y - rows / 2 + 0.5;
      }
    }

    // HUD coords readout — show the player's own integer tile, not the
    // float lerp position and not the mouse hover (the mouse readout was
    // a leftover from the old editor-only HUD).
    if (state.me) {
      coordsEl.textContent = `(${Math.round(state.me.x)}, ${Math.round(state.me.y)})`;
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
        state.renderPlayers.clear();
        ensureRenderRec(msg.you);
        for (const o of msg.others || []) {
          state.others.set(o.id, o);
          ensureRenderRec(o);
        }
        setPresence(state.others.size + 1);
        // Hydrate the HUD from authoritative vitals — the server may have
        // a wounded HP from a previous session, and stamina/mana always
        // start at cap.
        if (state.character) {
          if (msg.you.hpMax)   state.character.max_hp      = msg.you.hpMax;
          if (msg.you.manaMax) state.character.mana_cap    = msg.you.manaMax;
          if (msg.you.stMax)   state.character.stamina_cap = msg.you.stMax;
          state.cur.hp = msg.you.hp ?? state.cur.hp;
          state.cur.mp = msg.you.mana ?? state.cur.mp;
          state.cur.st = msg.you.st ?? state.cur.st;
          refreshBars();
        }
        chat(`Shard "${msg.shard}" — ${state.others.size} other ${state.others.size === 1 ? "soul" : "souls"} present.`, "cmd");
        break;
      case "join":
        if (msg.player && msg.player.id !== state.me?.id) {
          state.others.set(msg.player.id, msg.player);
          ensureRenderRec(msg.player);
          setPresence(state.others.size + 1);
        }
        break;
      case "leave":
        state.others.delete(msg.id);
        state.renderPlayers.delete(msg.id);
        setPresence(state.others.size + (state.me ? 1 : 0));
        break;
      case "state": {
        for (const p of msg.players || []) {
          ensureRenderRec(p);
          if (state.me && p.id === state.me.id) {
            state.me.x = p.x; state.me.y = p.y;
            state.me.facing = p.facing; state.me.anim = p.anim;
            // Mirror live vitals into HUD; tick is 20Hz which is fine
            // for the bar smoothing and number readouts.
            if (typeof p.hp === "number") state.cur.hp = p.hp;
            if (typeof p.mana === "number") state.cur.mp = p.mana;
            if (typeof p.st === "number") state.cur.st = p.st;
            refreshBars();
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
        for (const id of state.renderPlayers.keys()) {
          if (!present.has(id) && id !== state.me?.id) state.renderPlayers.delete(id);
        }
        // Snapshot's player count is the truth — keep the HUD in lockstep.
        setPresence((msg.players || []).length);
        break;
      }
      case "chat":
        if (msg.kind === "system") chat(msg.text, "cmd");
        else if (msg.from) {
          const tag = msg.from.isAdmin ? "✦ " : "";
          chat(`${tag}${msg.from.name}: ${msg.text}`,
               msg.from.id === state.me?.id ? "self" : "");
          // Speech bubble above the speaker — shows up over their avatar
          // for everyone in the shard, including themselves.
          attachBubble(msg.from.id, msg.text);
        }
        break;
      case "swing": {
        // Render a fading slash arc in front of the caster. Kept for
        // future spell-hit VFX; weapon property removed (no weapons exist).
        const rec = state.renderPlayers.get(msg.id);
        if (rec) {
          state.fx.swings.push({
            id: msg.id,
            x: rec.x, y: rec.y,
            facing: msg.facing || rec.facing || "down",
            reach: msg.reach || 1.2,
            arc: msg.arc || 0.7,
            t0: performance.now(),
          });
        }
        break;
      }
      case "hit": {
        // Floating damage number above the target, plus a brief red flash.
        const rec = state.renderPlayers.get(msg.id);
        const now = performance.now();
        if (rec) {
          state.fx.pops.push({
            id: msg.id,
            x: rec.x, y: rec.y,
            dmg: msg.dmg,
            t0: now,
          });
          state.fx.hits.set(msg.id, now + 220);
        }
        // If we're the one taking the hit, knock our local HP down right
        // away (the next state packet will confirm) so the bar reacts
        // before the next tick lands.
        if (state.me && msg.id === state.me.id && typeof msg.hp === "number") {
          state.cur.hp = msg.hp;
          refreshBars();
        }
        break;
      }
      case "attack_denied":
        if (msg.reason === "stamina") chat("Too winded — catch your breath.", "err");
        break;
      case "bolt": {
        // Add a flying-beam effect that travels from caster to endpoint
        // at the spell's tile/sec speed; the renderer will draw it for
        // however long the trip + a short fade takes.
        const dx = msg.to.x - msg.from.x;
        const dy = msg.to.y - msg.from.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const travelMs = (dist / Math.max(1, msg.speed || 18)) * 1000;
        state.fx.bolts.push({
          spell: msg.spell,
          fromX: msg.from.x, fromY: msg.from.y,
          toX:   msg.to.x,   toY:   msg.to.y,
          output: msg.output || 1,
          t0: performance.now(),
          travelMs,
          fadeMs: 220,
        });
        // If the caster was us, deduct mana locally for snappy feedback.
        if (state.me && msg.from.id === state.me.id) {
          // Server is authoritative — next state packet refreshes anyway,
          // but the bolt event itself implies the cost was paid.
          // (No-op here: state ticks at 20Hz, so the bar will update fast.)
        }
        break;
      }
      case "cast_denied":
        if (msg.reason === "mana") chat("Not enough mana.", "err");
        break;
      case "shield": {
        // A player's Mana Shield just activated. Record it on their render
        // record so the draw loop can paint the glowing aura.
        const rec = state.renderPlayers.get(msg.id);
        if (rec) {
          rec.shield = { hp: msg.hp, maxHp: msg.maxHp, until: performance.now() + 8000 };
        }
        if (state.me && msg.id === state.me.id) {
          chat(`Mana Shield raised — ${msg.hp.toLocaleString()} HP.`, "cmd");
          // Light up slot 1 with cyan aura; auto-clear when shield expires.
          const slot1 = document.querySelector('.hb-slot[data-spell="mana_shield"]');
          if (slot1) {
            slot1.classList.add("shield-on");
            clearTimeout(slot1._shieldTimer);
            slot1._shieldTimer = setTimeout(() => slot1.classList.remove("shield-on"), 8000);
          }
        }
        break;
      }
      case "slain": {
        const isMe = state.me && msg.id === state.me.id;
        const byTxt = msg.by ? msg.by.name : "the realm";
        if (isMe) {
          // Flag self-death — render loop pops a parchment death screen
          // over the canvas; the socket will close right after.
          state.deadOverlay = { until: performance.now() + 4500, by: byTxt };
          chat(`You were slain by ${byTxt}. The vessel is spent.`, "err");
        } else {
          chat(`${msg.name || "Someone"} fell to ${byTxt}.`, "cmd");
        }
        break;
      }
      case "goodbye":
        chat("Server: " + (msg.reason || "disconnected"), "err");
        if (msg.reason === "slain") {
          // Hold the death overlay long enough to read it, then bow out
          // so the player lands on the forge to mourn / re-vessel.
          setTimeout(() => leave(), 1500);
        }
        break;
    }
  }
  function disconnectSocket() {
    if (!state.ws) return;
    try { state.ws.close(1000, "leave"); } catch {}
    state.ws = null;
    state.wsReady = false;
    state.others.clear();
    state.renderPlayers.clear();
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
    const raceLabel = isAdmin ? "Architect" : (ch.race_name || ch.race || "—");
    statsRace.textContent  = raceLabel;
    statsRace.classList.toggle("is-admin", isAdmin);
    statsXp.textContent    = ch.xp ?? 0;
    statsCtrl.textContent  = ch.control ?? 10;
    statsRes.textContent   = `${ch.resistance ?? 0}%`;
    if (statsCast) statsCast.textContent = `${(ch.cast_speed ?? 1).toFixed(1)}×`;
    const classLabel = isAdmin ? "Architect" : (ch.char_class || "—");

    // Mirror everything into the Vessel modal so opening it gives a full sheet.
    if (charModalRefs.name) {
      charModalRefs.name.textContent  = ch.name || "—";
      charModalRefs.race.textContent  = raceLabel;
      charModalRefs.level.textContent = ch.level ?? 1;
      charModalRefs.hp.textContent    = `${ch.hp ?? ch.max_hp ?? 0} / ${ch.max_hp ?? 0}`;
      charModalRefs.mp.textContent    = `${ch.mana_cap ?? 0}`;
      charModalRefs.st.textContent    = `${ch.stamina_cap ?? 0}`;
      charModalRefs.xp.textContent    = `${ch.xp ?? 0}`;
      charModalRefs.ctrl.textContent  = `${ch.control ?? 10}`;
      charModalRefs.cast.textContent  = `${(ch.cast_speed ?? 1).toFixed(2)}×`;
      charModalRefs.eff.textContent   = `${(ch.efficiency ?? 1).toFixed(2)}×`;
      charModalRefs.res.textContent   = `${ch.resistance ?? 0}%`;
      if (charModalRefs.cls) charModalRefs.cls.textContent = classLabel;
    }

    refreshBars();
    drawHudPortrait();
    // Plate may have just become visible — re-pin the Output meter so
    // it sits above the freshly-measured hotbar.
    positionOutputMeter();
  }

  // ---- HUD portrait ---------------------------------------------------
  // Draws the player into the bottom-HUD portrait frame. For admins we
  // grab an idle "Down" frame from the sprite registry; for everyone else
  // we paint a race-tinted glowing pip so the frame is never empty.
  function drawHudPortrait() {
    const ch = state.character;
    if (!ch) return;
    const isAdmin = ch.race === null || ch.race === undefined;
    paintPortrait(hudPortraitCtx, hudPortrait.width, hudPortrait.height, ch, isAdmin);
    if (charModalPortraitCtx) {
      paintPortrait(charModalPortraitCtx, charModalPortrait.width, charModalPortrait.height, ch, isAdmin);
    }
    if (hudPortraitEmpty) hudPortraitEmpty.hidden = true;
  }
  function paintPortrait(c, w, h, ch, isAdmin) {
    c.imageSmoothingEnabled = false;
    // Backdrop wash — match the frame's tint.
    const bg = c.createRadialGradient(w/2, h*0.35, 4, w/2, h/2, w*0.7);
    bg.addColorStop(0, isAdmin ? "rgba(246,228,163,0.18)" : "rgba(91,140,255,0.16)");
    bg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = "rgba(0,0,0,0)";
    c.clearRect(0, 0, w, h);
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    if (isAdmin && SpriteSet.loaded) {
      const set = SpriteSet.sheets.admin.idle.down
               || SpriteSet.sheets.admin.idle.right
               || SpriteSet.sheets.admin.idle.up;
      if (set && set.img) {
        const slice = set.slice;
        let sx, sy, sw, sh;
        if (slice.perFrame && slice.frameRects && slice.frameRects[0]) {
          ({ x: sx, y: sy, w: sw, h: sh } = slice.frameRects[0]);
        } else {
          sx = slice.offsetX; sy = slice.offsetY;
          sw = slice.frameW;   sh = slice.frameH;
        }
        // Fit the sprite vertically with a margin so the head + torso show.
        const targetH = h * 0.95;
        const scale = targetH / sh;
        const dw = sw * scale, dh = sh * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2 + h * 0.04;  // nudge down a hair
        c.drawImage(set.img, sx, sy, sw, sh, dx, dy, dw, dh);
        return;
      }
    }
    // Fallback: race-tinted glowing pip.
    const RACE = { human: "#f4d499", orc: "#7fe39a", elf: "#b9e6e6",
                   crystalline: "#cfe4ff", voidborn: "#caa6ff" };
    const fill = isAdmin ? "#f6e4a3" : (RACE[ch.race] || "#cfe4ff");
    const r = w * 0.32;
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.ellipse(w/2, h*0.78, r*0.85, r*0.32, 0, 0, Math.PI*2);
    c.fill();
    const glow = c.createRadialGradient(w/2, h/2, 0, w/2, h/2, r*1.6);
    glow.addColorStop(0, fill);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fill;
    c.beginPath();
    c.arc(w/2, h/2, r, 0, Math.PI*2);
    c.fill();
    c.strokeStyle = "rgba(20,16,8,0.6)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(w/2, h/2, r, 0, Math.PI*2);
    c.stroke();
  }
  function refreshBars() {
    const ch = state.character;
    if (!ch) return;
    const maxHp = ch.max_hp || 1;
    const maxMp = ch.mana_cap || 1;
    const maxSt = ch.stamina_cap || 1;
    const pct = (n, m) => Math.max(0, Math.min(100, (n / m) * 100));
    const hpPct = pct(state.cur.hp, maxHp);
    barHpFill.style.width = hpPct + "%";
    barMpFill.style.width = pct(state.cur.mp, maxMp) + "%";
    barStFill.style.width = pct(state.cur.st, maxSt) + "%";
    barHpNum.textContent = `${Math.round(state.cur.hp)}/${maxHp}`;
    barMpNum.textContent = `${Math.round(state.cur.mp)}/${maxMp}`;
    barStNum.textContent = `${Math.round(state.cur.st)}/${maxSt}`;
    // Pulse the HP bar when life is low — purely cosmetic until combat lands.
    barHpFill.parentElement.classList.toggle("is-low", hpPct < 30);
  }
  function setBadge(role) {
    rbServerName.textContent = "0 · Firstlight";
    rbMode.textContent = role === "admin" ? "Architect Mode" : "Player Mode";
  }
  function setPresence(n) {
    state.presence = n;
    presenceCt.textContent = n;
  }

  // Mini-map: 200×200 px, 1 px ≈ 1 tile, range ±100 tiles around self.
  // Re-renders at ~12Hz (capped) so we never spend 60fps walking the world's
  // painted-tile maps. Draws background + paint (faint) + cardinal cross +
  // other souls + self pip with a glow halo and facing tick.
  const MM_HALF = 100;
  let lastMinimapAt = 0;
  function renderMinimap() {
    const now = performance.now();
    if (now - lastMinimapAt < 80) return; // ~12 Hz cap
    lastMinimapAt = now;

    const w = minimap.width, h = minimap.height;
    const cx = w / 2, cy = h / 2;
    // Backplate
    minimapCtx.fillStyle = "#0c0e14";
    minimapCtx.fillRect(0, 0, w, h);

    // Center on the smoothed self position so the pip is rock-steady.
    const meRec = state.me ? state.renderPlayers.get(state.me.id) : null;
    const meX = meRec ? meRec.x : 0;
    const meY = meRec ? meRec.y : 0;

    // Faint painted-tile occupancy. Cap iterations so a fully-painted world
    // never becomes a perf cliff.
    if (state.world) {
      minimapCtx.fillStyle = "rgba(105, 145, 90, 0.42)";
      let drawn = 0;
      const cap = 6000;
      outer: for (const layer of state.world.layers) {
        for (const k in layer.tiles) {
          const c = k.indexOf(",");
          const tx = +k.slice(0, c), ty = +k.slice(c + 1);
          const dx = tx - meX, dy = ty - meY;
          if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
          minimapCtx.fillRect(cx + dx, cy + dy, 1, 1);
          if (++drawn >= cap) break outer;
        }
      }
    }

    // Cardinal cross + outer frame
    minimapCtx.strokeStyle = "rgba(217,166,74,0.22)";
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, 0); minimapCtx.lineTo(cx + 0.5, h);
    minimapCtx.moveTo(0, cy + 0.5); minimapCtx.lineTo(w, cy + 0.5);
    minimapCtx.stroke();

    // Other souls (3px square, race-tinted)
    for (const rec of state.renderPlayers.values()) {
      if (state.me && rec.id === state.me.id) continue;
      const dx = rec.x - meX, dy = rec.y - meY;
      if (Math.abs(dx) > MM_HALF || Math.abs(dy) > MM_HALF) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      minimapCtx.fillStyle = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
      minimapCtx.fillRect(px - 1, py - 1, 3, 3);
    }

    if (!meRec) return;

    // Self pip — gold with a soft glow halo so it always reads against any
    // backdrop. This is the bit the user couldn't find before.
    const grd = minimapCtx.createRadialGradient(cx, cy, 0, cx, cy, 9);
    grd.addColorStop(0, "rgba(246,228,163,0.9)");
    grd.addColorStop(1, "rgba(246,228,163,0)");
    minimapCtx.fillStyle = grd;
    minimapCtx.fillRect(cx - 9, cy - 9, 18, 18);
    minimapCtx.fillStyle = "#fff7d8";
    minimapCtx.fillRect(cx - 2, cy - 2, 5, 5);
    minimapCtx.strokeStyle = "rgba(20,16,8,0.95)";
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(cx - 2.5, cy - 2.5, 6, 6);
    // Facing tick (fans out from the pip)
    const fdir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[meRec.facing] || [0, 1];
    minimapCtx.strokeStyle = "#fff7d8";
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(cx + 0.5, cy + 0.5);
    minimapCtx.lineTo(cx + 0.5 + fdir[0] * 8, cy + 0.5 + fdir[1] * 8);
    minimapCtx.stroke();
  }

  // ---- output meter ----
  function refreshOutput() {
    outFill.style.width = state.output + "%";
    outNum.textContent  = state.output + "%";
    // The .is-charging class is owned by the actual right-click charge
    // (mousedown/up handlers), not by the dial value, so we don't toggle
    // it here.
  }

  // Pin the Output meter just above the bottom hotbar plate.  The plate
  // height changes on narrow viewports, so we measure the live element
  // each time instead of hard-coding a CSS variable. Called on resize and
  // immediately after applyCharacterToHud so first paint is correct.
  const hotbarEl = document.querySelector(".plate-hotbar");
  function positionOutputMeter() {
    if (!outputBox || !hotbarEl) return;
    const r = hotbarEl.getBoundingClientRect();
    if (!r || !r.width) return;
    // 10 px gap so the meter visibly floats above the slots without
    // crowding them.
    const bottom = Math.max(8, window.innerHeight - r.top + 10);
    outputBox.style.bottom = bottom + "px";
    // Center the meter horizontally over the hotbar specifically.
    outputBox.style.left = (r.left + r.width / 2) + "px";
    outputBox.style.transform = "translateX(-50%)";
    outputBox.style.right = "auto";
  }
  window.addEventListener("resize", positionOutputMeter);

  // ---- chat collapse ----
  function setChatCollapsed(c) {
    state.chatCollapsed = c;
    chatPanel.classList.toggle("is-collapsed", c);
    chatBody.hidden = c;
    chatCollapseGlyph.textContent = c ? "▴" : "▾";
  }
  chatHead.addEventListener("click", (e) => {
    e.preventDefault();
    setChatCollapsed(!state.chatCollapsed);
  });

  // ---- modal system --------------------------------------------------
  // Only one modal open at a time. Veil is shared. Esc closes the top-most
  // modal first, falling through to the standard editor/chat handling.
  let activeModal = null;
  function openModal(name) {
    const m = modals[name];
    if (!m) return;
    if (activeModal && activeModal !== name) closeModal();
    m.hidden = false;
    modalVeil.hidden = false;
    activeModal = name;
    // Light up the matching codex button.
    codexButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.modal === name));
    // Per-modal hooks (refresh content on open).
    if (name === "map") renderMapModal();
    if (name === "character") drawHudPortrait();
    // Close chat focus so keyboard shortcuts (Esc, etc.) work.
    if (isTypingInChat()) chatInput.blur();
  }
  function closeModal() {
    if (!activeModal) return;
    const m = modals[activeModal];
    if (m) m.hidden = true;
    modalVeil.hidden = true;
    codexButtons.forEach((b) => b.classList.remove("is-active"));
    activeModal = null;
  }
  function toggleModal(name) {
    if (activeModal === name) closeModal();
    else openModal(name);
  }
  // Codex buttons → open / toggle modal of the same name.
  codexButtons.forEach((b) => {
    b.addEventListener("click", () => toggleModal(b.dataset.modal));
  });
  // Atlas expand button → open the full Atlas modal.
  if (atlasExpand) atlasExpand.addEventListener("click", () => openModal("map"));
  // Veil click + ✕ buttons close the active modal.
  modalVeil.addEventListener("click", closeModal);
  document.querySelectorAll("[data-modal-close]").forEach((b) => {
    b.addEventListener("click", closeModal);
  });
  // Settings → leave button (mirror of crown leave).
  if (setLeaveBtn) setLeaveBtn.addEventListener("click", () => { closeModal(); leave(); });

  // Settings → Camera vantage. "High" is the default wide-view (zoom ×2);
  // "Low" pulls the camera in closer (zoom ×3) which renders fewer tiles
  // per frame — kinder to slower devices, at the cost of render distance.
  // Persisted in localStorage so the player's preference survives logouts.
  const VANTAGE_ZOOM = { high: 2, low: 3 };
  function applyVantage(v) {
    const z = VANTAGE_ZOOM[v] || VANTAGE_ZOOM.high;
    state.playerZoom = z;
    // Don't yank the camera out from under the admin while they're in the
    // middle of editing — they'll get the new zoom the next time they exit.
    if (!state.editor.open) state.zoom = z;
  }
  function readVantagePref() {
    try { return localStorage.getItem("realm.vantage") === "low" ? "low" : "high"; }
    catch { return "high"; }
  }
  function writeVantagePref(v) {
    try { localStorage.setItem("realm.vantage", v); } catch {}
  }
  // Initialize from saved preference (also seeds state.playerZoom).
  {
    const v = readVantagePref();
    if (setVantageHigh) setVantageHigh.checked = (v === "high");
    if (setVantageLow)  setVantageLow.checked  = (v === "low");
    applyVantage(v);
  }
  if (setVantageHigh) setVantageHigh.addEventListener("change", () => {
    if (setVantageHigh.checked) { writeVantagePref("high"); applyVantage("high"); }
  });
  if (setVantageLow) setVantageLow.addEventListener("change", () => {
    if (setVantageLow.checked) { writeVantagePref("low"); applyVantage("low"); }
  });
  if (setVol) {
    setVol.addEventListener("input", () => {
      if (setVolNum) setVolNum.textContent = setVol.value;
    });
  }

  // ---- map modal renderer ---------------------------------------------
  // Same idea as renderMinimap but with a wider window (±200 tiles) and
  // per-tile zoom so the canvas stays full-resolution. Re-renders on open
  // and again whenever the player moves a tile while the modal is up.
  const MAP_HALF = 160;        // ±160 tiles each direction
  const MAP_SCALE = 2;         // 2px per world tile → 320×320 → fits 640×640
  function renderMapModal() {
    if (!modals.map || modals.map.hidden) return;
    const w = mapModalCanvas.width, h = mapModalCanvas.height;
    const cx = w / 2, cy = h / 2;
    const scale = MAP_SCALE;             // px per world tile
    mapModalCtx.fillStyle = "#0c0e14";
    mapModalCtx.fillRect(0, 0, w, h);
    const meRec = state.me ? state.renderPlayers.get(state.me.id) : null;
    const meX = meRec ? meRec.x : 0;
    const meY = meRec ? meRec.y : 0;

    // Painted ground
    if (state.world) {
      mapModalCtx.fillStyle = "rgba(105, 145, 90, 0.55)";
      let drawn = 0;
      const cap = 18000;
      outer: for (const layer of state.world.layers) {
        for (const k in layer.tiles) {
          const c = k.indexOf(",");
          const tx = +k.slice(0, c), ty = +k.slice(c + 1);
          const dx = tx - meX, dy = ty - meY;
          if (Math.abs(dx) > MAP_HALF || Math.abs(dy) > MAP_HALF) continue;
          mapModalCtx.fillRect(cx + dx * scale, cy + dy * scale, scale, scale);
          if (++drawn >= cap) break outer;
        }
      }
    }

    // Cardinal cross
    mapModalCtx.strokeStyle = "rgba(217,166,74,0.18)";
    mapModalCtx.lineWidth = 1;
    mapModalCtx.beginPath();
    mapModalCtx.moveTo(cx + 0.5, 0); mapModalCtx.lineTo(cx + 0.5, h);
    mapModalCtx.moveTo(0, cy + 0.5); mapModalCtx.lineTo(w, cy + 0.5);
    mapModalCtx.stroke();

    // Origin (0,0)
    const oxd = -meX, oyd = -meY;
    if (Math.abs(oxd) <= MAP_HALF && Math.abs(oyd) <= MAP_HALF) {
      const ox = cx + oxd * scale, oy = cy + oyd * scale;
      mapModalCtx.strokeStyle = "rgba(216,178,87,0.85)";
      mapModalCtx.lineWidth = 1;
      mapModalCtx.strokeRect(ox - 5, oy - 5, 10, 10);
    }

    // Other souls
    for (const rec of state.renderPlayers.values()) {
      if (state.me && rec.id === state.me.id) continue;
      const dx = rec.x - meX, dy = rec.y - meY;
      if (Math.abs(dx) > MAP_HALF || Math.abs(dy) > MAP_HALF) continue;
      mapModalCtx.fillStyle = rec.isAdmin ? "#f6e4a3" : (RACE_COLOR[rec.race] || "#cfe4ff");
      mapModalCtx.fillRect(cx + dx * scale - 1, cy + dy * scale - 1, scale + 2, scale + 2);
    }

    // Self pip with halo
    if (meRec) {
      const grd = mapModalCtx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      grd.addColorStop(0, "rgba(246,228,163,0.9)");
      grd.addColorStop(1, "rgba(246,228,163,0)");
      mapModalCtx.fillStyle = grd;
      mapModalCtx.fillRect(cx - 18, cy - 18, 36, 36);
      mapModalCtx.fillStyle = "#fff7d8";
      mapModalCtx.fillRect(cx - 3, cy - 3, 6, 6);
      mapModalCtx.strokeStyle = "rgba(20,16,8,0.9)";
      mapModalCtx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
    }

    // Footnotes
    if (mapPos) mapPos.textContent = state.me
      ? `(${Math.round(state.me.x)}, ${Math.round(state.me.y)})` : "(?, ?)";
    if (mapSouls) mapSouls.textContent = state.presence;
  }
  // Refresh while the modal is open so the player tracks movement.
  setInterval(() => { if (activeModal === "map") renderMapModal(); }, 250);

  // ---- in-realm shortcuts (M, C, I, K, J, H + Esc) ----------------------
  document.addEventListener("keydown", (e) => {
    if (realmEl.hidden) return;
    if (isTypingInChat()) return;          // typing → ignore shortcuts
    const key = (e.key || "").toLowerCase();

    if (e.key === "Escape") {
      if (activeModal) { closeModal(); e.preventDefault(); return; }
      // (editor close + chat blur are handled by the older Esc handler)
    }
    // M was the old "open Map" shortcut; the Atlas already has a dedicated
    // expand button so the keystroke is gone (it kept stealing the M key
    // from anyone trying to type a slash command beginning with M).
    const SHORT = { c: "character", i: "inventory",
                    k: "spellbook", j: "quests", h: "help" };
    if (SHORT[key]) {
      e.preventDefault();
      toggleModal(SHORT[key]);
    }
  });

  // ---- enter / leave ----
  async function enter({ role, character }) {
    state.role = role || "player";
    setBadge(state.role);
    realmEl.hidden = false;
    resize();
    refreshOutput();
    setChatCollapsed(state.chatCollapsed);
    // Kick off sprite loading in parallel with the character fetch so first
    // paint already has the admin's art ready when the welcome arrives.
    const spritesPromise = loadAdminSprites();
    if (character) applyCharacterToHud(character);
    else {
      try {
        const r = await api("/api/characters/me");
        if (r && r.character) applyCharacterToHud(r.character);
      } catch (err) { /* HUD will stay at "—" until next attempt */ }
    }
    // Mark the body so admin-only HUD bits (chat-hint, command catalog,
    // editor toggles) are revealed via CSS for Architects only.
    document.body.classList.toggle("is-architect", state.role === "admin");
    if (!state.booted) {
      state.booted = true;
      // Player welcome is intentionally silent — the design doc calls
      // for an unscripted entry into the realm.  Architects still get
      // their command-cheat reminder so they can find world-edit fast.
      if (state.role === "admin") {
        chat("Architect: type /command we, /command world_edit, or /command server_edit to weave the world.", "cmd");
      }
    }
    // Always refetch the world on enter — the JSON on disk may have been
    // edited by another tab (or this same admin in a previous session)
    // since we last loaded. The loading veil hides the canvas so the player
    // never sees a half-rendered world.
    showLoadingVeil("Weaving the realm…");
    try { await loadWorld(); }
    catch (err) { chat("Failed to load world: " + err.message, "err"); }
    hideLoadingVeil();
    await spritesPromise.catch(() => {});
    connectSocket();
    if (!raf) raf = requestAnimationFrame(tick);
    // Position once on enter, and again on the next frame so the layout
    // is settled before we measure.
    positionOutputMeter();
    requestAnimationFrame(positionOutputMeter);
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

  // ─────────────────────────────────────────────────────────────────
  // Tiny in-chat toast — used for soft hints like "slot 3 is empty".
  // We piggyback on the chat log so it doesn't compete for attention
  // with the canvas; the message is styled like a system note.
  // ─────────────────────────────────────────────────────────────────
  function toast(msg) { try { chat(msg, "cmd"); } catch {} }

  // ─────────────────────────────────────────────────────────────────
  // Spell Wheel — populate the 15 deeper-shelf slots once on boot,
  // then show/hide on F-hold or wheel-button click.  Slots are blank
  // until bound via the Spellbook; clicking a bound slot equips that
  // spell (which closes the wheel automatically).
  // ─────────────────────────────────────────────────────────────────
  const wheelEl   = document.getElementById("spell-wheel");
  const wheelRing = document.getElementById("sw-ring");
  const wheelBtn  = document.getElementById("hb-wheel-btn");
  function buildSpellWheel() {
    if (!wheelRing) return;
    // Clear any old slots (keeps the .sw-hub child intact).
    [...wheelRing.querySelectorAll(".sw-slot")].forEach((n) => n.remove());
    const N = 15;
    const radius = 180;          // px from ring center
    for (let i = 0; i < N; i++) {
      // Distribute slots starting at the top (-90°) clockwise.
      const ang = -Math.PI / 2 + (i / N) * Math.PI * 2;
      const x = 50 + (Math.cos(ang) * radius / 460) * 100;
      const y = 50 + (Math.sin(ang) * radius / 460) * 100;
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "sw-slot is-locked";
      slot.dataset.wheelIndex = String(i);
      slot.style.left = `${x}%`;
      slot.style.top  = `${y}%`;
      slot.innerHTML = `
        <span class="sw-num">${7 + i}</span>
        <span class="sw-icon">⛧</span>
        <span class="sw-name">Empty</span>
      `;
      slot.addEventListener("click", () => {
        toast(`Wheel slot ${7 + i} is empty — open the Spellbook to bind a spell here.`);
      });
      wheelRing.appendChild(slot);
    }
  }
  let wheelOpen = false;
  function showSpellWheel(on) {
    if (!wheelEl) return;
    wheelOpen = !!on;
    wheelEl.hidden = !wheelOpen;
    wheelEl.setAttribute("aria-hidden", String(!wheelOpen));
    if (wheelBtn) wheelBtn.classList.toggle("is-open", wheelOpen);
  }
  if (wheelBtn) {
    wheelBtn.addEventListener("click", () => showSpellWheel(!wheelOpen));
  }
  // Click on the dim veil (outside any slot) closes the wheel cleanly.
  if (wheelEl) {
    wheelEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("sw-veil")) showSpellWheel(false);
    });
  }
  buildSpellWheel();

  // ─────────────────────────────────────────────────────────────────
  // Fellowship dropdown — guild & party menu hanging off the codex
  // rail.  We just toggle visibility and route each item to a chat-
  // hint placeholder until the underlying systems are wired.
  // ─────────────────────────────────────────────────────────────────
  const fellowBtn  = document.getElementById("fellow-btn");
  const fellowMenu = document.getElementById("fellow-menu");
  function setFellowOpen(open) {
    if (!fellowMenu || !fellowBtn) return;
    fellowMenu.hidden = !open;
    fellowBtn.setAttribute("aria-expanded", String(!!open));
  }
  if (fellowBtn && fellowMenu) {
    fellowBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setFellowOpen(fellowMenu.hidden);
    });
    // Click anywhere else (or press Escape) closes the dropdown.
    document.addEventListener("click", (e) => {
      if (!fellowMenu.hidden && !fellowMenu.contains(e.target) && e.target !== fellowBtn) {
        setFellowOpen(false);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !fellowMenu.hidden) setFellowOpen(false);
    });
    fellowMenu.querySelectorAll(".cdm-item").forEach((item) => {
      item.addEventListener("click", () => {
        const k = item.dataset.fellow;
        const M = {
          "guild-roster": "Guild roster — no guild affiliated yet. Found one to begin.",
          "guild-create": "Found a Guild — the founding ritual is not yet scribed.",
          "guild-leave":  "Leave Guild — you belong to none.",
          "party-list":   "Party — you walk alone in this shard.",
          "party-invite": "Invite to Party — point at a soul and try /party invite <name>.",
          "party-leave":  "Leave Party — there's no party to leave.",
        };
        toast(M[k] || "Fellowship action not yet woven.");
        setFellowOpen(false);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // HUD plate — slide it horizontally so it sits in the empty middle
  // between the chat panel (lower-left) and the codex rail (right).
  // Recomputed on resize and after the chat panel collapses/expands.
  // ─────────────────────────────────────────────────────────────────
  const hudPlateEl = document.querySelector(".hud-plate");
  function repositionHudPlate() {
    if (!hudPlateEl || hudPlateEl.offsetParent === null) return;
    const realmRect = realmEl.getBoundingClientRect();
    const chatPanel = document.getElementById("realm-chat");
    const codexRail = document.querySelector(".hud-codex");
    const chatRight = chatPanel ? chatPanel.getBoundingClientRect().right : realmRect.left + 12;
    const codexLeft = codexRail ? codexRail.getBoundingClientRect().left  : realmRect.right - 12;
    // Center of the gap between the two rails.
    const gapCenter = (chatRight + codexLeft) / 2;
    // Express as a percentage of the realm so CSS keeps using
    // translateX(-50%) and we only need to nudge `left`.
    const pct = ((gapCenter - realmRect.left) / Math.max(1, realmRect.width)) * 100;
    // Clamp so the plate never gets pushed off-screen on tiny widths.
    const clamped = Math.max(20, Math.min(80, pct));
    hudPlateEl.style.left = `${clamped}%`;
  }
  window.addEventListener("resize", repositionHudPlate);
  window.addEventListener("freeform:enter-realm", () => {
    requestAnimationFrame(repositionHudPlate);
  });
  // The chat panel collapses without firing a resize; observe the panel
  // so the plate slides whenever the chat width actually changes.
  if (typeof ResizeObserver !== "undefined") {
    const chatPanel = document.getElementById("realm-chat");
    const codexRail = document.querySelector(".hud-codex");
    const ro = new ResizeObserver(() => repositionHudPlate());
    if (chatPanel) ro.observe(chatPanel);
    if (codexRail) ro.observe(codexRail);
  }
  // Initial equip highlight — no slot pre-selected (no basic attack exists).
  paintEquipHighlight();

  // Best-effort goodbye when the tab closes — saves us a "ghost" player
  // hanging around until the server's tick notices the dead socket.
  window.addEventListener("beforeunload", () => {
    if (state.ws) try { state.ws.close(1000, "unload"); } catch {}
  });

  window.FreeformRealm = { enter, leave };

  // ---- DEV: ?hud-demo=1 — mount the HUD with a fake vessel so we can
  // sanity-check the layout without going through login. Safe to leave in
  // (only fires when the query string explicitly opts in). ------------
  if (typeof location !== "undefined" && /[?&]hud-demo=1\b/.test(location.search)) {
    window.addEventListener("DOMContentLoaded", () => {
      enter({
        role: "admin",
        character: {
          name: "Aerynd of Firstlight",
          race: null, race_name: "Architect",
          level: 7, xp: 1340,
          hp: 168, max_hp: 200,
          mana_cap: 220, stamina_cap: 140,
          control: 18, resistance: 12,
          cast_speed: 1.25, efficiency: 1.10,
          char_class: "Architect",
        },
      }).catch(() => {});
    });
  }
})();
