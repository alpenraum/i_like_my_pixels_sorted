// @ts-types="npm:utif2@^4.1.0/UTIF.d.ts"
import * as UTIF from 'utif2';
import type LibRaw from 'libraw-wasm';
import { RAW_EXTENSIONS } from './formats.ts';
import type { PixelData } from './sorter.ts';

export async function decodeImage(blob: Blob): Promise<PixelData> {
  const name = blob instanceof File ? blob.name : '';
  if (RAW_EXTENSIONS.test(name)) return decodeRaw(blob);
  if (blob.type === 'image/tiff' || /\.tiff?$/i.test(name) || await hasTiffMagic(blob)) {
    return decodeTiff(blob);
  }
  return decodeWithBrowser(blob);
}

async function hasTiffMagic(blob: Blob): Promise<boolean> {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a);
}

async function decodeWithBrowser(blob: Blob): Promise<PixelData> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const { width, height } = bitmap;
  const ctx = new OffscreenCanvas(width, height).getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return toRgba16(ctx.getImageData(0, 0, width, height).data, width, height, 4, 3, 8);
}

async function decodeTiff(blob: Blob): Promise<PixelData> {
  const buffer = await blob.arrayBuffer();
  const pages = UTIF.decode(buffer);
  const tag = (ifd: UTIF.IFD, id: number) => (ifd[`t${id}`] as number[] | undefined)?.[0];
  // Page 0 is sometimes a thumbnail; the biggest page is the real image.
  const page = pages.reduce((best, ifd) =>
    (tag(ifd, 256) ?? 0) * (tag(ifd, 257) ?? 0) > (tag(best, 256) ?? 0) * (tag(best, 257) ?? 0) ? ifd : best
  );
  UTIF.decodeImage(buffer, page);
  const { width, height, data } = page;

  const bits = tag(page, 258) ?? 1;
  const photometric = tag(page, 262) ?? 2;
  const samples = tag(page, 277) ?? 1;
  const planar = tag(page, 284) ?? 1;
  const format = tag(page, 339) ?? 1;
  const channels = photometric === 2 ? 3 : photometric === 1 ? 1 : 0;
  if (bits === 16 && format === 1 && planar === 1 && channels && samples >= channels) {
    // UTIF leaves decoded 16-bit samples little-endian regardless of the file's byte order.
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const src = new Uint16Array(width * height * samples);
    for (let i = 0; i < src.length; i++) src[i] = view.getUint16(i * 2, true);
    return toRgba16(src, width, height, samples, channels, 16);
  }
  return toRgba16(UTIF.toRGBA8(page), width, height, 4, 3, 8);
}

async function decodeRaw(blob: Blob): Promise<PixelData> {
  // Loaded at runtime from dist/vendor: its worker and .wasm are fetched relative to the module URL.
  // `location` is this worker script's URL, which sits next to vendor/.
  const url = new URL('vendor/libraw/index.js', location.href).href;
  const { default: LibRawClass }: { default: typeof LibRaw } = await import(url);
  const raw = new LibRawClass();
  try {
    await raw.open(new Uint8Array(await blob.arrayBuffer()), { useCameraWb: true, outputBps: 16 });
    const image = await raw.imageData();
    if (!image) throw new Error('LibRaw returned no image');
    const { data, width, height, colors } = image;
    return toRgba16(data, width, height, colors, Math.min(colors, 3), data instanceof Uint16Array ? 16 : 8);
  } finally {
    raw.dispose();
  }
}

/**
 * Interleaved samples → 16-bit RGBA. `stride` is samples per pixel, `channels` how many of those are
 * color (1 = gray, 3 = RGB); a sample right after the color ones is treated as alpha.
 */
function toRgba16(
  src: ArrayLike<number>,
  width: number,
  height: number,
  stride: number,
  channels: number,
  bitDepth: 8 | 16,
): PixelData {
  const scale = bitDepth === 8 ? 257 : 1;
  const data = new Uint16Array(width * height * 4);
  const hasAlpha = stride > channels;
  const g = channels === 3 ? 1 : 0;
  const b = channels === 3 ? 2 : 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j += stride) {
    data[i] = src[j] * scale;
    data[i + 1] = src[j + g] * scale;
    data[i + 2] = src[j + b] * scale;
    data[i + 3] = hasAlpha ? src[j + channels] * scale : 65535;
  }
  return { width, height, data, bitDepth };
}
