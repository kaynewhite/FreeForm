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

// ---- combat / vitals tuning -----------------------------------------
// All "per second" values; tick loop scales by dt.
const STAMINA_DRAIN_PER_SEC = 15;     // sprint cost while actually moving
const STAMINA_REGEN_PER_SEC = 8;      // regen while not sprinting
const MANA_REGEN_PER_SEC    = 4;      // base, scaled by efficiency
const HP_REGEN_PER_SEC      = 3;      // base, gated by out-of-combat window
const COMBAT_LOCKOUT_MS     = 5000;   // no HP regen until N ms after last hit
const ATTACK_GLOBAL_CD_MS   = 250;    // floor for any swing (anti-spam)
const FACING_VEC = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};
// Per-weapon: base damage, reach (tiles forward), arc (tiles half-width
// perpendicular to facing), cooldown ms, stamina cost. The Architect's
// "Free Hand" is a fast unarmed jab; Katana hits hardest but slowest.
const WEAPON = {
  "Free Hand":  { dmg:  6, reach: 1.1, arc: 0.7, cd: 450, st:  6 },
  "Dagger":     { dmg:  9, reach: 1.2, arc: 0.7, cd: 480, st:  7 },
  "Club":       { dmg: 13, reach: 1.4, arc: 0.9, cd: 700, st:  9 },
  "Bow":        { dmg: 11, reach: 1.6, arc: 0.6, cd: 650, st:  9 },
  "Slingshot":  { dmg:  8, reach: 1.5, arc: 0.6, cd: 540, st:  7 },
  "Katana":     { dmg: 16, reach: 1.5, arc: 0.9, cd: 800, st: 11 },
};
// Race → racial weapon. Mirrors the same map the client uses for the hotbar.
const RACE_WEAPON = {
  Human: "Dagger",
  Orc: "Club",
  Elf: "Bow",
  Crystalline: "Slingshot",
  Voidborn: "Katana",
};

