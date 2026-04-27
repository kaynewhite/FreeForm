const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

// Load a JSON file inside data/. Returns `fallback` if it doesn't exist.
function load(name, fallback = {}) {
  const file = path.join(DATA_DIR, name);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

// Atomically write a JSON file inside data/ (write to .tmp then rename, so a
// crash in the middle of writing can never leave a half-written file).
function save(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

module.exports = { DATA_DIR, load, save };
