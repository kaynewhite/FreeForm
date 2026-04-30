# FREEFORM MANA - COMPLETE MASTER DESIGN DOC v29.0 FINAL

## Status: PRODUCTION SPEC - All Systems Locked ✅

## Last Updated: May 1, 2026 — 14:30 UTC

---

## DOCUMENTATION PURPOSE

This document is the **single source of truth** for the development of Freeform Mana. Every system, mechanic, rule, and interaction is specified below in exact detail. The next AI (or developer) reading this document should be able to implement the game without needing to ask clarifying questions.

**If a mechanic is not written here, it does not exist in the game.**

---

## DOCUMENT STRUCTURE

1. Core Thesis & Philosophy
2. Technical Architecture
3. Character System
4. Mana Cap & Damage Scaling
5. Stamina & Sprint System
6. Movement Speed & Controls
7. Magic-Only Combat System
8. Death & Permanent Deletion
9. Admin Succession
10. Board of Legends
11. Legend Announcement System
12. Power Board
13. Guild System
14. Guild vs Guild War System
15. Party System
16. Spell System (Core Spells)
17. Grimoire & Spell Leveling System
18. Spell Creation System (Admin) — Complete UI Specification
19. Combat & Magic
20. Mana Detection, Pulse, Compression & Focus
21. Mana Shield System
22. Potions & Sustainance
23. Economy & Currency
24. NPC System (Complete List)
25. NPC Lore & Story Generation
26. Enemy System
27. World Building System (Admin Only)
28. Admin & Operator Commands (Complete List)
29. Player Commands (No Prefix)
30. Safe Zone Structure
31. Tournament System (Admin-Hosted)
32. Karma & Karma Redemption System
33. Daily Login Rewards
34. Achievement System
35. Server Transfer Cooldown
36. Single Character Per Account
37. PvP Bounty System
38. Item Mail System (Donations Only)
39. Territory Resource Generation
40. Combat Log (Player Viewable)
41. AFK Timer Auto-Kick
42. Name Change System
43. Pet System (Cosmetic)
44. World Map Reveal System
45. Server Population Display
46. Time-Altering Spells (Admin Only)
47. Server Architecture
48. UI Philosophy & Features
49. Asset & Spritesheet Requirements
50. AI System Plan (Future Implementation)
51. Logging System (Admin)
52. Player Freedom - No Core Loop
53. Monetization Plan
54. Day 0 to Launch Checklist
55. Glossary of Terms

---

## 1. CORE THESIS & PHILOSOPHY

### 1.1 Game Identity

Freeform Mana is a **top-down, browser-based, sharded sandbox MMORPG** where the admin builds the world live while players play in it.

| Term | Exact Definition |
|------|------------------|
| Top-down | Camera is fixed at a 90-degree angle looking straight down. No rotation. No zoom. 1 tile = 32 pixels = 1 meter. |
| Browser-based | No installation required. Works in Chrome, Firefox, Edge. Not compatible with mobile devices. |
| Sharded | Multiple server instances exist. Server 0 is for the admin. Servers 1 through 30 are for players. Each server operates independently. |
| Sandbox | No quests. No directed story. No forced goals. Players create their own objectives. |
| MMORPG | Massively Multiplayer Online Role Playing Game. Persistent world. Many players simultaneously. |
| Admin builds live | The admin can add or remove tiles, props, monsters, and NPCs while players are actively playing in the same world. |

### 1.2 Core Design Pillars

| Pillar | Description |
|--------|-------------|
| No forced core loop | Players are never told what to do. They log in and exist in the world. There is no tutorial that tells them what to do next. |
| Permanent death | When a character's Health reaches 0, the character is deleted forever. The character's name becomes unavailable for a period of time. |
| Mana Cap equals Damage | Every point of Mana Cap increases damage potential. Diminishing returns prevent one-shot kills. |
| Pure magic | No weapons exist in the game. No basic attacks. Only spells. Everything a player does is magic. |
| Admin builds the world | The world starts completely empty. The admin creates everything from nothing. |
| Player-driven economy | Trading between players is the primary economy. NPCs are supplemental. |
| No pay-to-win | Real money purchases are cosmetic only. This includes name changes, pet skins, and custom titles. |

### 1.3 Game World Starting State

| Server | Starting State |
|--------|----------------|
| Server 0 (Admin Home) | Empty void. No tiles. No chunks. Nothing exists. |
| Player Servers (1 through 30) | Fresh flat grass map. Size is 2000 by 2000 tiles. No cities exist. No central_hall buildings exist. No spawn points exist. |
| Players | Players cannot spawn until the admin places at least one central_hall building on their server. |

### 1.4 Key Terms Glossary (Pre-Read)

| Term | Definition |
|------|------------|
| Admin | The game owner. Has full control over everything. Only one original admin exists. |
| Assigned Admin | A player granted admin powers by the original admin. Has full access but may have restrictions on assigning other admins. |
| Operator | A trusted player with limited admin powers. Operators can use local build mode only. Operators cannot manage players. |
| Original Admin | The creator of the game. Has the number 0 position on the Power Board. Can assign other admins. |
| Successor Admin | A player who becomes admin by killing the previous admin. Inherits half of the previous admin's stats. |
| Character | A player's in-game persona. One character per account. Permanent death deletes the character. |
| Account | The player's login credentials. Can create one character. Can delete that character to make a new one. |
| Server 0 | Admin home. Testing ground. Guard headquarters. Only the admin and operators can join. |
| Player Server | Servers 1 through 30. Where players play. Each server holds 250 players plus one admin slot. |

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Platform Specifications

| Component | Specification | Reason |
|-----------|---------------|--------|
| Client Graphics | PixiJS WebGL | Fast 2D rendering. Wide browser support. |
| Client Language | JavaScript with TypeScript optional | Browser native. No compilation required. |
| Server Runtime | Node.js version 20 or higher | JavaScript on the server. WebSocket support built in. |
| Server Tick Rate | 20 ticks per second | Each tick occurs every 50 milliseconds. The server is authoritative. |
| Network Protocol | WebSocket with delta compression | Low latency. Bandwidth efficient. Only changes are sent. |
| Database | Supabase (PostgreSQL) | Provides authentication and data storage. Free tier available. |
| Hosting (Planned) | Oracle Cloud Free Tier | 4 CPU cores. 24 GB RAM. 10 TB bandwidth per month. |

### 2.2 Server Tick Details

| Aspect | Value | Explanation |
|--------|-------|-------------|
| Ticks per second | 20 | The server updates the game state 20 times every second. |
| Milliseconds per tick | 50 | Each tick takes 50 milliseconds. |
| Player input buffer | 500 milliseconds | The server can buffer inputs to compensate for network lag. |
| Authority | Full server authority | The client is only visual. The server decides all outcomes. The client cannot override the server. |
| Delta compression | Yes | The server only sends changed data to clients. It does not send the full game state every tick. |

### 2.3 Network Protocol Messages

**Client to Server Messages:**

| Message Type | Payload | When Sent |
|--------------|---------|-----------|
| auth | `{ token, username }` | On initial WebSocket connection |
| move | `{ dx, dy, timestamp }` | When movement keys change, sent 20 times per second |
| cast | `{ spellId, targetX, targetY, outputPercent }` | When the player casts a spell |
| overcast_arm | `{ armed: true or false }` | When the G key is pressed or released |
| overcast_fire | `{ targetX, targetY }` | When left or right click occurs while overcast is armed |
| chat | `{ message }` | When the T key is pressed and a message is sent |
| whisper | `{ target, message }` | When the /whisper command is used |
| call | `{ target, action }` | When the /call command is used |
| trade | `{ target, items, accept }` | During the trade UI process |
| server_hop | `{ serverId }` | When the player switches servers |

**Server to Client Messages:**

| Message Type | Payload | When Sent |
|--------------|---------|-----------|
| auth_success | `{ player }` | After successful authentication |
| auth_failed | `{ reason }` | After failed authentication |
| world_state | `{ players, chunks, serverName, playerCount }` | After authentication, then periodically |
| player_join | `{ player }` | When another player joins the server |
| player_leave | `{ playerId }` | When another player leaves the server |
| tick | `{ players, projectiles, spells }` | Every server tick, 20 times per second |
| spell_cast | `{ casterId, spellId, startX, startY, targetX, targetY }` | When any player casts a spell |
| damage | `{ targetId, amount, newHp, sourceId }` | When damage is dealt to any entity |
| death | `{ playerId, killerId }` | When a player dies |
| xp_gain | `{ amount, newLevel }` | When a player gains XP |
| mana_update | `{ current, max }` | When a player's mana changes |
| health_update | `{ current, max }` | When a player's health changes |
| chat | `{ playerName, message }` | When proximity chat occurs |
| whisper | `{ fromPlayer, message }` | When a whisper is received |
| call_incoming | `{ fromPlayer }` | When a call request is received |
| call_accepted | `{ toPlayer }` | When a call is accepted |
| trade_request | `{ fromPlayer }` | When a trade request is received |
| trade_update | `{ player1Offers, player2Offers, status }` | During the trade process |
| announcement | `{ message, type }` | When an admin sends an announcement |
| legend_announcement | `{ name, title, achievement }` | When a new legend is carved on the Board of Legends |
| bounty_update | `{ player, amount }` | When a bounty is placed or changed |
| tournament_notification | `{ message, status }` | During a tournament |

### 2.4 Loading Screen

| Aspect | Detail |
|--------|--------|
| When shown | On initial world entry. On server transfer. |
| Duration | Until all assets are loaded and player data is received. |
| Elements | Progress bar. Loading text. Random vague hint. |
| Player interaction | No player input is accepted during loading. |

---

## 3. CHARACTER SYSTEM

### 3.1 Account Limits

| Rule | Value | Explanation |
|------|-------|-------------|
| Characters per account | 1 | One character at a time per account. |
| Delete character | Yes | Players can delete their current character to create a new one. |
| Name reuse after deletion | 90 days | Prevents name squatting. The deleted name becomes available after 90 days. |
| Character slot expansion | Not planned | May be added in the future with real money purchase. |

### 3.2 Character Creation Flow

| Step | Action |
|------|--------|
| 1 | Player logs in with email and password or social login. |
| 2 | If no character exists, the character creation screen is shown. |
| 3 | Player selects gender: Male or Female. |
| 4 | System randomly selects a race. Each race has a 20 percent chance. |
| 5 | Player enters a character name. Name must be 3 to 20 characters. Only alphanumeric characters are allowed. |
| 6 | System checks if the name is available. |
| 7 | Character is created with 500 Mana Cap and 1000 Health. |
| 8 | Player enters the world. If no central_hall exists on the server, the player enters spectator mode. |

### 3.3 Races

Each race has a 20 percent chance of being selected. The player cannot choose.

| Race | Passive Ability | Numerical Bonus | Visual Description |
|------|----------------|-----------------|---------------------|
| Human | Can control 3 objects at start | +10 percent trading discount. 2.5 percent chance to double trades from NPCs. | Standard human appearance. |
| Orc | +10 percent Max HP | +20 Stamina Cap | Green skin. Visible tusks. Muscular build. |
| Elf | +5 percent Mana Regen | +2 tiles detection range for Mana Detection | Tall. Slender. Pointed ears. |
| Crystalline | +10 percent Resistance | 15 percent chance to reflect projectiles | Translucent body. Light refraction effect. |
| Voidborn | Compression costs 50 percent less | +25 percent Stamina Regen. +8 percent movement speed base. +2 percent additional movement speed. | Purple eyes. Shadow trail behind character. |

**Racial Bonus Clarifications:**

| Bonus | Exact Calculation |
|-------|-------------------|
| +10 percent trading discount | NPC prices are multiplied by 0.9 |
| 2.5 percent double trade | On each NPC purchase, a random check occurs. If true, duplicate items are received. |
| +20 Stamina Cap | Base 100 becomes 120 |
| +2 tiles detection | Mana Detection spell range increases by 2 tiles |
| 15 percent reflect | On projectile hit, a random check occurs. If true, the projectile reverses direction. |
| 50 percent cheaper Compression | 25 mana per second becomes 12.5 mana per second |
| +25 percent Stamina Regen | 10 per second becomes 12.5 per second |
| +8 percent +2 percent movement speed | Base 100 percent becomes 110 percent. Sprint 140 percent becomes 154 percent. |

### 3.4 Gender

| Gender | Pronouns | Visual Difference |
|--------|----------|-------------------|
| Male | he, him | Male character sprite |
| Female | she, her | Female character sprite |

### 3.5 Base Stats

| Stat | Starting Value | Hard Cap | Description |
|------|----------------|----------|-------------|
| Mana Cap | 500 | None after level 100 | Maximum mana pool. Also scales damage. |
| Health | 1000 | None | Hit points. Regeneration is disabled in combat. |
| Control | 10 | None | Object control limit. Each level adds 1 object. |
| Efficiency | 0 percent | 50 percent (75 percent for Arcanist class) | Mana cost reduction. |
| Cast Speed | 100 | None | 100 equals normal speed. 200 equals twice as fast. |
| Resistance | 0 | None | Damage reduction. Diminishing returns apply. |
| Focus | 10 | None | Compression effectiveness. Higher focus makes detection harder. |

### 3.6 Stat Formulas

| Calculated Stat | Formula | Example at Start |
|-----------------|---------|------------------|
| Mana Regen per second | ManaCap × 0.01 × (1 + Control ÷ 100) | 500 × 0.01 × 1.1 = 5.5 mana per second |
| Resistance Multiplier | 1 - (Resistance ÷ (Resistance + 100)) | 1 - (0 ÷ 100) = 1.0 (no reduction) |
| Damage Taken | Incoming Damage × Resistance Multiplier | 100 × 1.0 = 100 damage |
| Spell Cost | BaseCost × (Output percent ÷ 100) × (1 - Efficiency percent ÷ 100) | 50 × 0.2 × 1.0 = 10 mana |
| Detection Chance | Max of 0, (Attacker Mana Cap ÷ Defender Focus) × 0.1 | (1000 ÷ 10) × 0.1 = 10 percent |