// Castable spells. Per design doc §14.1 spells have NO cooldowns; mana is
// the only gate (terrain-altering spells in §14.3 are the exception).
// Mana Bolt is the universal starter — straight-line, lance-shaped lane.
// Per §3.5: cost = BaseCost × (Output%/100) × (1 - Efficiency%/100).
// Per §4.1+§4.2: dmg = base × Output × power × (1+0.1×(lv-1)) × Min(10, 1+log10(ManaCap/500)).
// Aim is determined by the cursor at the moment of cast — see realm.js
// sendCast() — the server just trusts the facing the client sends and
// snaps the player to it.
const SPELL = {
  mana_bolt: {
    name: "Mana Bolt",
    cost: 50,            // BaseCost (multiplied by output and (1-eff))
    cd:   0,             // §14.1 — no cooldown
    reach: 8,            // tiles forward
    width: 0.55,         // half-width perpendicular
    dmg:  50,            // base damage unit (multiplied by manaCap-mult etc.)
    power: 1.0,          // SpellBasePower per §14.2 (Mana Bolt = 1.0)
    lv:   1,             // grimoire level (1-10); upgraded later
    speed: 22,           // tiles/sec — cosmetic for the client beam
  },
};

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
    `SELECT id, account_id, name, race, gender, level, xp,
            mana_cap, max_hp, hp, stamina_cap,
            control, efficiency, cast_speed, resistance,
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

// Combat persists HP immediately so a wounded vessel that disconnects
// stays wounded on relog. Mana / stamina are intentionally NOT persisted
// (they regen back to cap quickly and would cost a write per tick).
async function saveHp(charId, hp) {
  await query(`UPDATE characters SET hp = $1 WHERE id = $2`, [Math.max(0, Math.round(hp)), charId]);
}

async function killCharacter(charId) {
  await query(
    `UPDATE characters SET died_at = NOW(), hp = 0 WHERE id = $1 AND died_at IS NULL`,
    [charId]
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
        // ── live vitals (whole numbers) ──────────────────────────
        hp:     Math.max(0, Math.round(p.hp)),
        hpMax:  p.maxHp,
        mana:   Math.max(0, Math.round(p.mana)),
        manaMax:p.manaCap,
        st:     Math.max(0, Math.round(p.stamina)),
        stMax:  p.staminaCap,
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
    // ── stat block (loaded once, immutable for this session) ───────
    this.level      = Number(character.level) || 1;
    this.maxHp      = Number(character.max_hp) || 100;
    this.manaCap    = Number(character.mana_cap) || 0;
    this.staminaCap = Number(character.stamina_cap) || 100;
    this.control    = Number(character.control) || 1;
    this.efficiency = Number(character.efficiency) || 1;
    this.castSpeed  = Number(character.cast_speed) || 1;
    this.resistance = Number(character.resistance) || 0;
    // ── live vitals: HP persists across logout, mana/stamina restore
    //    to cap on connect (they regen so fast it doesn't matter and
    //    we'd otherwise pay a DB write every tick).
    this.hp       = Math.max(0, Math.min(this.maxHp,    Number(character.hp) || this.maxHp));
    this.mana     = this.manaCap;
    this.stamina  = this.staminaCap;
    // ── combat bookkeeping ───────────────────────────────────────
    this.weapon       = isAdmin ? "Free Hand" : (RACE_WEAPON[character.race] || "Free Hand");
    this.attackCdUntil = 0;          // timestamp ms before which next attack is rejected
    this.castCdUntil   = 0;          // same, but for castable spells
    this.lastDamageAt  = 0;          // ms since last hit taken (for HP regen lockout)
    this.dead          = false;
    this.lastHpSavedAt = Date.now(); // throttle HP writes to DB
    this.lastSavedHp   = this.hp;
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
      if (!sess?.userId) return reject(socket, 401, "Not signed in");
      // The default shard is the shared world for everyone — admins can
      // build, players can roam and cast. Per-server isolation lands when
      // /command create_server + /command world_publish ship.
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
        // full vital + stat block so the HUD is correct immediately
        hp: player.hp, hpMax: player.maxHp,
        mana: player.mana, manaMax: player.manaCap,
        st: player.stamina, stMax: player.staminaCap,
        level: player.level,
        weapon: player.weapon,
        control: player.control, efficiency: player.efficiency,
        castSpeed: player.castSpeed, resistance: player.resistance,
      },
      others: shard.snapshot().filter((p) => p.id !== player.id),
    }));
    shard.broadcast({
      type: "join",
      player: {
        id: player.id, name: player.name, x: player.x, y: player.y,
        facing: player.facing, isAdmin: player.isAdmin, race: player.race,
        hp: player.hp, hpMax: player.maxHp,
        mana: player.mana, manaMax: player.manaCap,
        st: player.stamina, stMax: player.staminaCap,
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
      case "attack": {
        // Optional facing override so a stationary swing still aims where
        // the attacker means it to. Movement-based facing is already kept
        // up-to-date by the input handler.
        if (typeof msg.facing === "string" && VALID_FACINGS.has(msg.facing)) {
          player.facing = msg.facing;
        }
        const shard = shards.get(player.shard);
        if (shard) tryAttack(shard, player);
        break;
      }
      case "cast": {
        if (typeof msg.facing === "string" && VALID_FACINGS.has(msg.facing)) {
          player.facing = msg.facing;
        }
        const shard = shards.get(player.shard);
        if (!shard) break;
        const spellKey = String(msg.spell || "");
        const output = clampUnit(typeof msg.output === "number" ? msg.output : 1);
        tryCast(shard, player, spellKey, Math.max(0.05, Math.min(1, output)));
        break;
      }
      case "ping":
        try { player.ws.send(JSON.stringify({ type: "pong", t: msg.t })); } catch {}
        break;
    }
  }

  // ---- combat: melee swing resolution -------------------------------
  // Pure server-authoritative. Reads weapon stats, checks cooldown +
  // stamina, scans every other LIVING player in the shard, computes
  // hit-test (front-facing rectangular arc), applies damage, persists
  // HP, and broadcasts {swing} (everyone sees the slash) plus per-target
  // {hit} (everyone learns the damage so the floating numbers + flash
  // can render). Death triggers {slain} and tears the loser's socket.
  function tryAttack(shard, attacker) {
    if (attacker.dead) return;
    const now = Date.now();
    if (now < attacker.attackCdUntil) return;
    const w = WEAPON[attacker.weapon] || WEAPON["Free Hand"];
    if (attacker.stamina < w.st) {
      // Soft refusal so the client can "thunk" the attempt without spam.
      try { attacker.ws.send(JSON.stringify({ type: "attack_denied", reason: "stamina" })); } catch {}
      return;
    }
    attacker.stamina -= w.st;
    attacker.attackCdUntil = now + Math.max(ATTACK_GLOBAL_CD_MS, w.cd);

    // Damage formula: weapon base + 50% of control stat. (Future: weapon
    // mastery, crits, race modifiers.) Round to whole hp points so the
    // bars never tick by fractions a player can't read.
    const dmg = Math.max(1, Math.round(w.dmg + (attacker.control || 0) * 0.5));

    // Build the swing arc: a rectangle of length=reach forward of the
    // attacker, width=2*arc perpendicular. Hit-test by transforming each
    // candidate's offset into attacker-local (forward, side) coords.
    const fv = FACING_VEC[attacker.facing] || FACING_VEC.down;
    // perpendicular to facing
    const px = -fv.y, py = fv.x;
    const hits = [];
    for (const target of shard.players.values()) {
      if (target === attacker || target.dead) continue;
      const ox = target.x - attacker.x;
      const oy = target.y - attacker.y;
      const forward = ox * fv.x + oy * fv.y;          // tiles in front
      const side    = Math.abs(ox * px + oy * py);    // perpendicular distance
      if (forward < -0.2 || forward > w.reach) continue;
      if (side > w.arc) continue;
      // Resistance softens damage by up to ~30% (resistance 100 → 0.7×).
      const taken = Math.max(1, Math.round(dmg * (1 - Math.min(0.5, (target.resistance || 0) / 200))));
      target.hp = Math.max(0, target.hp - taken);
      target.lastDamageAt = now;
      hits.push({ target, dmg: taken });
    }

    // Always broadcast the swing visual so onlookers see the motion even
    // if the swing whiffs. `t` lets the client time the slash arc.
    shard.broadcast({
      type: "swing",
      id: attacker.id,
      facing: attacker.facing,
      reach: w.reach,
      arc: w.arc,
      weapon: attacker.weapon,
      t: now,
    });

    for (const { target, dmg: taken } of hits) {
      shard.broadcast({
        type: "hit",
        id: target.id,
        from: attacker.id,
        dmg: taken,
        hp: Math.round(target.hp),
        hpMax: target.maxHp,
      });
      // Persist the wound right away so disconnect mid-fight sticks.
      saveHp(target.charId, target.hp).catch((err) =>
        console.error("[realtime] saveHp failed", err)
      );
      target.lastSavedHp = target.hp;
      target.lastHpSavedAt = now;
      if (target.hp <= 0 && !target.dead) {
        slay(shard, target, attacker);
      }
    }
  }

  // ---- spells: instant straight-line ranged ------------------------
  // Same shape as melee but with a longer, narrower hit-box (a "lane"
  // out in front of the caster) and mana cost / damage both scaled by
  // the player's channeled Output. Currently only `mana_bolt` is wired.
  function tryCast(shard, caster, spellKey, output) {
    if (caster.dead) return;
    const spell = SPELL[spellKey];
    if (!spell) return;
    const now = Date.now();
    // Per design doc §14.1 — mana cost is the only gate for non-terrain
    // spells. Terrain-altering spells (Earth Wall, etc.) keep their cd.
    if (spell.cd > 0 && now < caster.castCdUntil) return;

    // Per design doc §3.5: Spell Cost = BaseCost × (Output%/100) × (1 - Efficiency%/100)
    // Mana Bolt at Lv1 has BaseCost = 50; at 20% Output = 10 mana.
    // Efficiency is the player's stat (0-50%, capped 75% for Arcanists).
    const eff = Math.min(0.75, Math.max(0, (caster.efficiency || 0) / 100));
    const cost = Math.max(1, Math.round((spell.cost || 0) * output * (1 - eff)));
    if (caster.mana < cost) {
      try { caster.ws.send(JSON.stringify({ type: "cast_denied", spell: spellKey, reason: "mana" })); } catch {}
      return;
    }
    caster.mana -= cost;
    if (spell.cd > 0) {
      caster.castCdUntil = now + Math.max(150, Math.round(spell.cd / Math.max(0.5, caster.castSpeed || 1)));
    }

    // Per design doc §4.1 + §4.2 — diminishing-returns damage scaling.
    // Damage = baseUnit × Output × SpellBasePower × (1 + 0.1×SpellLv) × Min(10, 1+log10(ManaCap/500))
    // baseUnit = 50 keeps starter players around 55 dmg/bolt at full output
    // (≈4 hits to take a 200 HP vessel) and admins around 110 (≈2 hits).
    const manaCap = Math.max(1, caster.manaCap || 500);
    const dmgMult = Math.min(10, 1 + Math.log10(manaCap / 500));
    const spellLv = Math.max(1, spell.lv || 1);
    const lvScale = 1 + 0.1 * (spellLv - 1); // Lv1 = 1.0x, Lv10 = 1.9x
    const baseUnit = spell.dmg || 50;
    const power = spell.power || 1.0;
    const dmg = Math.max(1, Math.round(baseUnit * output * power * lvScale * dmgMult));

    const fv = FACING_VEC[caster.facing] || FACING_VEC.down;
    const px = -fv.y, py = fv.x;
    // Walk the line and pick the FIRST living player in the lane —
    // bolts are lance-line, not piercing. (Future spells can iterate.)
    let hit = null;
    let hitForward = Infinity;
    for (const target of shard.players.values()) {
      if (target === caster || target.dead) continue;
      const ox = target.x - caster.x;
      const oy = target.y - caster.y;
      const forward = ox * fv.x + oy * fv.y;
      const side    = Math.abs(ox * px + oy * py);
      if (forward < 0.2 || forward > spell.reach) continue;
      if (side > spell.width) continue;
      if (forward < hitForward) { hit = target; hitForward = forward; }
    }

    // Bolt visual — caster.x/y → endpoint. If we missed, draw all the way
    // to max range so it visibly "fires off into the void".
    const endDist = hit ? hitForward : spell.reach;
    const endX = caster.x + fv.x * endDist;
    const endY = caster.y + fv.y * endDist;
    shard.broadcast({
      type: "bolt",
      spell: spellKey,
      from:  { id: caster.id, x: caster.x, y: caster.y },
      to:    { x: endX, y: endY },
      hitId: hit ? hit.id : null,
      output,
      speed: spell.speed,
      t: now,
    });

    if (hit) {
      const taken = Math.max(1, Math.round(dmg * (1 - Math.min(0.5, (hit.resistance || 0) / 200))));
      hit.hp = Math.max(0, hit.hp - taken);
      hit.lastDamageAt = now;
      shard.broadcast({
        type: "hit",
        id: hit.id,
        from: caster.id,
        dmg: taken,
        hp: Math.round(hit.hp),
        hpMax: hit.maxHp,
        spell: spellKey,
      });
      saveHp(hit.charId, hit.hp).catch((err) =>
        console.error("[realtime] saveHp failed", err)
      );
      hit.lastSavedHp = hit.hp;
      hit.lastHpSavedAt = now;
      if (hit.hp <= 0 && !hit.dead) slay(shard, hit, caster);
    }
  }

  // ---- death: free name, broadcast, drop the loser's socket ---------
  function slay(shard, victim, killer) {
    victim.dead = true;
    victim.hp = 0;
    killCharacter(victim.charId).catch((err) =>
      console.error("[realtime] killCharacter failed", err)
    );
    shard.broadcast({
      type: "slain",
      id: victim.id,
      name: victim.name,
      by: killer ? { id: killer.id, name: killer.name } : null,
    });
    chatBroadcast(shard, {
      type: "chat",
      kind: "system",
      text: killer
        ? `${victim.name} was slain by ${killer.name}.`
        : `${victim.name} has fallen.`,
    });
    // Give the client one tick to render the death modal, then close.
    setTimeout(() => {
      try { victim.ws.send(JSON.stringify({ type: "goodbye", reason: "slain" })); } catch {}
      try { victim.ws.close(4001, "slain"); } catch {}
    }, 250);
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
      // 1. integrate movement (gated by stamina for sprint)
      for (const p of shard.players.values()) {
        if (p.dead) continue;
        const { dx, dy } = p.input;
        // Sprint only "counts" if we still have stamina to burn. The
        // input flag stays as the player typed it; we just clamp the
        // *effective* sprint to false once empty so movement falls back
        // to walk speed without any extra UX friction.
        const wantsSprint = !!p.input.sprint;
        const canSprint = wantsSprint && p.stamina > 0;
        const moving = dx !== 0 || dy !== 0;
        if (moving) {
          const len = Math.hypot(dx, dy) || 1;
          const speed = MAX_SPEED_TPS * (canSprint ? SPRINT_MULT : 1);
          p.x = clampPos(p.x + (dx / len) * speed * dt);
          p.y = clampPos(p.y + (dy / len) * speed * dt);
          p.anim = canSprint ? "sprint" : "walk";
        } else {
          p.anim = "idle";
        }

        // 1b. vitals tick — stamina drain on sprint+move, regen otherwise;
        //     mana regen always; HP regen only after a combat lull.
        if (canSprint && moving) {
          p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN_PER_SEC * dt);
        } else {
          p.stamina = Math.min(p.staminaCap, p.stamina + STAMINA_REGEN_PER_SEC * dt);
        }
        if (p.manaCap > 0 && p.mana < p.manaCap) {
          p.mana = Math.min(p.manaCap, p.mana + MANA_REGEN_PER_SEC * (p.efficiency || 1) * dt);
        }
        if (p.hp < p.maxHp && now - p.lastDamageAt > COMBAT_LOCKOUT_MS) {
          p.hp = Math.min(p.maxHp, p.hp + HP_REGEN_PER_SEC * dt);
        }
      }
      // 2. broadcast snapshot
      const snap = shard.snapshot();
      shard.broadcast({ type: "state", t: now, players: snap });
      // 3. lazy save (every 15s per player) — position + any HP drift
      //    (regen rebuilds HP between fights; persist that occasionally
      //    so a long uptime doesn't lose the recovery on a crash).
      for (const p of shard.players.values()) {
        if (now - p.lastSavedAt > SAVE_EVERY_MS) {
          p.lastSavedAt = now;
          savePosition(p.charId, p.x, p.y, p.facing).catch((err) => {
            console.error("[realtime] periodic save failed", err);
          });
        }
        if (now - p.lastHpSavedAt > SAVE_EVERY_MS && Math.abs(p.hp - p.lastSavedHp) >= 1) {
          p.lastHpSavedAt = now;
          p.lastSavedHp = p.hp;
          saveHp(p.charId, p.hp).catch((err) => {
            console.error("[realtime] periodic hp save failed", err);
          });
        }
      }
    }
  }, TICK_MS);

  return { wss, shards };
}

module.exports = { init };
