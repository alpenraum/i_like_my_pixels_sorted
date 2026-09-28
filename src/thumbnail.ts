import type { PixelData } from './sorter.ts';

const THUMBNAIL_SIZE = 320;

export function thumbnail({ width, height, data }: PixelData): Promise<Blob> {
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const small = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = Math.min(height - 1, Math.floor(y / scale)) * width;
    for (let x = 0; x < w; x++) {
      const i = (row + Math.min(width - 1, Math.floor(x / scale))) * 4;
      for (let c = 0; c < 4; c++) small.data[(y * w + x) * 4 + c] = data[i + c] >> 8;
    }
  }
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.putImageData(small, 0, 0);
  return canvas.convertToBlob();
}