### 3.7 XP and Leveling

**XP Formula:**

```
base = Victim.ManaCap

if Victim is Player:
    bonus = Max of 0, (Victim.Level - Killer.Level) × 0.1 × base

XP = base + bonus
```

**Level Curve Exact Values:**

| Level | XP Required to Reach This Level |
|-------|--------------------------------|
| 2 | 2,828 |
| 5 | 11,180 |
| 10 | 31,622 |
| 20 | 89,442 |
| 50 | 353,553 |
| 75 | 649,519 |
| 100 | 1,000,000 |

**Level Up Reward Choices:**

When a player levels up, they choose ONE reward from the list below.

| Reward | Effect | Stacking |
|--------|--------|----------|
| Mana Cap +10 | Maximum mana increases by 10 | Additive |
| Control +1 | Object control increases by 1. Mana regen increases by 1 percent. | Additive |
| Efficiency +1 percent | Mana cost decreases by 1 percent | Additive, capped at 50 percent (75 for Arcanist) |
| Cast Speed +5 | Cast speed increases by 5 | Additive |
| Max HP +25 | Maximum health increases by 25 | Additive |
| Resistance +1 | Damage reduction increases by 1 percent | Additive with diminishing returns |
| Stamina Cap +5 | Maximum stamina increases by 5 | Additive |
| Stamina Regen +2 percent | Stamina recovery rate increases by 2 percent | Multiplicative |
| Focus +1 | Focus increases by 1 | Additive |

### 3.8 Classes

Players choose a class at Level 5. The choice is permanent. A respec option is available for 50,000 gold, once per character.

| Class | Passive | Unique Mechanic |
|-------|---------|-----------------|
| Battlemage | Overcast debuffs duration is multiplied by 0.8 | Dash cooldown resets instantly on kill |
| Warden | HP from all sources is multiplied by 1.5 | 15 percent chance to taunt enemy on damage |
| Arcanist | Efficiency increased by 10 percent | Mana Burn: 10 percent of damage drains enemy mana |
| Conduit | Dash cooldown multiplied by 0.5. Dash cost multiplied by 0.5. | Can move at 50 percent speed while channeling spells |
| Null | Resistance increased by 15. 5 percent reflect chance. | Successful Reflect also silences enemy for 2 seconds |

**Class Ascension Bonuses (Level 100 and above):**

| Class | Ascension Bonus |
|-------|-----------------|
| Battlemage | Overcast debuffs duration multiplied by 0.6 |
| Warden | HP multiplier becomes 2.0. Taunt chance becomes 30 percent. |
| Arcanist | Efficiency increased by 20 percent. Mana Burn becomes 20 percent of damage. |
| Conduit | Dash cooldown multiplied by 0.25. Dash cost multiplied by 0.25. |
| Null | Resistance increased by 30. Reflect chance becomes 10 percent. Silence duration becomes 4 seconds. |

### 3.9 Admin Class

Only one original admin exists. Assigned admins receive the same class but without the Creator Tag.

| Stat | Admin Value | Normal Player Value |
|------|-------------|---------------------|
| Mana Cap | 1,000,000 | 500 |
| Health | 100,000 | 1,000 |
| Control | 1,000 | 10 |
| Efficiency | 50 percent | 0 percent |
| Cast Speed | 500 | 100 |
| Resistance | 500 | 0 |
| Focus | 500 | 10 |
| Stamina Cap | 500 | 100 |
| Stamina Regen | 200 percent | 100 percent |
| Movement Speed | +10 percent | 0 percent |

**Admin Immunities:**

- Immune to all debuffs
- Immune to Overcast penalties
- Can bypass any cooldown
- Can attack in any zone, including Safe Zones
- Cannot be killed by normal means. The admin must choose to die.

---

## 4. MANA CAP AND DAMAGE SCALING

### 4.1 Core Damage Formula

```
Spell Damage = ManaCap × (Output percent ÷ 100) × SpellBasePower × (1 + 0.1 × SpellLevel)
```

| Variable | Range | Description |
|----------|-------|-------------|
| ManaCap | 500 to infinity | The player's maximum mana |
| Output percent | 1 to 100 | Selected via scroll wheel |
| SpellBasePower | 0.5 to 3.0 | Set when the spell is created |
| SpellLevel | 1 to 10 | Increased through grimoire use |

### 4.2 Damage Diminishing Returns

```
EffectiveDamageMultiplier = Minimum of 10, (1 + log10(ManaCap ÷ 500))
```

| ManaCap | Raw Multiplier | Effective Multiplier | Can One-Shot a 1000 HP Target? |
|---------|---------------|---------------------|--------------------------------|
| 500 | 1.0x | 1.0x | No |
| 1,000 | 2.0x | 1.3x | No |
| 5,000 | 10.0x | 2.0x | No |
| 10,000 | 20.0x | 2.3x | No |
| 100,000 | 200.0x | 3.3x | No |
| 1,000,000 | 2,000.0x | 4.3x | No |
| 10,000,000 | 20,000.0x | 5.0x | No |

**One-Shot Rule:**

Normal spells cannot deal more than 3 times the target's current Health in a single hit. If the calculated damage would exceed this limit, it is capped at 3 times the target's current Health.

Overcast ignores this rule.

### 4.3 Level 100 Ascension Message

The following exact text is displayed server-wide when a player reaches Level 100:

```
══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══

    ✦ THE FIRMAMENT TAKES NOTICE ✦

    [PLAYER NAME] HAS CROSSED THE THRESHOLD

          A FORMIDABLE FORCE
           ON THE HORIZON

    THE JOURNEY TO TRUE POWER CONTINUES

══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══
```

### 4.4 Infinite Progression After Level 100

| Rule | Description |
|------|-------------|
| No maximum Mana Cap | Mana Cap can grow indefinitely. |
| No maximum level | Level 1000 is possible. |
| XP curve continues | The same formula applies forever. |
| Tome drops diminish | Levels 200 to 299: 50 percent reduced drop rate. Levels 300 and above: 75 percent reduced drop rate. |

---

## 5. STAMINA AND SPRINT SYSTEM

### 5.1 Core Stamina Mechanics

| Aspect | Value |
|--------|-------|
| Sprint key | Left Shift |
| Base stamina cap | 100 |
| Base stamina regeneration | 10 per second. This occurs always, even in combat. |
| Sprint drain | 15 per second |
| Sprint speed bonus | +40 percent movement speed |
| Minimum stamina to sprint | 10 |
| Auto-stop condition | Sprinting stops automatically when stamina reaches 0 |

### 5.2 Stamina Modifiers

| Source | Modifier |
|--------|----------|
| Orc racial | +20 stamina cap |
| Voidborn racial | +25 percent regeneration rate |
| Level up reward | +5 stamina cap OR +2 percent regeneration rate |
| Gear | Up to +50 stamina cap, up to +20 percent regeneration rate |

---

## 6. MOVEMENT SPEED AND CONTROLS

### 6.1 Base Movement Speeds

| Race | Walk Speed | Sprint Speed |
|------|------------|--------------|
| Human | 100 percent (32 pixels per second) | 140 percent (44.8 pixels per second) |
| Orc | 100 percent | 140 percent |
| Elf | 100 percent | 140 percent |
| Crystalline | 100 percent | 140 percent |
| Voidborn | 108 percent (34.56 pixels per second) | 151.2 percent (48.38 pixels per second) |

### 6.2 Speed Adjustment

| Key | Action |
|-----|--------|
| Up Arrow | Increase movement speed by 5 percent, up to the maximum allowed by gear |
| Down Arrow | Decrease movement speed by 5 percent, down to a minimum of 50 percent |

### 6.3 Speed Upgrade Sources

| Source | Gain | Rarity |
|--------|------|--------|
| Rare gear | +1 to +5 percent | Hard |
| Legendary gear | +5 to +10 percent | Very Hard |
| Artifact gear | +10 to +15 percent | Extremely Hard |
| Special tomes | +1 percent | Rare boss drop |

---

## 7. MAGIC-ONLY COMBAT SYSTEM

### 7.1 Removed Items

The following items are NOT in the game:

| Removed Item | Replacement |
|--------------|-------------|
| Basic attack (key 1) | Removed entirely |
| All weapons (swords, bows, axes, etc.) | Removed entirely |
| Weapon drops | Spell grimoires instead |
| Weapon Smith NPC | Removed entirely |
| Weapon durability | Removed entirely |
| Melee combat | Only spells |
| Ranged combat (non-magic) | Only spells |

### 7.2 New Control Scheme

| Key or Button | Action |
|---------------|--------|
| 1 through 6 | Spell slots. 6 total slots. |
| Left Click | Cast the currently selected spell |
| Right Click | Cycle through Mana Shield modes |
| Scroll Wheel | Adjust Output percent from 1 to 100 |
| F key (hold) | Open spell wheel showing all learned spells |

### 7.3 Spell Slots

| Slot | Purpose |
|------|---------|
| 1 | Spell slot 1 |
| 2 | Spell slot 2 |
| 3 | Spell slot 3 |
| 4 | Spell slot 4 |
| 5 | Spell slot 5 |
| 6 | Spell slot 6 |

Players can assign any learned spell to any slot. There are no restrictions.

---

## 8. DEATH AND PERMANENT DELETION

### 8.1 Core Death Rule

When a character's Health reaches 0, the character is permanently deleted.

- No resurrection spells exist.
- No respawn at town exists.
- No ghost form exists.
- No appeals are accepted.

### 8.2 What Is Lost on Death

| Category | Lost? | Notes |
|----------|-------|-------|
| All stats (Mana Cap, level, XP) | Yes | Complete reset to zero |
| All inventory items | Yes | Every item in the inventory |
| All equipped gear | Yes | All armor and accessories |
| All spells | Yes | Must learn all spells again |
| All grimoire progress | Yes | Spell levels reset to 1 |
| All gold | Yes | Both inventory and bank |
| Guild memberships | Yes | Removed from all guilds |
| Guild territory contributions | Yes | Any claimed land is lost |
| Character name | Yes | After second death following rebirth |
| Admin powers (if admin) | Yes | Transferred according to succession rules |
| Karma | Yes | Reset to 0 |

### 8.3 What Remains After Death

| Category | Remains? | Notes |
|----------|----------|-------|
| Player account (email) | Yes | The player can still log in |
| Ability to create new character | Yes | Immediately available |
| Board of Legends entries | Yes | If the player earned a legend spot |

### 8.4 Six-Month Inactivity Kill

| Aspect | Value |
|--------|-------|
| Timer | 6 real months of character inactivity |
| Effect | Character is automatically marked as dead |
| Board of Legends eligibility | No |
| Name | Permanently taken |
| Account | Remains active |

### 8.5 Rebirth (Admin Only)

When an admin dies:

| Aspect | Detail |
|--------|--------|
| Name | The old name is NOT taken. The admin keeps the name. |
| Progress | Progress does NOT reset on the first death. |
| Second death | If the admin dies again after rebirth, the name becomes permanently taken. |
| Race | The admin can choose any race. No random selection. |
| Class | The admin can choose any class at Level 5. |
| Stats | Reset to normal player starting stats: 500 Mana Cap, 1000 Health, and so on. |

---

## 9. ADMIN SUCCESSION

### 9.1 Death Scenarios

| Cause of Death | Successor | Stat Transfer |
|----------------|-----------|---------------|
| Killed by NPC | The player ranked number 1 on the Power Board becomes the new admin. | No stat boost |
| Killed by player | The killer becomes the new admin. | Absorbs half of the previous admin's stats |
| /command assign_admin | The target player becomes an assigned admin. | No stat boost |

### 9.2 Stat Absorption Formula for Player Kill

```
Successor Mana Cap = Successor Mana Cap + (Previous Admin Mana Cap × 0.5)
Successor Health = Successor Health + (Previous Admin Health × 0.5)
Successor Level = Minimum of (Successor Level + (Previous Admin Level × 0.5), Previous Admin Level)
```

### 9.3 Admin Types

| Type | Creator Tag | Can Assign Admins | Can Revoke Admins | Power Board Position |
|------|-------------|-------------------|-------------------|---------------------|
| Original Admin | Yes | Yes | Yes | Number 0 |
| Assigned Admin | No | Only if given permission | Only if given permission | Normal rank |
| Successor Admin | No (unless the creator died) | Yes | Yes | Number 1 (moves to number 0 if creator dies) |

### 9.4 Admin versus Admin Combat

| Rule | Detail |
|------|--------|
| Admins cannot attack other admins | This is blocked at the server level. |
| Exception | None. This rule cannot be bypassed under any circumstances. |

### 9.5 Assign Admin Command

```
/command assign_admin <player> [give_assign_permission] [give_revoke_permission]
```

| Parameter | Effect |
|-----------|--------|
| give_assign_permission | Allows the assigned admin to assign other admins |
| give_revoke_permission | Allows the assigned admin to revoke other admins |

### 9.6 Succession Announcements

**When an admin dies to an NPC:**

```
╔═══════════════════════════════════════════════════════════════════════╗
║                    ✦ THE CROWN PASSES ✦                              ║
║         [Previous Admin Name] has fallen to the wilds.               ║
║              [New Admin Name] now holds the mantle.                  ║
║         [Previous Admin Name] begins anew as a mortal.               ║
╚═══════════════════════════════════════════════════════════════════════╝
```

