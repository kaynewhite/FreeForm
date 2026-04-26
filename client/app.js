(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const authCard = $("#auth-card");
  const homeCard = $("#home-card");

  const loginForm = $("#login-form");
  const registerForm = $("#register-form");

  const tabs = $$(".tab", authCard);

  function setTab(name) {
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
    });
    loginForm.classList.toggle("is-active", name === "login");
    registerForm.classList.toggle("is-active", name === "register");
    clearMsg(loginForm);
    clearMsg(registerForm);
  }
  tabs.forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  function setMsg(form, text, good = false) {
    const el = $('[data-role="msg"]', form);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-good", !!good);
  }
  function clearMsg(form) { setMsg(form, ""); }

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

  function showAuth() {
    authCard.hidden = false;
    homeCard.hidden = true;
  }
  function showHome(user) {
    authCard.hidden = true;
    homeCard.hidden = false;
    $("#home-greeting").textContent = "Welcome, traveler.";
    $("#me-email").textContent = user.email;
    $("#me-joined").textContent = user.created_at
      ? new Date(user.created_at).toLocaleString()
      : "—";

    const badge = $("#role-badge");
    const role = (user.role || "player").toLowerCase();
    badge.classList.remove("is-admin", "is-operator");
    if (role === "admin") {
      badge.textContent = "Admin";
      badge.classList.add("is-admin");
      badge.hidden = false;
    } else if (role === "operator") {
      badge.textContent = "Operator";
      badge.classList.add("is-operator");
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button.primary", loginForm);
    btn.disabled = true;
    clearMsg(loginForm);
    const data = Object.fromEntries(new FormData(loginForm).entries());
    const { ok, body } = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
    btn.disabled = false;
    if (!ok) { setMsg(loginForm, body.error || "Login failed."); return; }
    showHome(body.user);
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button.primary", registerForm);
    btn.disabled = true;
    clearMsg(registerForm);
    const data = Object.fromEntries(new FormData(registerForm).entries());
    const { ok, body } = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
    btn.disabled = false;
    if (!ok) { setMsg(registerForm, body.error || "Registration failed."); return; }
    showHome(body.user);
  });

  $("#logout-btn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    showAuth();
    loginForm.reset();
    registerForm.reset();
    setTab("login");
  });

  (async function init() {
    const { ok, body } = await api("/api/auth/me");
    if (ok && body.user) showHome(body.user);
    else showAuth();
  })();
})();
