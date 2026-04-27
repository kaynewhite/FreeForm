// Admin character template — see design doc §3.8 "Admin Class".
// Admins are not a race or a normal class. They get their own special
// stat block and skip the race-roll / gender pick that normal players go through.

const ADMIN_STATS = Object.freeze({
  mana_cap: 1000000,
  max_hp: 100000,
  hp: 100000,
  level: 1,
  xp: 0,
  control: 1000,
  efficiency: 50,      // 50%
  cast_speed: 500,
  resistance: 500,
  stamina_cap: 500,
});

// Cosmetic / display-only metadata returned alongside an admin character.
// (Stamina regen and movement-speed bonus from §3.8 are simulation values,
// not stored columns yet — they belong to the world tick when it lands.)
const ADMIN_META = Object.freeze({
  label: "Admin",
  passive:
    "All spells learned. Immune to debuffs and Overcast penalties. " +
    "Bypasses cooldowns. +8% movement speed. Stamina regen 200%. " +
    "Cannot be killed by normal means.",
  stamina_regen_pct: 200,
  movement_speed_pct: 8,
});

function withAdminMeta(character) {
  if (!character) return null;
  return {
    ...character,
    is_admin: true,
    race_name: ADMIN_META.label,
    racial_passive: ADMIN_META.passive,
    starting_weapon: "All",
    stamina_regen_pct: ADMIN_META.stamina_regen_pct,
    movement_speed_pct: ADMIN_META.movement_speed_pct,
  };
}

module.exports = { ADMIN_STATS, ADMIN_META, withAdminMeta };