**When an admin dies to a player:**

```
╔═══════════════════════════════════════════════════════════════════════╗
║                    ✦ USURPATION ✦                                    ║
║         [Previous Admin Name] has been slain by [Killer Name].       ║
║              [Killer Name] now holds the mantle.                     ║
║         [Previous Admin Name] begins anew as a mortal.               ║
╚═══════════════════════════════════════════════════════════════════════╝
```

---

## 10. BOARD OF LEGENDS

### 10.1 Legend Categories

| Category | Title Given | Requirement | Recorded Stat |
|----------|-------------|-------------|---------------|
| Longevity King or Queen | "The Eternal" | Most in-game days played | Days played counter |
| Massacre King or Queen | "The Reaper" | Most player kills | PvP kill counter |
| Paragon | "The Pure" | Longest streak with Karma above 100 | Consecutive days with positive karma |
| Beast Slayer | "The Annihilator" | Most monster kills | PvE kill counter |
| Corrupted | "The Fallen" | Longest streak with Karma below -50 | Consecutive days with negative karma |

### 10.2 Time System for Longevity

| Aspect | Value |
|--------|-------|
| Game start date | January 1, 1584 |
| One in-game day | 30 real minutes |
| One in-game week | 3.5 real hours |
| One in-game year | 182.5 real hours, which is approximately 7.6 real days |

**Longevity counts in-game days, not real days.**

### 10.3 Legend Replacement Rule

| Rule | Detail |
|------|--------|
| Only one legend per category | The single best player who ever lived in that category |
| Replacement condition | When a dying player's stat exceeds the current legend's stat |
| Previous legend | Moved to "Chronicles of the Fallen" which is a viewable history |
| No removal | Legends are never removed from history |

### 10.4 Display Format

The exact display format is:

```
[Category Title] ([Last Active Title]) [Name] [Achievement] "[Final Message]"
```

**Example:**

```
The Longevity King (Guild Master) John Doe Endured 1,234 days "I regret nothing."
```

### 10.5 Last Active Title Priority

| Priority | Source | Example |
|----------|--------|---------|
| 1 | Guild title | [Order of Light] Guild Master |
| 2 | Class title | Battlemage |
| 3 | Achievement title | The Eternal |
| 4 | Default | Adventurer |

### 10.6 Final Message Rules

| Rule | Value |
|------|-------|
| Maximum length | 200 characters |
| Custom message | Player can set this before death |
| Default message (no custom) | Victorian or Shakespearean style based on gender and category |
| Profanity filter | None |

**Default Messages by Category:**

| Category | Default Message |
|----------|-----------------|
| Longevity | "Their name was etched in eternity ere breath had fled. A life of consequence, now hallowed ground." |
| Massacre | "To the silent duelist — whose victories needed no herald. Only the fallen remember their face." |
| Paragon | "No word left their tongue, yet the light remembers what lips could not confess." |
| Beast Slayer | "Their legend speaks in silence — for deeds so thunderous need no mortal echo." |
| Corrupted | "They returned to the abyss without farewell. Shadows swallow their voice, yet we honor the quiet descent." |

---

## 11. LEGEND ANNOUNCEMENT SYSTEM

### 11.1 Trigger

When a new legend is carved into the Board of Legends (which occurs when a player dies and their stat exceeds the current record holder), a server-wide announcement is broadcast.

### 11.2 Announcement Format

The exact announcement text is:

```
══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══

    ✦ A LEGEND IS BORN ✦

    [Name] has been etched into the
    Board of Legends as [Title]

    [Achievement]

    Their story will never be forgotten.

══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══
```

### 11.3 Example

```
══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══

    ✦ A LEGEND IS BORN ✦

    John Doe has been etched into the
    Board of Legends as The Longevity King

    Endured 1,234 days

    Their story will never be forgotten.

══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══✧══
```

---

## 12. POWER BOARD

### 12.1 Power Score Formula

The exact Power Score formula is:

```
Power Score = 
    (Level × 100) +
    (Mana Cap × 1) +
    (Control × 50) +
    (Efficiency × 30) +
    (Cast Speed × 0.5) +
    (Resistance × 40) +
    (Focus × 10) +
    (Square Root of XP × 10) +
    (Spells Mastered × 200) +
    (Stamina Cap × 2) +
    (Stamina Regen × 5)
```

### 12.2 NOT Included in Power Score

| Excluded Stat | Reason |
|---------------|--------|
| Player kills | Belongs on the Board of Legends |
| Monster kills | Belongs on the Board of Legends |

### 12.3 Power Board Display

The exact display format is:

