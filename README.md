# Pixel Sorter

Mask-driven pixel sorting on the GPU (WebGL2). Drop in an image, optionally a mask (white = sort), pick a
direction and sort key, download the result as TIFF or PNG.

Runs as a static website and installs as a desktop app (PWA). Built with Deno, TypeScript and Preact: no node,
no `node_modules`.

## Develop

```sh
deno task dev     # http://localhost:8000, rebuilds on change
deno task check   # type-check + lint
deno task build   # static site in dist/
```

Deployed to <https://pixelsorter.barely-engineered.org> by Cloudflare Workers Builds on every push to `main`:

- Build command: `npx --yes deno@2.9.6 task ci` (install, build, free-tier guard)
- Deploy command: `npx wrangler deploy`

`wrangler.jsonc` is an assets-only Worker: no script ever runs, so every request is a free, unlimited
static-asset request. `tools/free-tier.ts` fails the build if that ever changes. `dist/` also works on any
other static host.

## Pipeline

Source → sort steps → result. Press **+** between any two nodes to insert a step; each step sorts the previous
step's output with its own settings and can be toggled or removed. Per step:

- direction (presets or any angle), sort key, reverse
- **levels**: round the sort key to N steps; the sort is stable, so pixels in the same step keep their order
  and the photo's texture survives inside streaks (100 levels, Lightness, threshold by lightness 25–80%, ↓
  reproduces [Void-ux/pixelsort](https://github.com/Void-ux/pixelsort)'s defaults pixel for pixel)
- threshold range, measured on the sort key or any other key
- **streaks**: length (4 px … unlimited), variation, reroll for a new random pattern
- **edges**: break streaks where brightness jumps across the sort direction
- **selection**: all pixels, a mask image (white = sort) or a color picked from the step's input (OKLab
  distance, adjustable range), optionally inverted

Each step's output stays on the GPU, so editing a step only re-runs it and the steps after it.

## Formats

- PNG, JPEG, WebP, GIF, AVIF, BMP: decoded by the browser
- TIFF (8/16-bit, LZW/Deflate/JPEG/PackBits): [utif2](https://www.npmjs.com/package/utif2)
- Camera raw (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2, …):
  [libraw-wasm](https://www.npmjs.com/package/libraw-wasm), loaded only when a raw file is opened

## Bit depth

TIFF and raw input keep 16 bits per channel through the sort and export as a 16-bit TIFF (Deflate +
predictor), ready for Lightroom, Photoshop or Capture One. 8-bit sources export as 8-bit TIFF. PNG export and
the on-screen preview are 8-bit. Metadata (EXIF, color profile) is not carried over; editors read the untagged
export as sRGB.

## How the sort works

Each sort line runs along the chosen angle. Pixels that are white in the mask and whose key lies inside the
threshold range form runs; each run is sorted independently. On the GPU every pixel gets the key
`runStart << 16 | key`, so one bitonic sort per row sorts all runs at once while keeping them in place. The
sort only moves each pixel's original column; colors are read from the untouched 16-bit source at the end. See
`src/sorter.ts`.

## Design

Follows the cross-app CI in `~/agent-skills/conventions/design.md`; the app's palette and its glitch
extras are in [docs/conventions.md](docs/conventions.md). JetBrains Mono is bundled in `public/fonts/`
under the SIL Open Font License 1.1 ([OFL.txt](public/fonts/OFL.txt)).

By [barely-engineered.org](https://barely-engineered.org) · [GitHub](https://github.com/alpenraum)
