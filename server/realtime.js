/* ---- realtime / multiplayer ----
   20 Hz authoritative tick loop on top of `ws`. Players connect to
   /ws/realm with their existing express-session cookie, the server picks
   up the session, loads their living character, and adds them to a shard.

   Each tick:
     1. Apply each player's pending input (intended dx/dy + sprint)
     2. Integrate position (capped speed)
     3. Build per-shard snapshots and broadcast deltas

   Position is loaded from `characters.pos_x/pos_y/shard/facing` on
   connect, kept in memory while the player is online, and persisted on
   disconnect (and at a slow heartbeat in case the server crashes). */
const { WebSocketServer } = require("ws");
const cookie = require("cookie");
const signature = require("cookie-signature");
const { query } = require("./db");

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const SAVE_EVERY_MS = 15_000;
const MAX_SPEED_TPS = 4.5;     // tiles per second (walk)
const SPRINT_MULT  = 1.8;
const WORLD_BOUND  = 1_048_576; // ±2^20, matches server/world.js cap
const COOKIE_NAME  = "fm.sid";
const VALID_FACINGS = new Set(["up", "down", "left", "right"]);

function parseSessionId(req, secret) {
  const header = req.headers.cookie;
  if (!header) return null;
  const jar = cookie.parse(header);
  const raw = jar[COOKIE_NAME];
  if (!raw) return null;
  if (raw.startsWith("s:")) {
    const unsigned = signature.unsign(raw.slice(2), secret);
    return unsigned || null;
  }
  return raw;
}

// Pull the session record out of Postgres directly. We re-read on every
// upgrade so a logged-out cookie can't keep a socket alive.
async function loadSession(sid) {
  const r = await query(
    `SELECT sess FROM session WHERE sid = $1 AND expire > NOW() LIMIT 1`,
    [sid]
  );
  if (!r.rows.length) return null;
  const sess = r.rows[0].sess;
  return typeof sess === "string" ? JSON.parse(sess) : sess;
}

