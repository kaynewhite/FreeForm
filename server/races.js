const RACES = {
  human: {
    name: "Human",
    passive: "Can control 3 objects at start. +10% trade discount with NPCs and a 5% chance to double trades.",
    weapon: "Dagger",
    apply(stats) {
      // Human's +3 starting object control is handled by the Object-Control formula,
      // not by the raw control stat.
    },
  },
  orc: {
    name: "Orc",
    passive: "+10% Max HP. +15% melee basic-attack damage. +20 Stamina Cap.",
    weapon: "Club",
    apply(stats) {
      stats.max_hp = 1100;
      stats.hp = 1100;
      stats.stamina_cap = 120;
    },
  },
  elf: {
    name: "Elf",
    passive: "+5% Mana Regen. +15% bow damage. +2 tile range on Mana Detection.",
    weapon: "Bow",
    apply(_stats) {},
  },
  crystalline: {
    name: "Crystalline",
    passive: "+10% Resistance. 5% chance to reflect projectiles back along their path.",
    weapon: "Slingshot",
    apply(stats) {
      stats.resistance = 10;
    },
  },
  voidborn: {
    name: "Voidborn",
    passive: "Compression costs 50% less mana per second. +25% Stamina Regen. +8% movement speed (the only racial speed bonus in the game).",
    weapon: "Katana",
    apply(_stats) {},
  },
};

const RACE_KEYS = Object.keys(RACES);

function rollRace() {
  return RACE_KEYS[Math.floor(Math.random() * RACE_KEYS.length)];
}

function withRaceMeta(character) {
  if (!character) return null;
  const meta = RACES[character.race];
  if (!meta) return character;
  return {
    ...character,
    race_name: meta.name,
    racial_passive: meta.passive,
    starting_weapon: meta.weapon,
  };
}

module.exports = { RACES, RACE_KEYS, rollRace, withRaceMeta };
