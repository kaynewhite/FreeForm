const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const SPRITE_ROOT = path.join(__dirname, "..", "client", "assets", "sprites", "admin", "base");

// Animation folders we expect under base/.
const ANIMATIONS = ["idle", "walking", "attack", "cast", "death"];

// Parse a filename like:
//   admin-idleDown-spritesheet.png                  → { weapon: 'no-weapon', direction: 'down', combined: false }
//   admin-dagger-walkUp-spritesheet.png             → { weapon: 'dagger',    direction: 'up',   combined: false }
//   admin-katana-idleUpLeftDownRight-spritesheet.png → { weapon: 'katana',   direction: null,   combined: true }
//   admin-club-death-spritesheet.png                → { weapon: 'club',      direction: null,   combined: false } (death = single sheet)
function parseFile(file, animation) {
  const stem = file.replace(/-spritesheet\.png$/, "");
  const parts = stem.split("-"); // ['admin', maybe weapon, anim+dir or anim]
  if (parts[0] !== "admin") return null;

  const weapon = parts.length === 2 ? "no-weapon" : parts[1];
  const tail = parts[parts.length - 1]; // e.g. "idleDown" or "idleUpLeftDownRight" or "death"

  // Strip the animation prefix off the tail if it matches; what's left is the direction.
  const animKey = animation === "walking" ? "walk" : animation;
  let dirPart = tail.startsWith(animKey) ? tail.slice(animKey.length) : "";

  if (animation === "death") {
    return { file, weapon, direction: null, combined: false };
  }
  if (dirPart === "UpLeftDownRight") {
    return { file, weapon, direction: null, combined: true };
  }
  if (["Up", "Down", "Left", "Right"].includes(dirPart)) {
    return { file, weapon, direction: dirPart.toLowerCase(), combined: false };
  }
  return null;
}

router.get("/manifest", (_req, res) => {
  const out = {};
  for (const anim of ANIMATIONS) {
    const animDir = path.join(SPRITE_ROOT, `${anim}-spritesheets`);
    out[anim] = {};
    if (!fs.existsSync(animDir)) continue;
    for (const variant of fs.readdirSync(animDir)) {
      const variantDir = path.join(animDir, variant);
      if (!fs.statSync(variantDir).isDirectory()) continue;
      const entries = [];
      for (const f of fs.readdirSync(variantDir)) {
        if (!f.endsWith(".png")) continue;
        const parsed = parseFile(f, anim);
        if (!parsed) continue;
        entries.push({
          ...parsed,
          url: `/assets/sprites/admin/base/${anim}-spritesheets/${variant}/${f}`,
        });
      }
      if (entries.length) out[anim][variant] = entries;
    }
  }
  res.json({ root: "/assets/sprites/admin/base", animations: out });
});

module.exports = router;