async function loadLivingCharacter(userId) {
  const r = await query(
    `SELECT id, account_id, name, race, gender, level, mana_cap, max_hp, hp,
            pos_x, pos_y, shard, facing
       FROM characters
      WHERE account_id = $1 AND died_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function savePosition(charId, x, y, facing) {
  await query(
    `UPDATE characters SET pos_x = $1, pos_y = $2, facing = $3 WHERE id = $4`,
    [x, y, facing, charId]
  );
}

class Shard {
  constructor(name) {
    this.name = name;
    this.players = new Map(); // playerId -> Player
  }
  add(p) { this.players.set(p.id, p); }
  remove(id) { this.players.delete(id); }
  snapshot() {
    const out = [];
    for (const p of this.players.values()) {
      out.push({
        id: p.id,
        name: p.name,
        x: round2(p.x),
        y: round2(p.y),
        facing: p.facing,
        anim: p.anim,
        isAdmin: p.isAdmin,
        race: p.race,
      });
    }
    return out;
  }
  broadcast(payload, exceptId = null) {
    const msg = JSON.stringify(payload);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }
}

class Player {
  constructor({ ws, userId, character, isAdmin }) {
    this.ws = ws;
    this.userId = userId;
    this.charId = character.id;
    this.id = `c${character.id}`;
    this.name = character.name;
    this.race = character.race; // null for admin
    this.isAdmin = !!isAdmin;
    this.x = clampPos(Number(character.pos_x) || 0);
    this.y = clampPos(Number(character.pos_y) || 0);
    this.facing = VALID_FACINGS.has(character.facing) ? character.facing : "down";
    this.anim = "idle";
    this.shard = character.shard || "default";
    this.input = { dx: 0, dy: 0, sprint: false };
    this.lastSeen = Date.now();
    this.lastSavedAt = Date.now();
  }
}

function round2(n) { return Math.round(n * 100) / 100; }
function clampPos(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, v));
}

function init(server, sessionSecret) {
  const wss = new WebSocketServer({ noServer: true });
  const shards = new Map();
  function getShard(name) {
    let s = shards.get(name);
    if (!s) { s = new Shard(name); shards.set(name, s); }
    return s;
  }

  // -- upgrade: parse session cookie, accept only authenticated users --
  server.on("upgrade", async (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws/realm")) return; // leave for other handlers
    try {
      const sid = parseSessionId(req, sessionSecret);
      if (!sid) return reject(socket, 401);
      const sess = await loadSession(sid);
      if (!sess?.userId) return reject(socket, 401);
      const char = await loadLivingCharacter(sess.userId);
      if (!char) return reject(socket, 409, "No living vessel");

      wss.handleUpgrade(req, socket, head, (ws) => {
        const player = new Player({
          ws,
          userId: sess.userId,
          character: char,
          isAdmin: sess.role === "admin",
        });
        attachPlayer(player);
      });
    } catch (err) {
      console.error("[realtime] upgrade failed", err);
      reject(socket, 500);
    }
  });

  function reject(socket, code, msg = "") {
    const text = `HTTP/1.1 ${code} ${msg || "Unauthorized"}\r\nContent-Length: 0\r\n\r\n`;
    try { socket.write(text); } catch {}
    socket.destroy();
  }

  function attachPlayer(player) {
    const shard = getShard(player.shard);
    // Boot any prior connection for the same character (multi-tab, refresh)
    const prior = shard.players.get(player.id);
    if (prior && prior.ws !== player.ws) {
      try { prior.ws.send(JSON.stringify({ type: "goodbye", reason: "replaced" })); } catch {}
      try { prior.ws.close(4000, "replaced"); } catch {}
      shard.remove(player.id);
    }
    shard.add(player);

    player.ws.send(JSON.stringify({
      type: "welcome",
      tickHz: TICK_HZ,
      shard: shard.name,
      you: {
        id: player.id, name: player.name, x: player.x, y: player.y,
        facing: player.facing, isAdmin: player.isAdmin, race: player.race,
      },
      others: shard.snapshot().filter((p) => p.id !== player.id),
    }));
    shard.broadcast({
      type: "join",
      player: {
        id: player.id, name: player.name, x: player.x, y: player.y,
        facing: player.facing, isAdmin: player.isAdmin, race: player.race,
      },
    }, player.id);
    chatBroadcast(shard, { type: "chat", kind: "system", text: `${player.name} steps into the realm.` });

    player.ws.on("message", (raw) => handleMessage(player, raw));
    player.ws.on("close", () => detachPlayer(player));
    player.ws.on("error", () => detachPlayer(player));
  }

  async function detachPlayer(player) {
    const shard = shards.get(player.shard);
    if (!shard) return;
    if (shard.players.get(player.id) !== player) return; // already replaced
    shard.remove(player.id);
    shard.broadcast({ type: "leave", id: player.id });
    chatBroadcast(shard, { type: "chat", kind: "system", text: `${player.name} fades from the realm.` });
    try { await savePosition(player.charId, player.x, player.y, player.facing); }
    catch (err) { console.error("[realtime] save on disconnect failed", err); }
  }

  function handleMessage(player, raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    player.lastSeen = Date.now();
    switch (msg.type) {
      case "input": {
        const dx = clampUnit(msg.dx);
        const dy = clampUnit(msg.dy);
        player.input.dx = dx;
        player.input.dy = dy;
        player.input.sprint = !!msg.sprint;
        if (typeof msg.facing === "string" && VALID_FACINGS.has(msg.facing)) {
          player.facing = msg.facing;
        } else if (dx || dy) {
          // Auto-derive facing from movement direction.
          if (Math.abs(dx) > Math.abs(dy)) player.facing = dx < 0 ? "left" : "right";
          else                              player.facing = dy < 0 ? "up"   : "down";
        }
        break;
      }
      case "chat": {
        const text = String(msg.text || "").trim().slice(0, 200);
        if (!text) return;
        const shard = shards.get(player.shard);
        if (!shard) return;
        chatBroadcast(shard, {
          type: "chat",
          kind: "say",
          from: { id: player.id, name: player.name, isAdmin: player.isAdmin },
          text,
        });
        break;
      }
      case "ping":
        try { player.ws.send(JSON.stringify({ type: "pong", t: msg.t })); } catch {}
        break;
    }
  }

  function chatBroadcast(shard, payload) {
    shard.broadcast(payload);
  }
  function clampUnit(n) {
    if (!Number.isFinite(n)) return 0;
    if (n >  1) return  1;
    if (n < -1) return -1;
    return n;
  }

  // -- 20Hz authoritative tick --
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    for (const shard of shards.values()) {
      // 1. integrate movement
      for (const p of shard.players.values()) {
        const { dx, dy, sprint } = p.input;
        const moving = dx !== 0 || dy !== 0;
        if (moving) {
          // normalize so diagonals don't sprint
          const len = Math.hypot(dx, dy) || 1;
          const speed = MAX_SPEED_TPS * (sprint ? SPRINT_MULT : 1);
          p.x = clampPos(p.x + (dx / len) * speed * dt);
          p.y = clampPos(p.y + (dy / len) * speed * dt);
          p.anim = sprint ? "sprint" : "walk";
        } else {
          p.anim = "idle";
        }
      }
      // 2. broadcast snapshot
      const snap = shard.snapshot();
      shard.broadcast({ type: "state", t: now, players: snap });
      // 3. lazy save (every 15s per player)
      for (const p of shard.players.values()) {
        if (now - p.lastSavedAt > SAVE_EVERY_MS) {
          p.lastSavedAt = now;
          savePosition(p.charId, p.x, p.y, p.facing).catch((err) => {
            console.error("[realtime] periodic save failed", err);
          });
        }
      }
    }
  }, TICK_MS);

  return { wss, shards };
}

module.exports = { init };
