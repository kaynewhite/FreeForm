# Admin Sprite Sheets

The admin is **not a race or class** — they are their own thing — so all admin
assets live under this folder instead of being spread across the per-race
folders. See design doc §3.8 (Admin Class) and §26 (Asset & Spritesheet
Requirements) for the full specification.

## Folder Layout

```
admin/
  base/
    idle-spritesheets/
      no-weapon/                ← 4 files (one per direction)
      with-<weapon>/            ← per-weapon overlays
    walking-spritesheets/
      no-weapon/
      with-<weapon>/
    attack-spritesheets/
      no-weapon/
      with-<weapon>/
    cast-spritesheets/
      no-weapon/
      with-<weapon>/
    death-spritesheets/
      no-weapon/
      with-<weapon>/
  weapons/                      ← (reserved for future per-weapon prop sprites)
  icons/                        ← 32×32 inventory icons
```

## Naming convention

### Per-direction sheets (4 files)

Used for animations where each direction has its own sheet:

```
admin-<animation><Direction>-spritesheet.png                ← no weapon
admin-<weapon>-<animation><Direction>-spritesheet.png       ← with weapon
```

Where `<Direction>` is one of `Up`, `Down`, `Left`, `Right` and `<animation>`
is `idle`, `walk`, `attack`, `cast`. Examples:

- `admin-idleDown-spritesheet.png`
- `admin-dagger-walkUp-spritesheet.png`
- `admin-club-attackLeft-spritesheet.png`

### Combined sheets (single file)

Used when all four directions are packed into one sheet:

```
admin-<weapon>-<animation>UpLeftDownRight-spritesheet.png
```

Examples:

- `admin-katana-idleUpLeftDownRight-spritesheet.png`
- `admin-sword-walkUpLeftDownRight-spritesheet.png`

### Death sheets

Death is non-directional (one sheet per weapon variant):

- `admin-death-spritesheet.png`                 (no weapon)
- `admin-<weapon>-death-spritesheet.png`        (with weapon)

## Weapons currently supplied

| Weapon | Folder |
|--------|--------|
| (none) | `no-weapon/` |
| Dagger | `with-dagger/` |
| Club | `with-club/` |
| Bow | `with-bow/` |
| Slingshot | `with-slingshot/` |
| Katana | `with-katana/` |
| Sword | `with-sword/` |
| Staff | `with-staff/` |
| Crossbow | `with-crossbow/` |
| Mace | `with-mace/` |
| Battle Axe | `with-battleaxe/` |
| Greatsword | `with-greatsword/` |
| Axe (Wood) | `with-axe/` |
| Pickaxe | `with-pickaxe/` |

Per the design doc the admin starts with all 5 starter weapons (Dagger, Club,
Bow, Slingshot, Katana) and can equip the rest as well.

## How they are served

Anything in this folder is served as static content at:

```
/assets/sprites/admin/base/<animation>-spritesheets/<variant>/<file>.png
```

The renderer (PixiJS, coming next) will load the right sheet based on the
admin's current `(animation, weapon, direction)` triple.