```
╔═══════════════════════════════════════════════════════════════════════╗
║                         ✦ POWER BOARD ✦                              ║
╠═══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║   RANK   NAME                    TITLE                POWER SCORE    ║
║                                                                       ║
║   ✦ 0    The Creator             [Original Admin]       198,472,310  ║
║   ✦ 1    The Architect           [Admin]                 98,472,310  ║
║   ✦ 2    Lord Vex                Dreadlord               6,231,445   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### 12.4 Update Frequency

| Aspect | Detail |
|--------|--------|
| Update trigger | Any stat change that affects Power Score |
| Real-time | Yes, updates immediately |
| Display refresh | Every 5 seconds for viewers |

---

## 13. GUILD SYSTEM

### 13.1 Guild Creation Requirements

| Requirement | Value |
|-------------|-------|
| Gold cost | 10,000 |
| Minimum level | 20 |
| Minimum spells learned | 5 |
| Minimum members to create | 3 (founder plus 2 accepted invites) |
| Minimum members to maintain | 1. The guild does not disband if members leave. |

### 13.2 Guild Ranks

| Rank Level | Default Title | Permissions |
|------------|---------------|-------------|
| 1 | Guild Master | All permissions |
| 2 | Officer | Invite, kick, bank access, territory claim |
| 3 | Veteran | Invite, bank access |
| 4 | Member | Bank access only |
| 5 | Recruit | No permissions |

### 13.3 Guild Bank

| Aspect | Value |
|--------|-------|
| Base slots | 50 |
| Upgrade cost | 5,000 gold per additional 10 slots |
| Maximum slots | 200 |
| Withdraw log retention | 30 days |

### 13.4 Guild Territory

**Claiming Territory Process:**

| Step | Action |
|------|--------|
| 1 | Guild must have at least 10 members |
| 2 | Guild Master purchases a Guild Banner for 5,000 gold |
| 3 | Guild Master places the banner on unused land |
| 4 | System checks: no other guild territory within 100 meters |
| 5 | Banner activation time: 60 seconds |
| 6 | Banner HP during activation: 5,000 |
| 7 | After activation: Territory radius = 50 meters |

**Territory Benefits:**

| Benefit | Effect |
|---------|--------|
| HP regeneration | +10 percent |
| Mana regeneration | +10 percent |
| Enemy marking | Enemies appear on the minimap |
| Guild bank access | Members can deposit and withdraw from the territory |

**Losing Territory:**

| Method | Detail |
|--------|--------|
| Banner destruction | The banner has 10,000 HP and can be attacked by anyone |
| Post-destruction cooldown | 5 minutes before another guild can claim the territory |
| Abandonment | The Guild Master can abandon territory via the guild UI |

---

## 14. GUILD VS GUILD WAR SYSTEM

### 14.1 Declaration Method

Wars are declared through the UI only. There is no command.

| Step | Action |
|------|--------|
| 1 | Open the Guild UI |
| 2 | Select the "Diplomacy" tab |
| 3 | Select a target guild from the list. The target guild must have at least 5 members. |
| 4 | Click "Declare War" |
| 5 | Confirm. This costs 5,000 gold from the guild bank. |

### 14.2 War Rules

| Rule | Value |
|------|-------|
| Duration | 7 days (168 hours) |
| Early end | Mutual agreement via the `/guild peace` vote |
| Territory claim cooldown | Disabled during the war |
| XP bonus for kills | +25 percent XP when killing enemy guild members |
| Winning guild reward | 10,000 gold taken from the losing guild's bank |

### 14.3 War End Conditions

| Condition | Result |
|-----------|--------|
| Time expires (7 days) | No winner. No reward. |
| Mutual peace | No winner. No reward. |
| One guild disbands | The other guild automatically wins. |

### 14.4 War UI Elements

| Element | Description |
|---------|-------------|
| War Status | Shows active wars and duration remaining |
| Kill Feed | Shows guild versus guild kills in chat |
| War Score | Shows the kill difference |
| Declare War button | Only appears for guilds with 10 or more members |

---

## 15. PARTY SYSTEM

### 15.1 Party Rules

| Aspect | Value |
|--------|-------|
| Maximum size | 5 players |
| Friendly fire | Off. Party members cannot damage each other. |
| Overcast | Does not hit party members |
| XP sharing | 50 percent split among party members within 50 tiles |
| Visual identification | Green outline around party members |

### 15.2 Party UI Buttons

| Button | Effect |
|--------|--------|
| Create Party | The player becomes the leader. A new party is created. |
| Invite | Click on a player to send an invite. |
| Kick | The leader removes a member. |
| Leave | The player exits the party. |
| Disband | The leader destroys the party. All members leave automatically. |

---

## 16. SPELL SYSTEM (CORE SPELLS)

### 16.1 Cooldown Rules

| Spell Type | Cooldown |
|------------|----------|
| Standard spells | 0 seconds. Mana cost only. |
| Terrain-altering spells | Short cooldowns as specified below |

### 16.2 Starter Spells

Every player starts with these spells:

| Spell | Mana Cost | Effect | Base Damage |
|-------|-----------|--------|-------------|
| Mana Bolt | 50 | Fires a bolt of pure mana | 1.0x |
| Mana Shield | 100 | Creates a magical shield | Not applicable |

### 16.3 Terrain-Altering Spells

| Spell | Mana Cost | Cooldown | Effect | HP |
|-------|-----------|----------|--------|-----|
| Earth Wall | 500 | 10 seconds | Creates a 3-tile-wide wall of earth that blocks movement | 500 |
| Stone Pillar | 300 | 5 seconds | Creates a 1 by 1 pillar. Players can stand on top. Blocks projectiles. | 300 |
| Ice Wall | 450 | 12 seconds | Creates a 3-tile-wide wall of ice. Movement is slippery. | 400 |
| Stone Shield | 400 | 8 seconds | Creates a floating stone wall object with a custom sprite | 600 |

### 16.4 Mana Bolt Scaling

| Spell Level | Damage | Mana Cost | Bonus Effect |
|-------------|--------|-----------|--------------|
| 1 | 1.0x | 50 | None |
| 2 | 1.1x | 47 | None |
| 3 | 1.2x | 44 | None |
| 4 | 1.3x | 41 | None |
| 5 | 1.4x | 38 | -5 percent mana cost |
| 6 | 1.5x | 35 | None |
| 7 | 1.6x | 32 | None |
| 8 | 1.7x | 29 | None |
| 9 | 1.8x | 26 | None |
| 10 | 2.0x | 20 | +1 projectile |

### 16.5 Mana Detection Spell

This is the third spell players can learn.

| Spell Level | Range | Type | Effect |
|-------------|-------|------|--------|
| 1 | 5 meters | Active | Reveals Mana Cap of targets in range |
| 2 | 10 meters | Active | Reveals Mana Cap of targets in range |
| 3 | 15 meters | Active | Reveals Mana Cap of targets in range |
| 4 | 20 meters | Active | Reveals Mana Cap of targets in range |
| 5 | 25 meters | Active | Reveals Mana Cap of targets in range |
| 6 | 30 meters | Active | Reveals Mana Cap of targets in range |
| 7 | 35 meters | Active | Reveals Mana Cap of targets in range |
| 8 | 40 meters | Active | Reveals Mana Cap of targets in range |
| 9 | 45 meters | Active | Reveals Mana Cap of targets in range |
| 10 | 100 meters | Passive | Always active. Reveals Mana Cap automatically. |

---

## 17. GRIMOIRE AND SPELL LEVELING SYSTEM

### 17.1 Grimoire Rules

| Rule | Detail |
|------|--------|
| Grimoires do not have levels | They are consumable items. |
| First use of a grimoire | The player learns the spell. The grimoire is consumed. |
| Subsequent uses of the same grimoire | The spell gains XP. The grimoire is consumed. |

### 17.2 Spell XP Requirements

| Spell Level | XP Required for This Level | Total XP Required |
|-------------|---------------------------|-------------------|
| 1 | 0 | 0 |
| 2 | 100 | 100 |
| 3 | 150 | 250 |
| 4 | 250 | 500 |
| 5 | 500 | 1,000 |
| 6 | 500 | 1,500 |
| 7 | 500 | 2,000 |
| 8 | 500 | 2,500 |
| 9 | 500 | 3,000 |
| 10 | 2,000 | 5,000 |

### 17.3 XP Sources

| Source | XP Gained |
|--------|-----------|
| Using a duplicate grimoire | +50 XP |
| Finding a duplicate grimoire in a chest | +25 XP |
| Receiving a duplicate grimoire in a trade | +50 XP when used |

### 17.4 Grimoire Rarity and XP Value

| Rarity | Drop Rate | XP Value (if duplicate) |
|--------|-----------|-------------------------|
| Common | Common | 25 XP |
| Uncommon | Uncommon | 50 XP |
| Rare | Rare | 75 XP |
| Epic | Very Rare | 100 XP |
| Legendary | Extremely Rare | 150 XP |
| Artifact | Mythic (bosses only) | 200 XP |

---

## 18. SPELL CREATION SYSTEM (ADMIN) — COMPLETE UI SPECIFICATION

### 18.1 Access

**Command:** `/command create_spell`

This opens the Spell Creation UI. All fields described below are required. There are no elements. There is only one damage type: DAMAGE.

---

### SECTION 1 – BASIC IDENTITY

| Field | Control Type | Options or Range | Required | Default |
|-------|--------------|------------------|----------|---------|
| Spell Name | Text input | 3 to 50 characters, alphanumeric plus spaces | Yes | "New Spell" |
| Spell Description | Multiline text | Maximum 300 characters | Yes | Empty string |
| Spell Icon | Asset picker | 64 by 64 pixel PNG from the asset library | Yes | Default icon |
| Spell Tags (internal) | Tag input | Freeform, comma separated | No | Empty string |

---

### SECTION 2 – LEARNING AND CASTING ACCESS

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Can be cast without being selected? | Toggle | Yes or No | No |
| Must be on hotbar to cast? | Toggle | Yes or No | Yes |
| Incantation required? | Toggle | Yes or No | No |
| Incantation text | Text input | Maximum 100 characters | Empty string |
| Incantation can be whispered? | Toggle | Yes or No | Yes |
| Minimum player level to learn | Integer spinner | 0 to 100 (0 means no requirement) | 0 |
| Required quest flag | Dropdown | None, QuestAComplete, QuestBComplete, and so on | None |

---

### SECTION 3 – TARGETING

| Field | Control | Options (exact) | Default |
|-------|---------|------------------|---------|
| Target scope | Dropdown | Self, Single Enemy, Single Ally, Single Any Character, Area Sphere, Area Cone, Area Line, Projectile (aimed), Ground Location, All Enemies In Line of Sight, Random Enemy Within Radius | Single Enemy |
| Can target self? | Toggle | Yes or No | No |
| Range | Float slider | 0 to 100 meters | 10 |
| Line of sight required? | Toggle | Yes or No | Yes |
| Ignores friendly fire protection? | Toggle | Yes or No | No |

---

### SECTION 4 – MANA COST

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Base mana cost | Integer | 0 to 9999 | 50 |
| Mana cost scaling | Dropdown | None, Per Target, Per Second, Per Use | None |
| Scaling value | Integer | 0 to 9999 | 0 |
| Minimum mana to cast | Integer | 0 to 9999 | 0 |
| Can be cast with 0 mana? | Toggle | Yes or No | No |
| Alternative resource type | Dropdown (if above is Yes) | Health, Stamina, XP, Gold | Health |
| Alternative resource amount | Integer | 0 to 9999 | 0 |

---

### SECTION 5 – CASTING TIME AND COOLDOWN

| Field | Control | Options or Range | Default |
|-------|---------|------------------|---------|
| Casting time | Float slider | 0 to 10 seconds | 0 |
| Can be interrupted during cast? | Toggle | Yes or No | Yes |
| Cooldown (seconds) | Float slider | 0 to 300 seconds | 0 |
| Cooldown applies to | Dropdown | Per Caster, Per Target | Per Caster |
| Max charges | Integer spinner | 1 to 10, with an "Unlimited" checkbox | Unlimited |
| Charge refill method | Dropdown (if charges are finite) | Every X seconds, On Rest, On Kill, On Taking Damage | Every X seconds |
| Charge refill interval (if applicable) | Integer | 1 to 300 seconds | 10 |

---

### SECTION 6 – EFFECTS (CORE)

Effects are built as a list. The admin can Add Effect, Remove Effect, and Reorder Effects using a drag handle. Effects execute in order from top to bottom.

#### 6.1 Common Effect Fields (All Effects)

| Field | Control | Options or Range | Default |
|-------|---------|------------------|---------|
| Effect type | Dropdown | See section 6.3 | Damage |
| Delay before this effect | Float slider | 0 to 30 seconds | 0 |
| Duration | Float slider | 0 to 300 seconds (0 means instant) | 0 |
| Magnitude | Float slider | 0 to 9999 | 0 |
| Magnitude meaning | Dropdown | Flat Value, Percentage of Max Health, Percentage of Current Health, Percentage of Missing Health | Flat Value |
| Apply to | Dropdown | Target, Caster, All in Area, Random in Area | Target |
| Chance to apply (percent) | Integer spinner | 0 to 100 | 100 |

#### 6.2 Effect Modifiers (Checkboxes - Can Be Combined)

| Field | Description |
|-------|-------------|
| Also affects caster? | The same effect applies to the caster. |
| Also affects allies in radius? | Requires an area target scope. |
| Can backfire? | There is a 10 percent chance the effect hits the caster instead. |
| Can be resisted? | The target gets a resistance roll. |
| Resistance type (if Can be resisted is checked) | Physical, Magical, or Pure (irresistible) |

#### 6.3 Effect Type Dropdown (Complete List)

| Category | Values |
|----------|--------|
| Damage | Damage (only one type) |
| Healing | Heal_Instant, Heal_OverTime, Heal_PercentMax, Heal_PercentMissing |
| Shields | Shield_Physical, Shield_Magical, Shield_All, Shield_PercentMax |
| Buffs | Buff_Damage, Buff_Speed, Buff_CritChance, Buff_Armor, Buff_MagicResist, Buff_ManaRegen |
| Debuffs | Debuff_Slow, Debuff_Stun, Debuff_Silence, Debuff_Blind, Debuff_Taunt, Debuff_Disarm, Debuff_WeakenDamage, Debuff_Vulnerability |
| Control | Control_Fear, Control_Charm, Control_Root, Control_Push, Control_Pull, Control_LaunchAirborne, Control_Knockdown |
| Teleport | Teleport_Self, Teleport_Target, Teleport_RandomWithinRange, Teleport_ToWaypoint, Teleport_SwapPositions |
| Transform | Transform_Polymorph, Transform_Enlarge, Transform_Shrink, Transform_GhostForm, Transform_Statue |
| Summon | Summon_Creature, Summon_Object, Summon_Turret, Summon_Clone |
| Illusion | Illusion_Invisibility, Illusion_DisguiseAsFaction, Illusion_CreateFakeCaster, Illusion_MirageArea |
| Time | Time_SlowProjectiles, Time_StopSelf, Time_RewindPosition, Time_RewindHealth |
| Utility | Utility_OpenLock, Utility_RepairItem, Utility_EnchantWeaponTemp, Utility_PlantGrowth, Utility_DispelMagic |
| Sacrificial | Sacrifice_HealthToMana, Sacrifice_ManaToHealth, Sacrifice_ItemDurabilityToDamage |
| Custom | Custom_TriggerBlueprintEvent |

#### 6.4 Per-Effect Condition

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Enable condition | Checkbox | Yes or No | No |
| Condition type (if enabled) | Dropdown | TargetHPBelowXPercent, TargetHasBuff, TargetIsAirborne, TargetIsBoss, CasterHPBelowXPercent, CombatTimeMoreThanXsec | TargetHPBelowXPercent |
| Condition value (if applicable) | Float slider | 0 to 100 | 50 |

---

### SECTION 7 – STATUS EFFECTS (PERSISTENT)

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Apply existing status effect on target | Dropdown | None, Bleeding, Cursed, Hasted, Stunned, and so on | None |
| Apply existing status effect on caster | Dropdown | As above | None |
| Create new custom status effect | Button | Not applicable | Not applicable |

**Custom Status Effect Editor (opens a new window):**

| Field | Control | Options |
|-------|---------|---------|
| Status name | Text input | 3 to 30 characters |
| Duration | Float slider | 0 to 300 seconds |
| Tick interval | Float slider | 0 to 10 seconds (0 means no tick) |
| Icon | Asset picker | 32 by 32 pixel PNG |
| Modifiers | Multiple checkboxes | Damage, Heal, Slow, Stun, Silence, and so on |
| Magnitude | Float slider | 0 to 9999 |

---

### SECTION 8 – SPELL CHAINS AND REACTIONS

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| On successful hit, cast another spell | Dropdown | None or any existing spell ID | None |
| On full resist, cast another spell | Dropdown | None or any existing spell ID | None |
| On kill, cast another spell | Dropdown | None or any existing spell ID | None |
| If caster dies during cast, cast spell on death | Dropdown | None or any existing spell ID | None |

---

### SECTION 9 – VISUAL AND AUDIO (COSMETIC ONLY)

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Cast particle effect | Asset picker | VFX asset library | None |
| Travel particle (projectile only) | Asset picker | VFX asset library | None |
| Hit particle | Asset picker | VFX asset library | None |
| Cast sound | Asset picker | Sound asset library | None |
| Hit sound | Asset picker | Sound asset library | None |

---

### SECTION 10 – LIMITS AND RESTRICTIONS

| Field | Control | Options | Default |
|-------|---------|---------|---------|
| Max casts per combat encounter | Integer spinner | 0 to 100 (0 means unlimited) | 0 |
| Cannot be used in PvP zones | Toggle | Yes or No | No |
| Cannot be used on raid bosses | Toggle | Yes or No | No |
| Cannot target players under level X | Integer spinner | 0 to 100 | 0 |
| Exhaustion after use | Dropdown | None, Mana burn (lose X mana over 10 seconds), Silence self for X seconds, Health drain | None |
| Exhaustion value (if applicable) | Integer | 0 to 9999 | 0 |

---

### SECTION 11 – ADMIN METADATA

| Field | Control | Notes |
|-------|---------|-------|
| Spell ID | Read-only text | Auto-generated on save |
| Version number | Integer spinner | Increments on each save |
| Active in game? | Toggle | If No, the spell is not available to players |
| Admin notes | Multiline text | Not shown to players |

---

### SECTION 12 – TEST AND VALIDATE

| Field | Control | Description |
|-------|---------|-------------|
| Test in sandbox mode | Button | Opens a preview with a dummy target (1000 HP, 500 Mana Cap) |
| Validate spell rules | Button | Checks for infinite loops, impossible conditions, and mana cost exceeding mana cap |
| Spell complexity warning | Label (auto) | Low, Medium, or High based on effect count and chains |

---

### 18.2 Example Spell: "Blood for Blood"

| Field | Value |
|-------|-------|
| Name | Blood for Blood |
| Description | Sacrifice your own health to damage an enemy |
| Incantation | "My pain becomes yours" |
| Target scope | Single Enemy |
| Range | 10 meters |
| Base mana cost | 0 |
| Can be cast with 0 mana? | Yes |
| Alternative resource | Health |
| Alternative resource amount | 30 |
| Casting time | 0 (instant) |
| Cooldown | 15 seconds |
| Effects (order matters) | 1. Damage, magnitude 50, apply to target. 2. Damage, magnitude 25, apply to caster with "Also affects caster" checked. |
| On kill cast | Second Wind (spell ID 42) |

---

## 19. COMBAT AND MAGIC

### 19.1 Complete Control Reference

| Key or Button | Action | Cooldown | Cost |
|---------------|--------|----------|------|
| W, A, S, D | Move | None | None |
| Up Arrow, Down Arrow | Adjust movement speed by plus or minus 5 percent | None | None |
| Left Shift | Sprint | None | 15 stamina per second |
| 1 through 6 | Select spell slot | None | None |
| Q | Dash | 3 seconds | 2 percent of mana |
| R | Aura Release | 60 seconds | 50 mana |
| C | Compression (toggle) | None | 25 mana per second |
| V | Mana Detection Pulse | None | 75 mana |
| E | Inventory | None | None |
| G | Arm Overcast | None | None |
| F (hold) | Spell wheel | None | None |
| Tab (hold) | Player list | None | None |
| Left Click | Cast selected spell | Spell-specific | Spell-specific |
| Right Click | Cycle Mana Shield modes | None | None |
| Scroll Wheel | Adjust Output percent (1 to 100) | None | None |
| T | Proximity chat | 3 seconds | None |
| L | Combat log (toggle) | None | None |
| Ctrl + Click | Select object to control | None | None |
| Z + Hold + Move Mouse | Move selected objects | None | None |
| Alt + Click | Move a random controlled object to the cursor | None | None |
| Alt + Double Click | Throw a random controlled object | None | None |

### 19.2 Output Percent UI Feature

When scrolling to change Output percent while a spell is selected:

| Feature | Detail |
|---------|--------|
| Display | Shows the total damage the spell will inflict at the current Output percent |
| Real-time | Updates as the player scrolls |
| Location | Floating text next to the cursor |

### 19.3 Overcast System (G Key)

| Aspect | Detail |
|--------|--------|
| Activation | Press G. The cursor becomes a red crosshair. The chat displays "Overcasting..." |
| Duration to cast | 10 seconds |
| Requirement | The player must have at least 50 percent of their current mana |
| Failure condition | If below 50 percent, the cast becomes a normal cast |
| Cost | 100 percent of current mana |
| Damage | 5 times normal damage. This ignores the One-Shot Rule. |
| Restriction | Cannot be used within 50 meters of any city or guild territory |

**Overcast Debuffs (apply to the caster after casting):**

| Debuff | Duration | Effect |
|--------|----------|--------|
| Mana Void | 10 seconds | Negative 100 percent Mana Regen |
| Mana Fracture | 30 seconds | Output percent capped at 50 percent |
| Spell Lockout | 60 seconds | That specific spell is disabled |
| Aura Flare | 3 seconds | Break Compression, minimap ping, and screen shake |

### 19.4 Aura Release (R Key)

| Aspect | Detail |
|--------|--------|
| Effect | Releases a visible aura of mana |
| Cost | 50 mana |
| Visual | Mana erupts from the caster's body in a 5 meter radius |
| Does NOT break compression | Mana Detection still sees the compressed value |

### 19.5 Player List (Tab Key)

| Aspect | Detail |
|--------|--------|
| Display | List of all players currently online in the server |
| Information shown | Player name and current state |
| States | In-combat (5 seconds after last damage), Walking, Idle, AFK (20 seconds with no input) |
| Background | Transparent with 80 percent opacity black |
| Movement | Players can still move and act while holding Tab |

---

## 20. MANA DETECTION, PULSE, COMPRESSION AND FOCUS

### 20.1 Mana Detection Spell

| Aspect | Detail |
|--------|--------|
| Type | Active for levels 1 through 9. Passive at level 10. |
| Effect | Reveals the Mana Cap of targets in range |
| Range | See section 16.5 |
| Cannot bypass Compression | Shows the compressed value (100 to 500) |

### 20.2 Mana Detection Pulse (V Key)

| Aspect | Detail |
|--------|--------|
| Effect | Reveals mana sources on the minimap |
| Range | 50 meters (fixed) |
| Cost | 75 mana |
| Duration | 5 seconds |
| What it finds | Entities using mana (players casting, monsters, NPCs) |
| Can be hidden by | High Focus (see section 20.4) |

### 20.3 Compression (C Key)

| Aspect | Detail |
|--------|--------|
| Toggle | Press C to turn on. Press C again to turn off. |
| Cost | 25 mana per second (fixed) |
| Auto-off condition | When mana drops below 50 |
| Effect on Mana Detection | Shows a fake value (random between 100 and 500) |
| Visual | No visual change. The character looks normal. |
| Effect on Pulse | Reduces detection range based on Focus |

### 20.4 Focus Stat

| Aspect | Detail |
|--------|--------|
| Starting value | 10 |
| Effect on Detection | Detection Chance = Max of 0, (Attacker Mana Cap ÷ Defender Focus) × 0.1 |
| Effect on Pulse | Higher Focus reduces the range at which Pulse detects the player |
| Gained through | Level up rewards and gear |

**Focus Detection Examples:**

| Defender Focus | Attacker Mana Cap | Detection Chance |
|----------------|-------------------|------------------|
| 10 | 1,000 | 10 percent |
| 10 | 10,000 | 100 percent |
| 100 | 10,000 | 10 percent |
| 100 | 100,000 | 100 percent |
| 500 | 100,000 | 20 percent |
| 500 | 1,000,000 | 200 percent (always detected) |

---

## 21. MANA SHIELD SYSTEM

### 21.1 Mana Shield Spell (Starter Spell)

| Aspect | Detail |
|--------|--------|
| Activation mana cost | 100 mana |
| Sustain cost | 20 mana per second |
| Output percent scaling | Higher Output percent creates a stronger and bigger shield |

### 21.2 Four Shield Modes (Cycle with Right Click)

| Mode | Visual | Effect | Output Percent Scaling |
|------|--------|--------|----------------------|
| 1. Surround | Shield encircles the caster | Protects the caster and nearby allies in a radius | Larger radius from 1 to 5 meters |
| 2. Wall | Rectangle wall in front that rotates with the cursor | Blocks projectiles from the front | Thicker wall from 100 to 1000 HP |
| 3. Flying | Shield follows the cursor position | Precision blocking | Thicker width from 100 to 1000 HP |
| 4. Automatic | Shield automatically blocks incoming attacks | Blocks from any direction within range | Wider range from 1 to 10 meters, faster reaction from 0.5 to 0.1 seconds, thicker shield from 100 to 1000 HP |

### 21.3 Shield HP Formula

```
Shield HP = 100 + (Output percent × 10) × (ManaCap ÷ 500)
```

| ManaCap | Output percent | Shield HP |
|---------|----------------|-----------|
| 500 | 20 percent | 100 + (20 × 10) × (500 ÷ 500) = 100 + 200 × 1 = 300 HP |
| 500 | 100 percent | 100 + (100 × 10) × 1 = 100 + 1,000 = 1,100 HP |
| 1,000 | 50 percent | 100 + (50 × 10) × (1,000 ÷ 500) = 100 + 500 × 2 = 1,100 HP |
| 10,000 | 100 percent | 100 + (100 × 10) × (10,000 ÷ 500) = 100 + 1,000 × 20 = 20,100 HP |

---

## 22. POTIONS AND SUSTAINANCE

### 22.1 Potions

| Potion | Effect | Source | Approximate Cost |
|--------|--------|--------|------------------|
| Mana Potion | Restores 25 percent of maximum mana | Alchemist NPC | 50 gold |
| Health Potion | Restores 25 percent of maximum health | Healer NPC | 50 gold |
| Antidote | Cures poison | Elven Mage NPC | 100 gold |
| Holy Water | Removes curses | Priest NPC | 150 gold |

### 22.2 Hunger System

| Aspect | Detail |
|--------|--------|
| Hunger Bar | Hidden stat ranging from 0 to 100 |
| Decay rate | 1 point every 5 minutes |
| Effect when low (0 to 20) | Mana depletes 2 times faster, even when idle |
| Food sources | Wandering traders and city merchants |
| Food cost | 10 to 100 gold |
| Food restores | 20 to 50 hunger points |

### 22.3 NPC Merchant Stock

| Rule | Detail |
|------|--------|
| Merchants have limited stock | Finite quantity of items |
| Merchants have limited gold | For buying items from players |
| Restock time | 1 real hour |
| Restock amount | Full restock |

---

## 23. ECONOMY AND CURRENCY

### 23.1 Gold Sources

| Source | Gold Gained | Formula |
|--------|-------------|---------|
| Killing monsters | Variable | Monster ManaCap ÷ 100 |
| Killing players | Variable | 5 to 15 percent of carried gold |
| Selling wood | 5 gold per wood | Fixed |
| PvP bounty | Variable | Bounty amount |
| Tournament rewards | Variable | Admin-configured |
| Daily rewards | Variable | See section 33 |
| Chests from bosses | Variable | Random between 100 and 5,000 gold |

### 23.2 Wood Gathering

| Aspect | Detail |
|--------|--------|
| Method | Attack trees with spells |
| Tree HP | 50 to 200 depending on tree size |
| Wood per tree | 1 to 5 wood |
| Wood value | 5 gold per wood to the Lumber Merchant |
| Respawn time | Trees respawn after 10 minutes |

### 23.3 Gold Sinks

| Sink | Cost |
|------|------|
| Health Potion | 50 gold |
| Mana Potion | 50 gold |
| Antidote | 100 gold |
| Holy Water | 150 gold |
| Food | 10 to 100 gold |
| Guild creation | 10,000 gold |
| Guild banner | 5,000 gold |
| Guild bank upgrade | 5,000 gold per additional 10 slots |
| War declaration | 5,000 gold |
| Name change (gold option) | 10,000 gold |
| Respec | 50,000 gold |

---

## 24. NPC SYSTEM (COMPLETE LIST)

### 24.1 Essential NPCs

| NPC Type | Behavior | Location | Sells or Buys | Created By |
|----------|----------|----------|---------------|-------------|
| Spell Merchant | Stationary | Cities | Basic grimoires (Common and Uncommon) | Admin |
| Armor Smith | Stationary | Cities | Armor. Also repairs armor. | Admin |
| Alchemist | Stationary | Cities | Mana Potions and Health Potions | Admin |
| Priest | Stationary | Cities | Holy Water and curse removal service | Admin |
| Healer | Stationary | Cities | Health Potions and healing service (50 gold) | Admin |
| General Merchant | Stationary | Cities | Food, basic supplies. Buys wood. | Admin |
| Lumber Merchant | Stationary | Cities | Buys wood for 5 gold each | Admin |
| Elven Mage | Stationary | Cities or forests | Antidote and poison removal | Admin |
| Wandering Trader (Horse) | Wandering | Travels routes | Food and rare items | Admin |
| Wandering Trader (Cart) | Wandering | Travels routes | Bulk goods and supplies | Admin |
| Wandering Trader (Caravan) | Wandering | Travels routes | High-value goods | Admin |
| Guard (Staff only) | Patrol or Stationary | Cities and gates | None. Attacks enemies. | Admin |

### 24.2 Special NPC: Nica (Operating System)

| Aspect | Detail |
|--------|--------|
| Name | Nica |
| Title | "Operating System" |
| Quantity | Only one in the entire game |
| Power Board | Does not appear |
| Weapons | None. Uses spells only. |
| Spells | Knows all spells |
| Personality | Kind, professional, straight, noble, does not spam |
| Communication | Uses a smart AI system. Uses proximity chat. Can use /call and /sendloc commands. |
| Commands | Can use almost all admin commands EXCEPT assigning and revoking admins |
| Combat | Avoids conflict. If attacked, can teleport away or fight and leave. |
| Report spam | Does not spam reports. |

### 24.3 Optional NPCs (Admin Can Create)

| NPC Type | Function | Behavior |
|----------|----------|----------|
| Mage (Friendly) | Casts spells to defend an area | Defensive |
| Mage (Aggressive) | Attacks on sight | Aggressive |
| Quest-less NPC | Decorative, provides flavor text | Stationary |
| Vendor (Specialty) | Sells rare items | Stationary |
| Blacksmith | Sells high-end armor | Stationary |
| Enchanter | Sells temporary buff items | Stationary |

### 24.4 NPC Commands

| Command | Effect |
|---------|--------|
| `/command create_npc` | Opens the NPC editor UI |
| `/command delete_npc <id>` | Deletes the NPC with the specified ID |
| `/command edit_npc <id>` | Opens the NPC editor for the existing NPC |
| `/command npc_list` | Shows all NPCs with their IDs |
| `/command summon_npc <id>` | Summons the NPC to the admin's current location |

---

## 25. NPC LORE AND STORY GENERATION

### 25.1 How NPCs Learn

| Event | Memory Created | Storage |
|-------|----------------|---------|
| Player visits the NPC | "Player [name] visited me on [date]" | Last 10 visitors |
| Player helps the NPC (defends from attack) | "Player [name] defended this area" | Permanent |
| Player attacks the NPC | "Player [name] attacked me" | Permanent |
| Player trades with the NPC | "Player [name] traded [item] for [item]" | Last 20 trades |
| Player kills a nearby monster | "Player [name] defended this area" | Permanent |
| Player dies near the NPC | "Player [name] fell nearby" | Permanent |

### 25.2 Story Generation

When a player talks to an NPC, the NPC may generate stories based on memories:

| Memory Type | Example Response |
|-------------|------------------|
| Player helped | "Ah, [Player Name]. I remember when you helped me defend against those wolves. A brave soul you are." |
| Player attacked | "I remember you, [Player Name]. You struck me once. I have not forgotten." |
| Player died | "A somber day, that was. When [Player Name] fell to the Pig King. The town still speaks of it." |

### 25.3 Victorian Language Toggle

Players can toggle Victorian English for NPC conversations in the Settings UI.

| Toggle On | Toggle Off |
|-----------|------------|
| "Thou art welcome, traveler." | "You are welcome, traveler." |
| "Pray, what business brings thee?" | "What brings you here?" |
| "I hath not seen thee in a fortnight." | "I haven't seen you in two weeks." |

---

## 26. ENEMY SYSTEM

### 26.1 Piglins

| Type | Weapon | HP | Damage | Behavior |
|------|--------|----|----|----------|
| Piglin Mage | Magic attacks | 500 | 50 | Attacks on sight. Steals gold from dead players. |
| Piglin Crossbow | Crossbow | 400 | 40 | Attacks on sight. Ranged attacker. |
| Pig King (Boss) | Greatsword | 5,000 | 150 | Never leaves territory. Drops a chest plus gold. |

**Patrol Groups:** 3 Mages and 2 Crossbows

**Pig King Territory:**

| Aspect | Detail |
|--------|--------|
| Placement | The admin places a Pig King Throne entity |
| King summons | 2 patrol groups and 1 territory defense group |
| Territory defense | 2 crossbows beside the king, 3 crossbows patrol inside, 5 mages patrol inside, 5 mages patrol outside |
| When the king is attacked | All guards rush to the king's location |

**Piglin Interactions:**

| Event | Result |
|-------|--------|
| Two patrol groups from different kings meet | They fight each other |
| A patrol reaches another king's territory | It attempts to attack the king |
| The king dies | The territory disappears. The remaining piglins hunt the killer everywhere. City protection does not work. |
| Respawn | The king respawns after 2 hours. Patrols respawn after 30 minutes. |

### 26.2 Werewolves (Black Wolves)

| Type | Weapon | HP | Damage | Behavior |
|------|--------|----|----|----------|
| Werewolf Mage | Magic attacks | 400 | 45 | Fast movement |
| Werewolf Crossbow | Crossbow | 350 | 35 | Ranged attacker |
| Werewolf Patrol Leader | Magic attacks (enhanced) | 600 | 60 | Leads a patrol |
| Wolf Boss (Boss) | Greatsword | 8,000 | 200 | Leads 2 patrol groups |

**Patrol Groups:** 1 Leader, 2 Crossbows, and 4 Mages

**Wolf Boss Mechanics:**

| Aspect | Detail |
|--------|--------|
| Placement | The admin places a Wolf Boss entity |
| Boss summons | 2 Patrol Leaders that follow him (2 full patrol groups) |
| Leader summons | Can summon mage and crossbow wolves |
| Leader limit | 2 patrol groups maximum per Wolf Boss |

**Respawn and Summon Mechanics:**

| Event | Cooldown |
|-------|----------|
| A wolf dies in a group | The leader summons a replacement after 5 minutes |
| Multiple wolves die | 5 minutes between each summon |
| A Patrol Leader dies | The Wolf Boss summons a new leader after 30 minutes |
| Living wolves | Existing wolves join the nearest group |
| Wolf Boss respawn | 2 hours after death |

**Death of Wolf Boss:** The remaining werewolves hunt the killer everywhere for 1 hour.

### 26.3 Minotaurs

| Type | Weapon | HP | Damage | Behavior |
|------|--------|----|----|----------|
| Minotaur (Wood) | Magic attacks | 300 | 25 | Peaceful. Attacks only when damaged. Drops a wood basket. |
| Minotaur (Gold) | Magic attacks | 300 | 25 | Peaceful. Attacks only when damaged. Drops a gold basket containing 100 to 500 gold. |
| Minotaur Brute | Battle Axe | 1,500 | 100 | Peaceful. Wanders alone. Higher HP and higher damage. |

**Minotaur Brute Aggro Rule:**

| Action | Consequence |
|--------|-------------|
| Killing 5 Minotaurs anywhere | The 2 closest Brutes hunt the player for 5 minutes |
| Protection | City protection does NOT work |
| Drops | XP and 50 to 200 gold. No chest. |

### 26.4 Boss Drops

| Boss | Guaranteed Drop | Chance Drop | Chest |
|------|----------------|-------------|-------|
| Pig King | Grimoire (100 percent) | None | Yes. Contains gold from collected loot. |
| Wolf Boss | Grimoire (100 percent) | None | Yes. Contains gold and items. |
| Minotaur Brute | None | None | No |

**Chest System:**
- The boss leaves a chest at its death location.
- The chest persists for 5 minutes.
- Opening the chest opens a UI grid of 5 by 5 slots (25 slots total).
- Players can take items or leave items in the chest.
- The chest disappears when empty or after 5 minutes.

---

## 27. WORLD BUILDING SYSTEM (ADMIN ONLY)

### 27.1 Build Modes

| Mode | Command | Scope | Who | Writes to |
|------|---------|-------|-----|-----------|
| Global Build | `/command server_edit` | Affects all servers | Admin only | template_world |
| Local Build | `/command world_edit` or `/command we` | Current server only | Admin and Operator | server_N.chunk_overrides |

### 27.2 Build Controls

| Key | Action |
|-----|--------|
| B | Toggle build mode on and off |
| WASD plus Space or Ctrl | Noclip fly (move through walls and ground) |
| N | Toggle noclip on and off |
| Left Click | Place the selected tile, prop, monster, or NPC |
| Right Click | Delete the tile, prop, monster, or NPC |
| Scroll | Cycle through variants of the current tile or prop |
| Shift plus Scroll | Change brush size from 1 by 1 to 9 by 9 |
| T plus Drag | Bulk fill a rectangular area |
| T plus Right Drag | Bulk delete a rectangular area |
| F | Open the Build Wheel (Tiles, Structures, Props, Monsters, NPCs, Objects) |
| Ctrl plus S | Save the current chunk and neighboring chunks |
| Ctrl plus Z | Undo the last 50 actions |

### 27.3 City and Spawn System

| Rule | Detail |
|------|--------|
| No central_hall means no city, no spawn, and spectator mode | Players cannot spawn |
| Central hall size | 9 by 9 tiles (288 by 288 pixels) |
| Central hall HP | 500,000 |
| Central hall invulnerability | During build mode only |
| Board of Legends | Automatically placed in the town center when a city is created |

**Creating a City:**

| Step | Action |
|------|--------|
| 1 | Press B to enter build mode |
| 2 | Press F to open the Build Wheel |
| 3 | Select Structures, then central_hall |
| 4 | Left Click to place the building |
| 5 | A popup appears asking for: City Name (text), Radius (25 to 500 meters), Spawn Type (Public, Guild-Only, or Locked) |
| 6 | Confirm. The city exists. |

**Spawn Priority:**
1. Guild Base (if the guild has territory with a spawn point)
2. Last City (where the player last spawned)
3. Random Public City
4. Spectator Mode (if no public cities exist)

### 27.4 No Safe Zones (Except Admin-Placed)

| Rule | Detail |
|------|--------|
| Cities are NOT safe zones | PvP is allowed everywhere |
| Spawn protection | 10 seconds of invulnerability after respawn |
| Spawn protection breaks | If the player casts a spell, attacks, uses Overcast, or moves more than 5 meters from the spawn point |
| Spawn protection visual | White shimmer effect and a buff icon |

**Anti-Spawn-Kill Mechanic:**

| Rule | Detail |
|------|--------|
| Damaging a player within 3 seconds of their spawn | The attacker receives the Marked debuff for 30 seconds |
| Marked debuff effect | +50 percent damage taken and a minimap ping for all players |

---

## 28. ADMIN AND OPERATOR COMMANDS (COMPLETE LIST)

### 28.1 Server Management

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `create_server <name>` | Yes | No | Creates a new player server with a fresh grass map |
| `server_list` | Yes | Yes | Shows all servers, player counts, and status |
| `server_join <id>` | Yes (bypasses cap) | Yes (respects cap) | Teleports to another server |
| `server_edit` | Yes | No | Toggles global build mode |
| `world_edit` or `we` | Yes | Yes | Toggles local build mode |
| `world_publish` | Yes | No | Unlocks spawn on a server |
| `server_shutdown <id>` | Yes | No | Shuts down a specific server |
| `server_restart <id>` | Yes | No | Restarts a specific server |
| `server_save` | Yes | Yes | Forces a save of all player data |
| `world_props_clean` | Yes | No | Deletes player-created props such as Stone Shields |
| `server_props_clean` | Yes | No | Deletes player-created props across all servers |

### 28.2 Player Management

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `delete <player>` | Yes | No | Permanently deletes a player account and all characters |
| `restrict <player>` | Yes | Yes | Freezes the player (cannot move, cast, attack, or chat) |
| `unrestrict <player>` | Yes | Yes | Removes the restriction |
| `kick <player>` | Yes | Yes | Disconnects the player from the server |
| `ban <player>` | Yes | No | Bans the player from all servers permanently |
| `unban <player>` | Yes | No | Removes the ban |
| `teleport` | Yes | Yes | Opens a fullscreen map. Click to teleport. |
| `teleport <x> <y>` | Yes | Yes | Teleports to exact coordinates |
| `teleport <player>` | Yes | Yes | Teleports to the player's location |
| `teleport <player> <x> <y>` | Yes | Yes | Teleports the player to coordinates |
| `give <player> <item> <qty>` | Yes | No | Spawns items into the player's inventory |
| `respawn <player>` | Yes | Yes | Forces the player to respawn at the spawn point |
| `heal <player>` | Yes | Yes | Fully heals the player (health and mana) |
| `heal all` | Yes | Yes | Heals all players on the current server |
| `kill <player>` | Yes | Yes | Instantly kills the player (permanent death) |
| `inspect <player>` | Yes | Yes | Shows the player's stats, inventory, spells, and location |

### 28.3 Admin Assignment

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `assign_admin <player> [give_assign] [give_revoke]` | Original only | No | Makes the player an admin with full access |
| `revoke_admin <player>` | Original only | No | Revokes admin privileges |
| `admin_list` | Yes | Yes | Lists all admin accounts |

### 28.4 Operator Management

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `op <player>` | Yes | No | Grants operator status |
| `deop <player>` | Yes | No | Revokes operator status |
| `op_list` | Yes | Yes | Lists all operators |
| `op_log` | Yes | Yes | Shows the operator action log |

### 28.5 World Building

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `copy` | Yes | Yes | Copies the brush area to a blueprint |
| `paste` | Yes | Yes | Pastes the blueprint at the cursor position |
| `undo` | Yes | Yes | Undoes the last 50 build actions |
| `redo` | Yes | Yes | Redoes the previously undone action |
| `fill <tile>` | Yes | Yes | Fills the entire chunk with the selected tile |
| `fill_rect <tile> <x1> <y1> <x2> <y2>` | Yes | Yes | Fills a rectangle area |
| `replace <old_tile> <new_tile>` | Yes | Yes | Replaces all instances of a tile in the chunk |
| `clear_chunk` | Yes | Yes | Clears all tiles in the current chunk |
| `clear_radius <radius>` | Yes | Yes | Clears tiles within a radius of the cursor |
| `smooth` | Yes | Yes | Smooths terrain edges in the selection |

### 28.6 NPC and Guard

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `create_npc` | Yes | No | Opens the NPC editor UI |
| `delete_npc <id>` | Yes | No | Deletes the NPC with the specified ID |
| `edit_npc <id>` | Yes | No | Opens the NPC editor for the existing NPC |
| `npc_list` | Yes | Yes | Shows all NPCs with their IDs |
| `summon_npc <id>` | Yes | No | Summons the NPC to the admin's location |
| `create_guard` | Yes | No | Opens the System Guard creation UI |
| `summon_guard` | Yes | No | Opens the guard selection UI |
| `recall_guard <id>` | Yes | No | Returns a guard to Server 0 |
| `recall_guard all` | Yes | No | Returns all guards to Server 0 |
| `control_guard` | Yes | No | Opens the guard control UI |
| `delete_guard <id>` | Yes | No | Permanently deletes a guard |
| `guard_list` | Yes | Yes | Shows all guards and their locations |
| `guard_stats <id>` | Yes | Yes | Shows detailed stats of a guard |

### 28.7 Spell and Item

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `create_spell` | Yes | No | Opens the spell creation UI (full specification) |
| `edit_spell <id>` | Yes | No | Opens the spell editor for an existing spell |
| `delete_spell <id>` | Yes | No | Deletes a custom spell from the game |
| `spell_list` | Yes | Yes | Shows all spells in the game |
| `give_all_spells <player>` | Yes | No | Gives the player every spell in the game |

### 28.8 Stat Modification

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `multiply_stats <stat> <multiplier>` | Yes | No | Multiplies the admin's stat by the multiplier |
| `set_stat <stat> <value>` | Yes | No | Sets the admin's stat to a specific value |
| `reset_stats <target>` | Yes | No | Resets the target's stats to starting values |

### 28.9 Time and Environment

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `set_time <0-24>` | Yes | No | Sets the world time on all servers (0 equals midnight, 12 equals noon) |
| `pause_time` | Yes | No | Pauses the day and night cycle |
| `resume_time` | Yes | No | Resumes the day and night cycle |

### 28.10 Inventory

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `cloud_inventory <target>` | Yes | No | Opens the target's inventory. The admin can drag and drop items to their own inventory. |
| `admin_storage` | Yes | No | Opens the admin's infinite storage chest |

### 28.11 Board of Legends

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `board_edit <category> <field> <value>` | Yes | Yes | Edits a Board of Legends entry |
| `board_clear <category>` | Yes | No | Clears a specific legend category |
| `board_reset` | Yes | No | Resets the entire Board of Legends |
| `board_add <category> <name> <title> <message>` | Yes | No | Adds a custom legend to the board |
| `board_view` | Yes | Yes | Shows the current Board of Legends entries |

### 28.12 Safe Zone

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `place_safe_zone` | Yes | No | Places a Safe Zone at the cursor position |
| `place_safe_zone <radius>` | Yes | No | Places a Safe Zone with a specific radius (25 to 200) |
| `remove_safe_zone` | Yes | No | Removes the Safe Zone at the cursor position |
| `safe_zone_list` | Yes | Yes | Lists all Safe Zones on the current server |
| `safe_zone_teleport <id>` | Yes | Yes | Teleports to the Safe Zone by ID |

### 28.13 Tournament

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `start_tournament` | Yes | No | Opens the tournament setup UI |
| `end_tournament` | Yes | No | Ends the current tournament |

### 28.14 Communication

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `announce <msg>` | Yes | Yes | Displays a gold-colored message on all players' screens |
| `announce <server_id> <msg>` | Yes | Yes | Displays a message on a specific server only |
| `whisper <player> <msg>` | Yes | Yes | Sends a private message to a player |
| `broadcast <msg>` | Yes | Yes | Sends a message to all servers |

### 28.15 Debug and Log

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `debug_info` | Yes | Yes | Shows server performance stats (FPS, memory, players) |
| `debug_chunks` | Yes | Yes | Shows loaded chunks and their status |
| `debug_entities` | Yes | Yes | Shows all entities in the current chunk |
| `location` | Yes | Yes | Shows the current coordinates and chunk |
| `who` | Yes | Yes | Lists all players on the current server |
| `who all` | Yes | Yes | Lists all players on all servers |
| `log_view` | Yes | Yes | Opens the log viewer UI with filters |
| `log_export` | Yes | Yes | Exports logs to JSON or CSV |

### 28.16 Emergency

| Command | Admin | Operator | Effect |
|---------|-------|----------|--------|
| `emergency_save` | Yes | Yes | Forces an immediate save of all player data |
| `emergency_restart` | Yes | No | Restarts all servers with a save before restart |
| `maintenance_mode on` | Yes | No | Prevents new logins and warns connected players |
| `maintenance_mode off` | Yes | No | Ends maintenance mode |
| `clear_all_entities` | Yes | No | Removes all non-player entities from the current server |
| `reset_chunk <x> <y>` | Yes | Yes | Resets a chunk to the template world state |
| `reset_region <x1> <y1> <x2> <y2>` | Yes | Yes | Resets a region to the template world state |

### 28.17 Cheat Commands (Admin Only)

| Command | Effect |
|---------|--------|
| `godmode` | Toggles invincibility |
| `noclip` | Toggles flying through walls |
| `invisible` | Toggles invisibility to players |
| `speed <multiplier>` | Sets the movement speed multiplier |
| `test_spawn <entity>` | Spawns a test entity at the cursor |
| `test_damage <amount>` | Tests damage calculations on the admin |

### 28.18 Time-Altering Commands (Admin Only)

| Command | Effect | Range Options |
|---------|--------|---------------|
| `time_slow` | Slows time for non-admin players | Radius (1 to 100 meters), Server, or Global |
| `time_freeze` | Freezes non-admin players | Radius (1 to 100 meters), Server, or Global |
| `time_resume` | Resumes normal time | Not applicable |

---

## 29. PLAYER COMMANDS (NO PREFIX)

### 29.1 Command List

| Command | Syntax | Effect | Restrictions |
|---------|--------|--------|--------------|
| `/whisper` | `/whisper [target] "message"` | Sends a private message to the target player. Only works within proximity chat range. | Must be within 20 meters of the target. |
| `/sendloc` | `/sendloc [target]` | Sends the player's coordinates (x, y) to the target player. If in a city or named structure, also sends the name. | Must be within 20 meters of the target. |
| `/call` | `/call [target]` | Opens a private call request. The target sees a UI with Accept and Decline buttons. If accepted, 5 minutes of private chat. | None. Works across the same server. |
| `/trade` | `/trade [target]` | Opens a trade request. Works even if players are far apart on the same server. | None. Works across the same server. |
| `/respec` | `/respec` | Resets the player's class choice. Costs 50,000 gold. Can only be used once per character. | Must have 50,000 gold. |

### 29.2 Call System Details

| Aspect | Detail |
|--------|--------|
| Duration | 5 minutes |
| UI | A small window near the chatbox with a timer and an End Call button |
| Chat switching | Players can toggle between normal chat and call chat |
| Cooldown after call | 5 minutes before calling the same player again |
| Decline penalty | 5 second cooldown before calling the same player again |

### 29.3 Trade System Details

| Aspect | Detail |
|--------|--------|
| Distance | Anywhere in the same server |
| Tradeable items | Grimoires, potions, tomes, resources |
| UI | Split screen showing both players' offers |
| Acceptance | Toggle button on each side |
| Countdown | 3 seconds when both accept |
| Cancellation | Any change to an offer during the countdown cancels the trade |

### 29.4 Command Autocomplete

When typing commands in chat, players see:
- A list of available commands that updates as they type
- Syntax suggestions
- Format close to what they have typed
- One wrong word and the command will not work

---

## 30. SAFE ZONE STRUCTURE

### 30.1 What Is a Safe Zone?

A special structure that the admin can place anywhere.

| Rule | Detail |
|------|--------|
| Death | Players respawn at the same spot after 30 seconds |
| PvP | Allowed. Players can fight each other. |
| Permanent Death | Disabled. No permadeath inside a Safe Zone. |
| Loot | No gold or items are lost on death. |
| Training | The admin can teleport players and summon enemies. Players gain XP, gold, and loot normally. |

### 30.2 Admin Placement

| Command | `/command place_safe_zone` |
|---------|---------------------------|
| Radius | 25 to 200 meters (admin chooses) |
| Visual | A green dome visible to all players |
| Cost | Free (admin only) |

**Operators cannot remove Safe Zones. Only the admin can remove them.**

---

## 31. TOURNAMENT SYSTEM (ADMIN-HOSTED)

### 31.1 Core Rule

The admin hosts tournaments in Safe Zones. Only the admin can create and manage tournaments.

### 31.2 Admin Commands

| Command | Effect |
|---------|--------|
| `/command start_tournament` | Opens the tournament setup UI |
| `/command end_tournament` | Ends the current tournament |

### 31.3 Tournament Setup UI

| Field | Options |
|-------|---------|
| Tournament Name | Text input |
| Entry Fee | 0 to 10,000 gold |
| Max Players | 2 to 64 |
| Bracket Type | Single Elimination, Double Elimination, or Round Robin |
| Winner Reward | Gold, Grimoire, or Custom item |
| Start Time | Countdown timer |

### 31.4 Tournament Flow

| Step | Action |
|------|--------|
| 1 | The admin creates a tournament in a Safe Zone |
| 2 | Players sign up through the UI |
| 3 | The admin starts the tournament |
| 4 | Players are teleported to the arena |
| 5 | Matches begin |
| 6 | The winner is announced and rewarded |

---

## 32. KARMA AND KARMA REDEMPTION SYSTEM

### 32.1 Karma Loss

| Action | Karma Change |
|--------|--------------|
| Killing a player 10 or more levels below you | -300 karma |
| Killing a player (normal) | -100 karma |

**Karma is only lost by killing players. Killing monsters does not affect karma. There is no way to gain positive karma through killing.**

### 32.2 Karma Gain Sources (Redemption)

| Action | Karma Gain |
|--------|------------|
| Helping to kill a boss (as a party member) | +10 |
| Escorting a wandering trader safely to complete a route | +25 |
| Donating gold to a city | +1 per 100 gold donated |
| Healing another player who is not in your party | +5 |
| Using a revive effect on another player | +15 |

### 32.3 Positive Karma Benefits

| Karma Range | Benefit |
|-------------|---------|
| 1 to 50 | 5 percent discount at NPCs |
| 51 to 200 | 10 percent discount at NPCs |
| 201 and above | 15 percent discount at NPCs |

### 32.4 Demon Risk for Negative Karma

If karma is negative, there is a chance a demon will spawn and hunt the player.

```
Demon Spawn Chance = |Karma| percent
```

| Karma | Demon Spawn Chance |
|-------|---------------------|
| -50 | 50 percent chance |
| -100 | 100 percent chance |
| -200 | 200 percent chance (two demons) |

**Demon Stats:** The demon has the same Mana Cap as the player. The demon is hostile and will chase the player until either the player dies or the demon dies.

---

## 33. DAILY LOGIN REWARDS

### 33.1 Reward Table

| Day | Reward |
|-----|--------|
| Day 1 | 100 gold |
| Day 2 | 1 Health Potion |
| Day 3 | 200 gold |
| Day 4 | 1 Mana Potion |
| Day 5 | 300 gold |
| Day 6 | 1 Random Common Grimoire |
| Day 7 | 1 Random Uncommon Grimoire |

### 33.2 Rules

| Rule | Detail |
|------|--------|
| Streak reset | Missing one day resets the streak to Day 1 |
| Claim | Rewards are auto-claimed on login |
| Notification | A popup shows the reward received |

---

## 34. ACHIEVEMENT SYSTEM

### 34.1 Achievements List

| Achievement | Requirement | Title Reward |
|-------------|-------------|--------------|
| First Blood | First player kill | "Bloodletter" |
| Millionaire | Earn 1,000,000 gold total | "Goldborn" |
| Spell Master | Learn all spells to level 10 | "Archmage" |
| Immortal | Reach Level 100 without dying | "Deathless" |
| Legend Slayer | Kill a player who is on the Board of Legends | "Legendkiller" |
| Guild Master | Create a guild | "Founder" |
| War Hero | Win 10 guild wars | "Warlord" |
| Beast Hunter | Kill 10,000 monsters | "Beastlord" |

### 34.2 Achievement Display

| Aspect | Detail |
|--------|--------|
| Location | Profile UI |
| Rewards | Cosmetic titles only. No stat bonuses. |
| Notification | A popup appears when an achievement is earned. |

---

## 35. SERVER TRANSFER COOLDOWN

| Aspect | Detail |
|--------|--------|
| Cooldown | 10 minutes between server transfers |
| Admin bypass | The admin bypasses this cooldown |
| Warning | The server list shows a countdown timer |
| In combat | Players cannot transfer for 5 seconds after taking or dealing damage |

---

## 36. SINGLE CHARACTER PER ACCOUNT

| Rule | Detail |
|------|--------|
| Maximum characters | 1 per account |
| Delete character | Players can delete their current character to create a new one |
| Deletion effect | All records are permanently removed |
| Name availability | A deleted name becomes available again after 90 days |

---

## 37. PVP BOUNTY SYSTEM

### 37.1 Core Rule

When a player reaches -200 karma, a bounty is placed on their head.

### 37.2 Bounty Display

| Aspect | Detail |
|--------|--------|
| Location | The Power Board shows a special row |
| Shows | Player name, bounty amount, and last seen location |

### 37.3 Claiming a Bounty

| Rule | Detail |
|------|--------|
| Kill the hunted player | The killer claims the full bounty |
| Reward | 50 percent comes from the hunted player's gold. 50 percent comes from the system. |
| Notification | A server-wide announcement is broadcast |
| Reset | The hunted player's karma resets to 0 after death |

### 37.4 Admin Command

| Command | Effect |
|---------|--------|
| `/command give_bounty <player> <amount>` | Manually sets or adds to a player's bounty |

---

## 38. ITEM MAIL SYSTEM (DONATIONS ONLY)

### 38.1 Core Rule

Players can send items to other players through mail. This is for donations only, not for trading.

### 38.2 Requirements

| Requirement | Detail |
|-------------|--------|
| Must be friends | Both players must be on each other's friend list |
| Same server | Both players must be on the same server at the time of sending |
| Offline delivery | The mail is received when the offline player joins the same server |

### 38.3 How to Send

| Step | Action |
|------|--------|
| 1 | Open the friend list UI |
| 2 | Select a friend |
| 3 | Click "Send Mail" |
| 4 | Select items to donate |
| 5 | Confirm. No cost. |

### 38.4 How to Receive

| Step | Action |
|------|--------|
| 1 | Join the server where the mail was sent |
| 2 | A notification appears |
| 3 | Open the mailbox UI |
| 4 | Claim the items |

### 38.5 Restrictions

| Restriction | Detail |
|-------------|--------|
| Cannot trade | Donations only |
| No gold sending | Only items can be sent |
| Expiration | Unclaimed mail expires after 24 hours |

---

## 39. TERRITORY RESOURCE GENERATION

### 39.1 Core Rule

Guild territories generate resources over time.

### 39.2 Generation Rates

| Resource | Amount | Frequency |
|----------|--------|-----------|
| Gold | 1,000 | Daily |
| Random Common Item | 1 | Weekly |
| Random Grimoire | 1 | Weekly (rare) |

### 39.3 Territory Defense

| Event | Result |
|-------|--------|
| Boss spawn chance | 5 percent per day |
| Boss strength | Scales with guild size |
| If undefended | The territory loses its resources for that day |

---

## 40. COMBAT LOG (PLAYER VIEWABLE)

### 40.1 Core Rule

Players can view a combat log showing recent damage events.

### 40.2 How to Open

| Key | Effect |
|-----|--------|
| L | Toggles the combat log UI |

### 40.3 Combat Log Display

| Information | Example |
|-------------|---------|
| Timestamp | [15:23:04] |
| Attacker | Wolf Boss |
| Damage amount | 245 damage |
| Current HP | 755 out of 1000 |
| Spell used | Mana Bolt |

### 40.4 Capacity

| Aspect | Detail |
|--------|--------|
| Maximum entries | 50 |
| Persistence | Clears on death |

---

## 41. AFK TIMER AUTO-KICK

### 41.1 Core Rule

Players who are AFK for too long are kicked to the character select screen.

### 41.2 Timer

| Aspect | Detail |
|--------|--------|
| AFK detection | 15 minutes with no input |
| Action | Auto-kick to the character select screen |
| Character death | The character is NOT killed. It remains alive. |

### 41.3 AFK Status Display

| Aspect | Detail |
|--------|--------|
| Shows on Tab list | "AFK" appears after 20 seconds of no input |
| Kicked at | 15 minutes |

---

## 42. NAME CHANGE SYSTEM

### 42.1 Core Rule

Players can change their character name for gold or real money.

### 42.2 Cost Options

| Option | Cost |
|--------|------|
| Gold | 10,000 gold |
| Real money | $5.00 USD |

### 42.3 Restrictions

| Restriction | Detail |
|-------------|--------|
| Cooldown | 30 days between name changes |
| Name availability | The old name becomes available again after 90 days |
| Admin bypass | The admin can bypass all restrictions |

### 42.4 How to Change a Name

| Step | Action |
|------|--------|
| 1 | Open the Settings UI |
| 2 | Select "Change Name" |
| 3 | Choose a payment method (Gold or Real Money) |
| 4 | Enter a new name |
| 5 | Confirm |

---

## 43. PET SYSTEM (COSMETIC)

### 43.1 Core Rule

Cosmetic pets follow players. They have no combat benefit.

### 43.2 Pet Types

| Pet | How to Obtain |
|-----|---------------|
| Floating Orb | Default. All players have this. |
| Tiny Dragon | Rare drop from bosses |
| Ghost Wisp | Achievement reward |
| Crystal Sprite | Daily login reward on day 30 |

### 43.3 Pet Behavior

| Aspect | Detail |
|--------|--------|
| Movement | Floats behind the player |
| Frames | Only one sprite sheet with an idle float animation |
| No animations | No walking, attacking, or death animations |

### 43.4 How to Equip a Pet

| Step | Action |
|------|--------|
| 1 | Open the Inventory |
| 2 | Select the Pet tab |
| 3 | Click on a pet |
| 4 | The pet appears floating behind the player |

---

## 44. WORLD MAP REVEAL SYSTEM

### 44.1 Core Rule

The map reveals as the player explores (fog of war).

### 44.2 Reveal Mechanics

| Aspect | Detail |
|--------|--------|
| Default state | The map is dark or unknown |
| Exploration | Reveals the area within 50 meters of the player |
| Persistence | Revealed areas stay revealed |
| Map fragments | Players can buy map fragments from NPCs for 1,000 gold to reveal specific areas |

### 44.3 Guild Map

| Aspect | Detail |
|--------|--------|
| Guild territory | Revealed on the guild map |
| Sharing | All guild members see the same guild territory map |

---

## 45. SERVER POPULATION DISPLAY

### 45.1 Core Rule

The server list shows population status.

### 45.2 Status Indicators

| Population | Display | Color |
|------------|---------|-------|
| 0 to 50 percent | Low | Green |
| 51 to 80 percent | Medium | Yellow |
| 81 to 99 percent | High | Orange |
| 100 percent | Full | Red |

### 45.3 Queue System

| Aspect | Detail |
|--------|--------|
| When a server is full | The player is assigned a queue position |
| Auto-join | When a slot opens, the player automatically joins |
| Notification | A popup appears when the player is ready to join |

---

## 46. TIME-ALTERING SPELLS (ADMIN ONLY)

### 46.1 Core Rule

These are admin-only spells that alter time for non-admin players.

### 46.2 Available Spells

| Spell | Effect | Range Options |
|-------|--------|---------------|
| Time Slow | Slows all non-admin players | Radius (10 to 100 meters), Server, Global |
| Time Freeze | Freezes all non-admin players | Radius (10 to 100 meters), Server, Global |

### 46.3 Admin Commands

| Command | Effect |
|---------|--------|
| `/command time_slow` | Opens a radius, server, or global selector |
| `/command time_freeze` | Opens a radius, server, or global selector |
| `/command time_resume` | Resumes normal time |

### 46.4 Visual Effects

| Spell | Visual |
|-------|--------|
| Time Slow | A blue-tinted screen for affected players |
| Time Freeze | A gray-tinted screen with frozen particles |

---

## 47. SERVER ARCHITECTURE

### 47.1 Server Types

| Server | Purpose | Capacity | Who Can Join |
|--------|---------|----------|--------------|
| Server 0 | Admin home. Testing. Guard headquarters. | No limit | Admin and operators only |
| Servers 1 through 30 | Player servers | 250 players each | Everyone, plus one admin slot |

### 47.2 Server 0 Purpose

Server 0 is NOT a template world. It is the admin's personal home and testing ground. The template for public servers is stored separately.

### 47.3 Day and Night Cycle

| Aspect | Detail |
|--------|--------|
| Visual | The screen slowly darkens at night and slowly brightens during the day |
| Playability | The game remains visible enough to play at night |
| Time progression | The game date started on January 1, 1584 |

---

## 48. UI PHILOSOPHY AND FEATURES

### 48.1 Core Principle

UIs should NOT give hints about what to expect in the server unless the hint is vague.

### 48.2 Vague Hint Examples

| Bad (Too Direct) | Good (Vague) |
|------------------|--------------|
| "The Pig King is in the cave at 500,500" | "Smoke rises from a distant cave entrance" |
| "Kill 10 wolves to level up" | "Wolves grow stronger in packs" |
| "The minotaur drops a golden chest" | "Rumors speak of a beast that guards treasure" |

### 48.3 Map System

Maps do not show the exact locations of players and entities unless:
- The player uses Mana Detection Pulse (V key)
- The revealed entities are emitting mana or are not using Compression

### 48.4 Loading Screen

When entering a world, a loading screen shows a progress bar. Players cannot interact until the world is fully loaded.

### 48.5 Victorian Language Toggle

Players can toggle Victorian English for NPC conversations in the Settings UI.

| Toggle On | Toggle Off |
|-----------|------------|
| "Thou art welcome, traveler." | "You are welcome, traveler." |
| "Pray, what business brings thee?" | "What brings you here?" |

---

## 49. ASSET AND SPRITESHEET REQUIREMENTS

### 49.1 Quick Start Asset Sources

| Category | Source | License | URL |
|----------|--------|---------|-----|
| UI Elements | Kenney UI Pack | CC0 | kenney.nl/assets/ui-pack |
| Tiles and Props | Kenney Tiny Town | CC0 | kenney.nl/assets/tiny-town |
| More Tiles | Kenney Roguelike | CC0 | kenney.nl/assets/roguelike |
| Spell Effects | OGA Pixel FX | CC0 | opengameart.org/content/pixel-fx-1 |
| Characters | LPC Generator | CC BY-SA | spritesheetgenerator.mikenye.net |
| Monsters | OGA LPC Monsters | CC BY-SA | opengameart.org/art-search-ajax?field_art_tags_tid=LPC%20monsters |
| Pets | Custom or CC0 | CC0 | Not applicable |

### 49.2 Removed Assets (No Weapons)

| Category | Removed |
|----------|---------|
| Weapon sprites | All |
| Weapon Smith NPC | Removed |
| Weapon icons | All |

### 49.3 System Guard Sizes

| Guard Type | Available Sizes |
|------------|-----------------|
| System Guard | 1x, 2x, or 3x |
| High Guard | 1x, 2x, or 3x |
| Bounty Hunter | 1x, 2x, or 3x |

There is no 2.5x size. Only 1x, 2x, and 3x are available for visibility.

---

## 50. AI SYSTEM PLAN (FUTURE IMPLEMENTATION)

### 50.1 Current State (Rule-Based)

NPCs follow predefined behavior rules:
- Patrol waypoints
- Attack on sight
- Flee when damaged
- Trade with fixed prices

**This is what will be implemented first.**

### 50.2 Future Plan (Smart AI)

Goal: Give NPCs smart brains to decide on their own. System Guards must still obey.

Requirements:
- Cost-free
- Not RAM-heavy
- Runs on the server

### 50.3 Proposed Architecture

| Component | Technology | Why |
|-----------|------------|-----|
| Local rule engine | Node.js native | Fast, no extra cost |
| Context memory | JSON files | Lightweight, per NPC |
| Decision making | Finite State Machine plus Goal-Oriented Action Planning | Predictable, efficient |
| NPC conversations | Small language model running locally | Free but requires optimization |

### 50.4 Conversation AI Plan

Smart conversations without high cost:

| Feature | Implementation |
|---------|----------------|
| Lore knowledge | Pre-defined lore database in JSON |
| Player memory | NPC remembers players through a simple database (last seen, what happened) |
| Personality development | Stat tracking (helpfulness, hostility) |
| Response generation | Template-based plus variable insertion |
| Victorian toggle | A translation layer on responses |

**Example Conversation Flow:**

```
Player: "Hello"
NPC checks: Know the player? → Yes (the player helped yesterday)
Response: "Ah, [Player Name], welcome back. The forest has been quiet since your last visit."
```

### 50.5 Resource Considerations

| Aspect | Optimization |
|--------|--------------|
| RAM | NPCs are only loaded in active chunks |
| Processing | AI ticks every 2 to 5 seconds, not every game tick |
| Storage | Lightweight JSON, not a full large language model |

### 50.6 Implementation Timeline

| Phase | Timeline | Status |
|-------|----------|--------|
| Phase 1: Rule-based NPCs | Launch | Current |
| Phase 2: Enhanced memory | Post-launch | Planned |
| Phase 3: Simple conversation | Post-launch | Planned |
| Phase 4: Full smart AI | Future update | Research |

---

## 51. LOGGING SYSTEM (ADMIN)

### 51.1 Log Viewer UI

| Filter | Options |
|--------|---------|
| Date range | Start date and end date |
| Command type | Dropdown selector |
| Player name | Text input with autocomplete |
| Server | Dropdown selector |
| Keyword | Text search |

### 51.2 Export Formats

| Format | Use |
|--------|-----|
| JSON | Data processing |
| CSV | Spreadsheet viewing |

### 51.3 What Is Logged

| Category | Events Logged |
|----------|---------------|
| Admin actions | All commands used, with timestamp and server |
| Player actions | Death, level up, guild actions, trades, calls |
| System events | Server start, server stop, crashes, saves |
| World changes | Terrain edits, NPC creation and deletion, guard actions |
| Spell and weapon creation | New spells and weapons created, edited, or deleted |

---

## 52. PLAYER FREEDOM - NO CORE LOOP

Players can do anything they want. There is no forced gameplay loop.

**Examples of what players can do:**

| Activity | How | Risk |
|----------|-----|------|
| Grind monsters | Kill monsters for XP, gold, and loot | Low |
| Hunt players | Kill other players for their gold and grimoires | High |
| Explore | Travel the world and find hidden dungeons | Medium |
| Ride with traders | Mount wandering trader NPCs for safe travel | Low |
| Master spells | Collect all grimoires and level them to 10 | Low |
| Build a guild base | Claim territory and build structures | High |
| Chat in town | Socialize, trade, and recruit | None |
| Trade | Buy low, sell high, and become a merchant | Low |
| Help new players | Guide noobs and protect them from gankers | Medium |
| Build terrain | Use Earth Wall, Stone Pillar, and Stone Shield to create forts | Low |
| Never level up | Stay at Level 1 forever and troll higher levels | Extreme |
| Become admin | Climb the Power Board and wait for the admin to die | Extreme |

**The world exists. The systems work. What players do is up to them.**

---

## 53. MONETIZATION PLAN

### 53.1 Core Philosophy

The game must earn real money to sustain development and hosting. There is no pay-to-win. Only cosmetics and convenience are sold.

### 53.2 Real Money Purchases

| Item | Price | Notes |
|------|-------|-------|
| Name Change | $5.00 USD | Changes the character name |
| Pet Skins | $2.00 to $10.00 USD | Cosmetic only |
| Character Slot (future) | $10.00 USD | If the character limit is increased |
| Title Customization | $3.00 USD | Custom titles require admin approval |

### 53.3 NOT for Sale

| Item | Reason |
|------|--------|
| Gold | This would be pay-to-win |
| Grimoires | This would be pay-to-win |
| Stat boosts | This would be pay-to-win |
| XP boosts | This would be pay-to-win |
| Gear | This would be pay-to-win |

### 53.4 Patreon and Donations

| Tier | Reward |
|------|--------|
| $5 per month | Discord role, name in credits |
| $10 per month | Custom title, Discord role |
| $25 per month | Custom pet skin design |

---

## 54. DAY 0 TO LAUNCH CHECKLIST

```
PHASE 1: SERVER 0 SETUP
□ Boot Server 0. The world is an empty void.
□ Admin logs into Server 0.
□ /command server_edit to enter global build mode.
□ Type CONFIRM.

