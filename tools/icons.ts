// deno task icons → public/icons/icon-{192,512}.png
// Design CI app icon: line art in two strokes (primary + light text) on a dark neutral tile —
// here, sorted streaks hanging from a common edge.

type Rgb = [number, number, number];

const TILE: Rgb = [0x1c, 0x1b, 0x1b];
const PRIMARY: Rgb = [0xe9, 0x8c, 0x5d];
const LIGHT: Rgb = [0xfd, 0xf8, 0xf8];
const SUPERSAMPLE = 4;

// x centre, bottom end (fractions of the icon), colour.
const STREAKS: [number, number, Rgb][] = [
  [0.26, 0.5, LIGHT],
  [0.35, 0.72, PRIMARY],
  [0.44, 0.58, LIGHT],
  [0.53, 0.8, PRIMARY],
  [0.62, 0.64, LIGHT],
  [0.71, 0.76, PRIMARY],
];
const TOP = 0.26;
const STROKE = 0.045;

function coverage(x: number, y: number): Rgb {
  for (const [cx, bottom, colour] of STREAKS) {
    const r = STROKE / 2;
    const dy = y < TOP ? TOP - y : y > bottom ? y - bottom : 0;
    if ((x - cx) ** 2 + dy ** 2 <= r * r) return colour;
  }
  return TILE;
}

function pixel(size: number, px: number, py: number): Rgb {
  const acc = [0, 0, 0];
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const c = coverage((px + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
      for (let k = 0; k < 3; k++) acc[k] += c[k];
    }
  }
  return acc.map((v) => Math.round(v / SUPERSAMPLE ** 2)) as Rgb;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function png(size: number): Promise<Uint8Array> {
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) raw.set(pixel(size, x, y), row + 1 + x * 3);
  }
  const idat = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ];
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

for (const size of [192, 512]) {
  await Deno.writeFile(`public/icons/icon-${size}.png`, await png(size));
}
