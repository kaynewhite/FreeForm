const RACES = {
  human: {
    name: "Human",
    passive: "Can control 3 objects at start. +10% trade discount with NPCs. 2.5% chance to double trades from NPCs.",
    apply(_stats) {},
  },
  orc: {
    name: "Orc",
    passive: "+10% Max HP. +20 Stamina Cap.",
    apply(stats) {
      stats.max_hp = 1100;
      stats.hp = 1100;
      stats.stamina_cap = 120;
    },
  },
  elf: {
    name: "Elf",
    passive: "+5% Mana Regen. +2 tiles detection range for Mana Detection.",
    apply(_stats) {},
  },
  crystalline: {
    name: "Crystalline",
    passive: "+10% Resistance. 15% chance to reflect projectiles back along their path.",
    apply(stats) {
      stats.resistance = 10;
    },
  },
  voidborn: {
    name: "Voidborn",
    passive: "Compression costs 50% less mana per second. +25% Stamina Regen. +8% movement speed. +2% additional movement speed.",
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
  };
}

module.exports = { RACES, RACE_KEYS, rollRace, withRaceMeta };
