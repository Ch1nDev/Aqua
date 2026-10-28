# Aqua artwork

Drop optional custom artwork in this folder. Files are bundled into the app automatically; no code changes are needed.

## Dashboard background

This image is the fallback: when the selected version belongs to a Minecraft game
drop, that drop's stylized key art is shown instead. Versions released before the
published drops — 1.19.4 and older — use the file below, as does the launcher
before a profile is selected.

Use one of these file names (first match wins):

- `background.png`
- `background.jpg`
- `background.jpeg`
- `background.webp`

Recommended: 1600 × 700 or larger, landscape, with the main subject toward the right. The launcher places its title, profile picker, and Play button over the left side, so keep that area visually quiet and reasonably dark.

## Title artwork

Use one of these file names (first match wins):

- `title.png`
- `title.webp`
- `title.svg`

Use a transparent PNG or WebP with the wordmark on a transparent background. Recommended height: 160–320 px. The launcher renders it at a maximum height of 72 px on the dashboard, preserving its aspect ratio.

If either image is missing, Aqua falls back to its built-in pixel wordmark and voxel illustration. Run `npm run dev` while editing these files; production builds copy them into `dist/artwork/`.

## Mod loader logos

Each loader's logo can be supplied the same way, named exactly after the loader:

- `fabric.png`
- `forge.png`
- `neoforge.png`
- `quilt.png`

`.webp` and `.svg` are accepted too (first match wins). A square image on a
transparent background works best; it is shown at 24 px, so at least 48 × 48 px
keeps it crisp. Any loader without a file falls back to the launcher's built-in
emblem, so you can add them one at a time.
