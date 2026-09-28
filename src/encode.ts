import type { PixelData } from './sorter.ts';

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;
const TYPE_SIZE: Record<number, number> = { [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8 };

const STRIP_BYTES = 256 << 10;

/** Baseline little-endian TIFF, RGB or RGBA, Deflate + horizontal predictor (what Lightroom writes). */
export async function encodeTiff({ width, height, data, bitDepth }: PixelData): Promise<Blob> {
  const alpha = hasTransparency(data);
  const spp = alpha ? 4 : 3;
  const bytesPerSample = bitDepth / 8;
  const rowBytes = width * spp * bytesPerSample;
  const rowsPerStrip = Math.max(1, Math.floor(STRIP_BYTES / rowBytes));

  const strips: Uint8Array<ArrayBuffer>[] = [];
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y);
    strips.push(await deflate(predictedRows(data, width, y, rows, spp, bitDepth)));
  }

  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 8;
  const append = (bytes: Uint8Array<ArrayBuffer>) => {
    const at = offset;
    parts.push(bytes);
    offset += bytes.length;
    if (offset % 2) {
      parts.push(new Uint8Array(1));
      offset++;
    }
    return at;
  };

  const stripOffsets = strips.map(append);
  const entries: [tag: number, type: number, values: number[] | string][] = [
    [256, LONG, [width]],
    [257, LONG, [height]],
    [258, SHORT, Array(spp).fill(bitDepth)],
    [259, SHORT, [8]], // Adobe Deflate
    [262, SHORT, [2]], // RGB
    [273, LONG, stripOffsets],
    [274, SHORT, [1]],
    [277, SHORT, [spp]],
    [278, LONG, [rowsPerStrip]],
    [279, LONG, strips.map((s) => s.length)],
    [282, RATIONAL, [72, 1]],
    [283, RATIONAL, [72, 1]],
    [284, SHORT, [1]],
    [296, SHORT, [2]],
    [305, ASCII, 'Pixel Sorter\0'],
    [317, SHORT, [2]], // horizontal differencing
    ...(alpha ? [[338, SHORT, [2]] as [number, number, number[]]] : []), // unassociated alpha
  ];

  const ifd = new DataView(new ArrayBuffer(2 + entries.length * 12 + 4));
  ifd.setUint16(0, entries.length, true);
  entries.forEach(([tag, type, values], i) => {
    const bytes = encodeValues(type, values);
    const count = typeof values === 'string'
      ? values.length
      : type === RATIONAL
      ? values.length / 2
      : values.length;
    const at = 2 + i * 12;
    ifd.setUint16(at, tag, true);
    ifd.setUint16(at + 2, type, true);
    ifd.setUint32(at + 4, count, true);
    if (bytes.length <= 4) new Uint8Array(ifd.buffer).set(bytes, at + 8);
    else ifd.setUint32(at + 8, append(bytes), true);
  });
  const ifdOffset = append(new Uint8Array(ifd.buffer));

  const header = new DataView(new ArrayBuffer(8));
  header.setUint16(0, 0x4949, true);
  header.setUint16(2, 42, true);
  header.setUint32(4, ifdOffset, true);
  return new Blob([header.buffer, ...parts], { type: 'image/tiff' });
}

function hasTransparency(rgba: Uint16Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 65535) return true;
  return false;
}

function predictedRows(
  rgba: Uint16Array,
  width: number,
  y0: number,
  rows: number,
  spp: number,
  bitDepth: 8 | 16,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(rows * width * spp * (bitDepth / 8));
  const view = new DataView(out.buffer);
  const prev = new Uint16Array(spp);
  let o = 0;
  for (let y = y0; y < y0 + rows; y++) {
    prev.fill(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < spp; c++) {
        const v = bitDepth === 16 ? rgba[i + c] : rgba[i + c] >> 8;
        const d = v - prev[c];
        prev[c] = v;
        if (bitDepth === 16) {
          view.setUint16(o, d & 0xffff, true);
          o += 2;
        } else {
          out[o++] = d & 0xff;
        }
      }
    }
  }
  return out;
}

function encodeValues(type: number, values: number[] | string): Uint8Array<ArrayBuffer> {
  if (typeof values === 'string') return new TextEncoder().encode(values) as Uint8Array<ArrayBuffer>;
  const count = type === RATIONAL ? values.length / 2 : values.length;
  const view = new DataView(new ArrayBuffer(count * TYPE_SIZE[type]));
  values.forEach((v, i) => {
    if (type === SHORT) view.setUint16(i * 2, v, true);
    else view.setUint32(i * 4, v, true);
  });
  return new Uint8Array(view.buffer);
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
