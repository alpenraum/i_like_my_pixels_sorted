# Conventions — Pixel Sorter

Project rules. Cross-project defaults live in `~/agent-skills/conventions/`; this file wins on conflict.

## Stack

Deno + TypeScript + Preact, WebGL2 for sorting. No node, no `node_modules`. `deno task check` (type-check +
`deno lint`) must pass. Decoding and TIFF encoding run in `src/codec-worker.ts`, never on the UI thread.

## Design

Follows `~/agent-skills/conventions/design.md`. **Light app.** Key colour `#E98C5D`.

### Palette

| Token                                                 | Value                                         | Checked contrast (worst surface) |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| `page` / `surface`                                    | `#FDF8F8` / `#FFFFFF`                         | —                                |
| `surface-raised` / `-overlay` / `-track`              | `#F7F3F2` / `#EBE7E7` / `#E5E2E1`             | —                                |
| `border` (interactive) / `border-subtle` (decorative) | `#747878` / `#C4C7C7`                         | 3.5 / —                          |
| `text` / `text-muted`                                 | `#1C1B1B` / `#444748`                         | 13.3 / 7.3                       |
| `primary` / `on-primary`                              | `#E98C5D` / `#0A0A0A`                         | 7.9                              |
| `primary-text`                                        | `#98471C`                                     | 5.0                              |
| `primary-container` / on                              | `#FFE3D6` / `#7B2F04`                         | 7.7                              |
| `warn` / text / container / on                        | `#F4DC4D` / `#6A5F00` / `#F6E8B8` / `#504702` | 14.3 / 5.0 / 7.7                 |
| `cancel` (neutral) / text / container / on            | `#919191` / `#5E5E5E` / `#E8E8E8` / `#474747` | 6.3 / 5.0 / 7.6                  |
| `error` / text / container / on                       | `#E9334C` / `#BD0734` / `#FFE2E0` / `#920025` | 4.8 / 5.0 / 7.7                  |

`cancel` is achromatic and `error` a true red because the orange key colour occupies the orange family
(design.md: ≥ 25° hue distance). Error sits 28° from the key.

### Expressive layer (app-specific)

The glitch theme gets more voice than the CI default. Allowed here, nowhere else:

- **Glitch type.** The wordmark (mono, weight 800, stacked) and the empty-state prompt split into
  misregistered horizontal slices for ~300 ms every few seconds, in `primary` and `text` only — no extra
  hues, no blur.
- **Neon glow** (design.md geometry) on three things only: the Download button on hover, focus and while
  exporting; the selected pipeline step; a drop target while a file is dragged over it.
- **Monospace for every readout**: slider values, step summaries, the status line. The status line reads like
  a terminal (`>` prompt, blinking block caret while decoding).
- **Hover glitch.** Buttons, segmented options, drop zones and step headers jitter (± 2 px) and flash one torn
  slice — `primary`, or `text` on orange fills — for 150 ms in stepped frames when the pointer enters.
  Disabled controls stay still.
- All of the above stops under `prefers-reduced-motion: reduce`; colours and layout stay.
