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
    setTab("login"); setScreen("auth");
  });

  // ---- character flow ----
  let currentRole = "player";

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

  $("#slay-btn").addEventListener("click", async () => {
    const charMsg = $('[data-role="char-msg"]', charCard);
    if (!confirm("Truly slay this vessel? This cannot be undone.")) return;
    charMsg.textContent = "";
    const { ok, body } = await api("/api/characters/me/die", { method: "POST" });
    if (!ok) { charMsg.textContent = body.error || "Failed to slay."; charMsg.classList.remove("is-good"); return; }
    setScreen("forge");
  });

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
    $("#stat-weapon").textContent  = c.starting_weapon || "—";

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