PHASE 2: BUILD THE TEMPLATE WORLD
□ Place a central_hall at 0,0. Name it "Firstlight". Set radius to 300. Spawn type: Public.
□ Drag grass to cover 1000 by 1000 tiles (painting mode).
□ Place trees, rocks, and water features.
□ Place wolves (500 Mana Cap) for new players to fight.

PHASE 3: CREATE NPCS
□ /command create_npc for a Shopkeeper.
□ /command create_npc for Town Guards (Defensive, Level 20, patrol).
□ /command create_npc for Wandering Traders.
□ /command create_npc for Nica (Operating System) as a special NPC.
□ Place the NPCs in the town.

PHASE 4: CREATE SYSTEM GUARDS
□ /command create_guard
   □ Create a Bounty Hunter (size 1x or 2x)
   □ Create a High Guard (size 2x or 3x)

PHASE 5: BUILD CITIES AND DUNGEONS
□ Build cities, dungeons, and terrain features.
□ Test monsters, NPCs, and spells.
□ /command server_edit off to exit build mode.

PHASE 6: CREATE PLAYER SERVERS
□ /command create_server "North America East"
□ /command create_server "Europe West"
□ /command create_server "Asia Pacific"

PHASE 7: SUMMON GUARDS AND NPCS
□ /command summon_guard. Select guards. Summon them.
□ /command summon_npc. Select NPCs. Summon them.

