 (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const authCard = $("#auth-card");
  const forgeCard = $("#forge-card");
  const charCard = $("#character-card");
  const accountStrip = $("#account-strip");

  const loginForm = $("#login-form");
  const registerForm = $("#register-form");
  const forgeForm = $("#forge-form");

  const tabs = $$(".tab", authCard);

  // ---- API helper ----
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, body: body || {} };
  }

  // ---- screen routing ----
  function setScreen(name) {
    authCard.hidden = name !== "auth";
    forgeCard.hidden = name !== "forge";
    charCard.hidden = name !== "character";
    accountStrip.hidden = name === "auth";
  }

  function showAccount(user) {
    $("#account-email").textContent = user.email;
    const badge = $("#role-badge");
    const role = (user.role || "player").toLowerCase();
    badge.classList.remove("is-admin", "is-operator");
    if (role === "admin") {
      badge.textContent = "Admin"; badge.classList.add("is-admin"); badge.hidden = false;
    } else if (role === "operator") {
      badge.textContent = "Operator"; badge.classList.add("is-operator"); badge.hidden = false;
    } else {
      badge.hidden = true;
    }
    $("#sandbox-link").hidden = role !== "admin";
    $("#maps-link").hidden = role !== "admin";
    // Surface the slash-command hint on the character sheet so admins know
    // the /command we toggle exists once they step into the realm.
    const adminNote = $("#dev-note-admin");
    const playerNote = $("#dev-note-player");
    if (adminNote && playerNote) {
      adminNote.hidden = role !== "admin";
      playerNote.hidden = role === "admin";
    }
    // Server 0 is admin-only today. Disable the Enter button for non-admins
    // and explain why in the player note. Admins always see the live button.
    const enterBtn = $("#enter-btn");
    if (enterBtn) {
      const allowed = role === "admin";
      enterBtn.disabled = !allowed;
      enterBtn.title = allowed
        ? "Step into the live realm."
        : "No published server yet — only the Architect may walk Server 0.";
      enterBtn.classList.toggle("is-disabled", !allowed);
      const playerNoteEl = $("#dev-note-player");
      if (playerNoteEl && !allowed) {
        playerNoteEl.textContent =
          "Servers not yet published. The Architect is still weaving Server 0 — your vessel waits for a player shard to open.";
      }
    }
  }

  // ---- auth tabs / forms ----
  function setTab(name) {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
    });
    loginForm.classList.toggle("is-active", name === "login");
    registerForm.classList.toggle("is-active", name === "register");
    setMsg(loginForm, ""); setMsg(registerForm, "");
  }
  tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  function setMsg(form, text, good = false) {
    const el = $('[data-role="msg"]', form);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-good", !!good);
  }

  async function submitAuth(form, url) {
    const btn = $("button.primary", form);
    btn.disabled = true; setMsg(form, "");
    const data = Object.fromEntries(new FormData(form).entries());
    const { ok, body } = await api(url, { method: "POST", body: JSON.stringify(data) });
    btn.disabled = false;
    if (!ok) { setMsg(form, body.error || "Request failed."); return null; }
    return body.user;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = await submitAuth(loginForm, "/api/auth/login");
    if (user) await afterAuth(user);
  });
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = await submitAuth(registerForm, "/api/auth/register");
    if (user) await afterAuth(user);
  });

  $("#logout-btn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    loginForm.reset(); registerForm.reset(); forgeForm.reset();
    stopPortrait();
    slicesCache = null;
    setTab("login"); setScreen("auth");
  });

  // ---- character flow ----
  let currentRole = "player";
  let lastCharacter = null;

  function configureForge(role) {
    const isAdmin = role === "admin";
    const genderPick = $("#gender-pick");
    const genderInputs = $$('input[name="gender"]', genderPick);
    // Admins skip race + gender (design doc §3.8). Toggle the relevant bits.
    genderPick.hidden = isAdmin;
    genderInputs.forEach((i) => { i.required = !isAdmin; if (isAdmin) i.checked = false; });
    $("#forge-rules-player").hidden = isAdmin;
    $("#forge-rules-admin").hidden = !isAdmin;
    $("#forge-title").textContent = isAdmin ? "Bind the Architect" : "Forge a Vessel";
    $("#forge-flavor").textContent = isAdmin
      ? "Name yourself, Architect. The realm bends around you."
      : "Choose your name and form. The fates will choose your blood.";
    $("#forge-submit-text").textContent = isAdmin
      ? "Bind My Name"
      : "Forge — Let the Fates Decide";
  }

  async function afterAuth(user) {
    currentRole = (user.role || "player").toLowerCase();
    showAccount(user);
    configureForge(currentRole);
    const r = await api("/api/characters/me");
    if (r.body.character) showCharacter(r.body.character);
    else setScreen("forge");
  }

  forgeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button.primary", forgeForm);
    btn.disabled = true; setMsg(forgeForm, "");
    const data = Object.fromEntries(new FormData(forgeForm).entries());
    if (currentRole === "admin") delete data.gender;
    const { ok, body } = await api("/api/characters", {
      method: "POST",
      body: JSON.stringify(data),
    });
    btn.disabled = false;
    if (!ok) { setMsg(forgeForm, body.error || "Forging failed."); return; }
    forgeForm.reset();
    revealCharacter(body.character);
  });

  // ---- enter the realm ----
  // The realm view lives in #realm and is owned by client/realm.js. We just
  // hand it the current user (so it knows whether to allow the slash-command
  // editor) and unhide it; the main shell stays in the DOM behind it so a
  // "Leave the realm" pop returns to the character sheet untouched. We also
  // pass the character row so the in-game HUD has stats on first paint
  // without needing a second round-trip.
  //
  // Server 0 is the Architect's canvas — only admins may enter today. A
  // player-facing shard arrives once /command create_server +
  // /command world_publish ship; until then the button is disabled with a
  // gentle note in its place.
  $("#enter-btn").addEventListener("click", async () => {
    if (currentRole !== "admin") return;
    let ch = lastCharacter;
    if (!ch) {
      try { const r = await api("/api/characters/me"); ch = r.body.character; }
      catch { /* realm.js will fetch it itself if we don't have it */ }
    }
    if (window.FreeformRealm) window.FreeformRealm.enter({ role: currentRole, character: ch });
  });
  window.addEventListener("freeform:leave-realm", () => {
    // Realm asked to leave — nothing to do, the realm view hid itself and
    // the character card was never unmounted.
  });

  $("#slay-btn").addEventListener("click", async () => {
    const charMsg = $('[data-role="char-msg"]', charCard);
    if (!confirm("Truly slay this vessel? This cannot be undone.")) return;
    charMsg.textContent = "";
    const { ok, body } = await api("/api/characters/me/die", { method: "POST" });
    if (!ok) { charMsg.textContent = body.error || "Failed to slay."; charMsg.classList.remove("is-good"); return; }
    setScreen("forge");
  });

  // ---- portrait animator ----
  // Pulls per-sheet slice metadata (frames, frameRects, fps, scale) from
  // /api/sprites/slices and animates a single sheet onto a canvas. This is
  // the same data the /sprites.html editor saves, so any tweak there
  // immediately changes how the character looks here.
  const portraitFrame = $("#portrait-frame");
  const portraitCanvas = $("#portrait-canvas");
  const portraitEmpty = $("#portrait-empty");
  const portrait = {
    raf: 0,
    img: null,
    slice: null,
    frameIndex: 0,
    acc: 0,
    last: 0,
  };
  let slicesCache = null;
  async function getSlices() {
    if (slicesCache) return slicesCache;
    const r = await api("/api/sprites/slices");
    slicesCache = r.body || {};
    return slicesCache;
  }
  function stopPortrait() {
    if (portrait.raf) cancelAnimationFrame(portrait.raf);
    portrait.raf = 0;
    portrait.img = null;
    portrait.slice = null;
  }
  function showPortraitEmpty(message) {
    stopPortrait();
    portraitCanvas.hidden = true;
    portraitCanvas.width = 1;
    portraitCanvas.height = 1;
    portraitEmpty.hidden = false;
    if (message) portraitEmpty.textContent = message;
  }
  function inferSlice(img) {
    // No saved slice yet — assume a single horizontal strip at full height.
    return {
      frames: 1, frameW: img.naturalWidth, frameH: img.naturalHeight,
      offsetX: 0, offsetY: 0, gapX: 0,
      perFrame: false, frameRects: null,
      fps: 8, scale: 3,
    };
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + url));
      img.src = url;
    });
  }
  async function startPortrait(url) {
    stopPortrait();
    portraitEmpty.hidden = true;
    portraitCanvas.hidden = false;
    let img;
    try { img = await loadImage(url); }
    catch { showPortraitEmpty("This vessel's likeness has not yet been woven."); return; }
    const slices = await getSlices();
    const raw = slices[url];
    const slice = raw ? {
      frames: raw.frames || 1,
      frameW: raw.frameW || img.naturalWidth,
      frameH: raw.frameH || img.naturalHeight,
      offsetX: raw.offsetX || 0,
      offsetY: raw.offsetY || 0,
      gapX: raw.gapX || 0,
      perFrame: !!raw.perFrame,
      frameRects: Array.isArray(raw.frameRects) ? raw.frameRects : null,
      fps: Math.max(1, Math.min(60, raw.fps || 8)),
      scale: Math.max(1, Math.min(8, raw.scale || 3)),
    } : inferSlice(img);
    // Pick the largest frame width/height so each frame fits without clipping
    // (per-frame rects can vary).
    let maxW = slice.frameW, maxH = slice.frameH;
    if (slice.perFrame && slice.frameRects) {
      for (const r of slice.frameRects) {
        if (r.w > maxW) maxW = r.w;
        if (r.h > maxH) maxH = r.h;
      }
    }
    portraitCanvas.width = maxW;
    portraitCanvas.height = maxH;
    portraitCanvas.style.width = (maxW * slice.scale) + "px";
    portraitCanvas.style.height = (maxH * slice.scale) + "px";
    const ctx = portraitCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    portrait.img = img;
    portrait.slice = slice;
    portrait.frameIndex = 0;
    portrait.acc = 0;
    portrait.last = performance.now();
    const tick = (now) => {
      const dt = (now - portrait.last) / 1000;
      portrait.last = now;
      const s = portrait.slice;
      portrait.acc += dt;
      const interval = 1 / s.fps;
      while (portrait.acc >= interval) {
        portrait.acc -= interval;
        portrait.frameIndex += 1;
      }
      const idx = portrait.frameIndex % Math.max(1, s.frames);
      let sx, sy, sw, sh;
      if (s.perFrame && s.frameRects && s.frameRects[idx]) {
        ({ x: sx, y: sy, w: sw, h: sh } = s.frameRects[idx]);
      } else {
        sx = s.offsetX + idx * (s.frameW + s.gapX);
        sy = s.offsetY;
        sw = s.frameW;
        sh = s.frameH;
      }
      ctx.clearRect(0, 0, portraitCanvas.width, portraitCanvas.height);
      // Center the (possibly smaller) frame inside the canvas so frames of
      // different sizes don't jitter from the corner.
      const dx = Math.floor((portraitCanvas.width - sw) / 2);
      const dy = Math.floor((portraitCanvas.height - sh) / 2);
      ctx.drawImage(portrait.img, sx, sy, sw, sh, dx, dy, sw, sh);
      portrait.raf = requestAnimationFrame(tick);
    };
    portrait.raf = requestAnimationFrame(tick);
  }
  function portraitUrlFor(c) {
    // Only the admin has art so far. Players will hook in once the per-race
    // sheets are uploaded.
    if (c.is_admin) return "/assets/sprites/admin/base/idle-spritesheets/no-weapon/admin-idleDown-spritesheet.png";
    return null;
  }

  // ---- character display ----
  const RACE_THEME = {
    human:       { color: "#f4d499", glow: "rgba(244,212,153,0.45)" },
    orc:         { color: "#7fe39a", glow: "rgba(127,227,154,0.45)" },
    elf:         { color: "#b9e6e6", glow: "rgba(185,230,230,0.50)" },
    crystalline: { color: "#cfe4ff", glow: "rgba(207,228,255,0.55)" },
    voidborn:    { color: "#caa6ff", glow: "rgba(176,112,255,0.55)" },
  };
  const ADMIN_THEME = { color: "#f6e4a3", glow: "rgba(246,228,163,0.60)" };

  function showCharacter(c) {
    lastCharacter = c;
    const isAdmin = !!c.is_admin;
    const theme = isAdmin ? ADMIN_THEME : (RACE_THEME[c.race] || RACE_THEME.human);
    charCard.style.setProperty("--race-color", theme.color);
    charCard.style.setProperty("--race-glow", theme.glow);
    charCard.classList.toggle("is-admin", isAdmin);

    $("#char-name").textContent = c.name;

    const badge = $("#char-race-badge");
    badge.textContent = c.race_name || c.race || "—";
    badge.classList.toggle("is-admin", isAdmin);

    // Admins have no gender. Hide the "<gender> · " bit entirely.
    $("#char-gender").textContent = c.gender ? capitalize(c.gender) : "";
    $("#char-sub-sep").hidden = !c.gender;
    $("#char-forged").textContent = c.created_at
      ? new Date(c.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : "—";

    $("#char-passive").textContent = c.racial_passive || "";

    $("#stat-hp").textContent      = `${c.hp} / ${c.max_hp}`;
    $("#stat-mana").textContent    = String(c.mana_cap);
    $("#stat-level").textContent   = String(c.level);
    $("#stat-xp").textContent      = String(c.xp);
    $("#stat-control").textContent = String(c.control);
    $("#stat-stamina").textContent = String(c.stamina_cap);
    $("#stat-cast").textContent    = String(c.cast_speed);
    $("#stat-eff").textContent     = `${c.efficiency}%`;
    $("#stat-res").textContent     = String(c.resistance);
    $("#stat-class").textContent   = c.char_class || (c.race == null ? "Architect" : "—");

    const url = portraitUrlFor(c);
    if (url) startPortrait(url);
    else showPortraitEmpty();

    setScreen("character");
  }

  function revealCharacter(c) {
    showCharacter(c);
    charCard.classList.remove("just-forged");
    // restart the animation
    void charCard.offsetWidth;
    charCard.classList.add("just-forged");
  }

  function capitalize(s) {
    if (!s) return "";
    return s[0].toUpperCase() + s.slice(1);
  }

  // ---- init ----
  (async function init() {
    const me = await api("/api/auth/me");
    if (!me.body.user) { setScreen("auth"); return; }
    await afterAuth(me.body.user);
  })();
})();
