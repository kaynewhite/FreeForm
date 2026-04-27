# Admin Sprite Sheets

Drop your finished admin spritesheet PNGs into the subfolders below.
Naming follows the same convention used in the design doc, section 23
("Asset & Spritesheet Requirements"). The admin is *not* a race or class —
they are their own thing — so all admin assets live under this folder
instead of being spread across the per-race folders.

## Layout

```
admin/
  base/        ← base character sheet(s), no weapon drawn
  weapons/     ← weapon overlays drawn on top of the base sheet
  icons/       ← 32×32 inventory icons (one per weapon)
```

## Naming convention

### `base/`
Base character sheet, 32×32 frames, 80 frames per sheet
(Idle / Walk / Attack / Cast / Death × 4 directions × 4 frames).

- `admin.png` — single sheet if the admin has no gender variants
- `admin_male.png` / `admin_female.png` — if you made gendered variants

### `weapons/`
Weapon overlays — 32×32 frames, 16 frames per sheet
(4 directions × 4 attack frames). One file per weapon the admin can equip.
Per the design doc the admin starts with **all five** starting weapons
plus +8% movement speed (Voidborn bonus), so all of these belong here:

- `admin_dagger.png`
- `admin_club.png`
- `admin_bow.png`
- `admin_slingshot.png`
- `admin_katana.png`

If you also made gendered overlays, suffix with `_male` / `_female`
(e.g. `admin_dagger_male.png`).

### `icons/`
32×32 PNG inventory icons, one per weapon — same names as above
(`dagger.png`, `club.png`, `bow.png`, `slingshot.png`, `katana.png`),
or whatever subset the admin needs in their inventory bar.

## Notes

- These files are served as static assets at
  `/assets/sprites/admin/<subfolder>/<file>` once the server is running.
- The renderer (PixiJS, coming later) will load `base/` first, then
  composite the active weapon from `weapons/` on top, exactly the way the
  design doc describes for player characters in section 23.2.