PHASE 8: PUBLISH
□ /command world_publish on each player server.
□ Share the link with players.

PHASE 9: MONITOR
□ Admin stays on Server 0 to continue building and testing.
□ Players join servers 1 through 5. Each server has a cap of 250 players plus an admin slot.
□ Monitor server performance.
□ Use /command control_guard to adjust guard behaviors.
□ Check /command log_view for any issues.
```

---

## 55. GLOSSARY OF TERMS

| Term | Definition |
|------|------------|
| Admin | The game owner. Has full control. Only one original admin exists. |
| Assigned Admin | An admin appointed by the original admin. Has full access. |
| Bounty | A reward for killing a player who has -200 karma or less. |
| Call | A player command for private chat across any distance on the same server. |
| Character | A player's in-game persona. One per account. Permanent death deletes the character. |
| Compression | The C key. Hides the real Mana Cap. Costs 25 mana per second. |
| Creator Tag | The number 0 position on the Power Board. Only the original admin has this. |
| Damage | The only damage type in the game. There are no elements. |
| Focus | A stat that helps Compression hide mana. Higher focus makes detection harder. |
| Grimoire | A spell book. Consumed to learn spells or to give XP to known spells. |
| Legend Announcement | A server-wide broadcast when a new legend is carved on the Board of Legends. |
| Nica | The special Operating System NPC. The admin's assistant. |
| Operator | A trusted player with limited admin powers. Can use local build mode only. |
| Output | The percentage of maximum mana's full damage, from 1 to 100 percent. This is not a stat. |
| Overcast | The G key. Burns all mana for 5 times damage. Cannot be used near cities or guild territory. |
| Power Board | A real-time ranking of living players based on a hidden Power Score. |
| Rebirth | The admin's state after death. The name is preserved. Progress resets on the second death. |
| Safe Zone | A training area where death is not permanent. PvP is allowed. |
| Server 0 | The admin home. A testing ground. Guard headquarters. Only the admin and operators can join. |
| Stone Shield | A non-terrain object spell. Creates a floating stone wall. |
| Successor | A player who becomes admin after the previous admin dies. |
| System Guard | An admin-created guard. Available sizes are 1x, 2x, or 3x. |
| Tournament | An admin-hosted competition held in a Safe Zone. |
| Trade | A player command for item exchange across the same server. |
| War | A guild versus guild conflict declared through the UI. |
| Weapons | Removed from the game. This is a pure magic game. |

---

## ✅ SYSTEM COMPLETE - ALL SPECS LOCKED v29.0

**Last Updated: May 1, 2026 — 14:30 UTC**

*"Build the world. They will come. What they do is their story. Who they become is their legend. When the crown passes, a new chapter begins."*
