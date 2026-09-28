// GPU pixel sorter (WebGL2).
//
// A pipeline of sort steps; each step reads the previous step's output. Per step, in a "rotated space"
// whose rows run along the sort direction:
//   gather   – sample input into rotated space, tag sortable pixels and run breaks, compute 16-bit key
//   scan     – per-row prefix max to find the start index of each sortable run
//   combine  – pack (runStart << 16 | key) into one uint so a plain row sort keeps runs in place
//   bitonic  – full row sort on that uint; each texel carries its original column, not its color
//   result   – map each pixel into rotated space, follow the column back to an input pixel
//
// Colors live only in RGBA16UI textures, so 16-bit input survives to 16-bit export.

export const SORT_KEYS = [
  'Luminance',
  'Lightness',
  'Hue',
  'Saturation',
  'Brightness',
  'Red',
  'Green',
  'Blue',
] as const;

export interface PixelData {
  width: number;
  height: number;
  /** RGBA, 16 bits per channel, top row first. */
  data: Uint16Array;
  bitDepth: 8 | 16;
}

export type Selection = 'all' | 'mask' | 'color';

export interface StepSettings {
  /** Degrees, counter-clockwise, 0 = sort left→right. */
  angle: number;
  /** Index into SORT_KEYS. */
  key: number;
  /** The key is rounded down to this many steps (1..65535); pixels in the same step keep their order. */
  levels: number;
  reverse: boolean;
  /** Index into SORT_KEYS; only pixels whose value of it lies in [low, high] (0..1) are sorted. */
  thresholdKey: number;
  low: number;
  high: number;
  selection: Selection;
  /** Used when selection is 'mask': white = sort. */
  mask: PixelData | null;
  /** Used when selection is 'color': sRGB 0..1, and max OKLab distance from it. */
  color: readonly [number, number, number];
  tolerance: number;
  /** Flips the mask or color selection. */
  invert: boolean;
  /** Mean streak length in px; 0 = unlimited. */
  streakLength: number;
  /** 0 = every streak exactly streakLength, 1 = anywhere from 0 to twice that. */
  randomness: number;
  seed: number;
  /** 0 = off; higher breaks runs at weaker brightness edges. */
  edges: number;
}

/** What the canvas shows: the sorted result, the untouched source, or the input of step n. */
export type View = 'result' | 'source' | { input: number };

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };
type Scratch = { data: [Target, Target]; scan: [Target, Target] };
type UniformValue = number | boolean | readonly number[];
type Uniforms = Record<string, UniformValue>;
type Program = { program: WebGLProgram; set: (name: string, value: UniformValue) => void };
type ProgramName = 'gather' | 'scanInit' | 'scanStep' | 'combine' | 'bitonic' | 'result' | 'blit';

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
`;

const COMMON = `
uniform usampler2D uImage;
uniform vec2 uImageSize;
uniform vec2 uRotSize;
uniform vec2 uDir;
uniform int uKey;
uniform int uThresholdKey;
uniform vec2 uRange;
uniform int uSelection;
uniform sampler2D uMask;
uniform vec3 uColor;
uniform float uTolerance;
uniform bool uInvert;

vec2 perp(vec2 d) { return vec2(-d.y, d.x); }

vec2 rotatedToImage(vec2 r) {
  vec2 q = r - uRotSize * 0.5;
  return uImageSize * 0.5 + q.x * uDir + q.y * perp(uDir);
}

vec2 imageToRotated(vec2 p) {
  vec2 q = p - uImageSize * 0.5;
  return uRotSize * 0.5 + vec2(dot(q, uDir), dot(q, perp(uDir)));
}

vec4 sourceColor(ivec2 px) { return vec4(texelFetch(uImage, px, 0)) / 65535.0; }

vec3 toHsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float d = mx - min(c.r, min(c.g, c.b));
  float h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, mx > 0.0 ? d / mx : 0.0, mx);
}

float keyValue(vec3 c, int key) {
  switch (key) {
    case 1: return (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b))) * 0.5;
    case 2: return toHsv(c).x;
    case 3: return toHsv(c).y;
    case 4: return toHsv(c).z;
    case 5: return c.r;
    case 6: return c.g;
    case 7: return c.b;
    default: return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }
}

vec3 toOklab(vec3 c) {
  vec3 lin = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619,
                  0.5363325363, 0.6806995451, 0.2817188376,
                  0.0514459929, 0.1073969566, 0.6299787005) * lin;
  lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371,
              0.7936177850, -2.4285922050, 0.7827717662,
              -0.0040720468, 0.4505937099, -0.8086757660) * lms;
}

bool isSortable(ivec2 px, vec3 color) {
  // GPU float math can land a hair past a bound that the exact value sits on; 8-bit values are 1/510 apart.
  float t = keyValue(color, uThresholdKey);
  if (t < uRange.x - 1e-5 || t > uRange.y + 1e-5) return false;
  if (uSelection == 0) return true;
  bool on;
  if (uSelection == 1) {
    vec4 m = texture(uMask, (vec2(px) + 0.5) / uImageSize);
    on = dot(m.rgb, vec3(0.299, 0.587, 0.114)) * m.a > 0.5;
  } else {
    on = distance(toOklab(color), uColor) <= uTolerance;
  }
  return on != uInvert;
}
`;

const GATHER = `
uniform bool uReverse;
uniform float uLevels;
uniform float uStreak;
uniform float uRandomness;
uniform int uSeed;
uniform float uEdges;
out uvec2 outData;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

float random(int a, int b) {
  return float(pcg3d(uvec3(uint(a), uint(b), uint(uSeed))).x >> 8) / 16777216.0;
}

// Breaks sit on a jittered grid of pitch uStreak, shifted per row so streak ends don't line up.
// Jitter stays within ±pitch/2, so only the three nearest grid points can land on this texel.
bool streakBreak(ivec2 r) {
  if (uStreak <= 0.0) return false;
  float x = float(r.x) + random(r.y, -1) * uStreak;
  int here = int(floor(x));
  int k0 = int(floor(x / uStreak));
  for (int k = k0 - 1; k <= k0 + 1; k++) {
    float jitter = (random(k, r.y) - 0.5) * uRandomness * uStreak;
    if (int(floor(float(k) * uStreak + jitter)) == here) return true;
  }
  return false;
}

float luma(ivec2 p) {
  return dot(sourceColor(clamp(p, ivec2(0), ivec2(uImageSize) - 1)).rgb, vec3(0.2126, 0.7152, 0.0722));
}

// Only the gradient component along the sort line matters: an edge running parallel to the
// streaks shouldn't cut them.
bool edgeBreak(ivec2 p) {
  if (uEdges <= 0.0) return false;
  float tl = luma(p + ivec2(-1, -1)), t = luma(p + ivec2(0, -1)), tr = luma(p + ivec2(1, -1));
  float l = luma(p + ivec2(-1, 0)), r = luma(p + ivec2(1, 0));
  float bl = luma(p + ivec2(-1, 1)), b = luma(p + ivec2(0, 1)), br = luma(p + ivec2(1, 1));
  vec2 g = vec2((tr + 2.0 * r + br) - (tl + 2.0 * l + bl), (bl + 2.0 * b + br) - (tl + 2.0 * t + tr)) / 4.0;
  return abs(dot(g, uDir)) > mix(0.5, 0.01, uEdges);
}

void main() {
  ivec2 r = ivec2(gl_FragCoord.xy);
  ivec2 px = ivec2(floor(rotatedToImage(gl_FragCoord.xy)));
  uint flags = 0u;
  uint key = 0u;
  if (all(greaterThanEqual(px, ivec2(0))) && all(lessThan(px, ivec2(uImageSize)))) {
    vec3 c = sourceColor(px).rgb;
    if (isSortable(px, c)) flags = 1u;
    if (streakBreak(r) || edgeBreak(px)) flags |= 2u;
    key = uint(floor(clamp(keyValue(c, uKey), 0.0, 1.0) * uLevels + 1e-3));
    if (uReverse) key = uint(uLevels) - key;
  }
  outData = uvec2((flags << 16) | key, uint(r.x));
}
`;

const SCAN_INIT = `
uniform usampler2D uData;
out uint outValue;

uint flags(ivec2 p) { return texelFetch(uData, p, 0).x >> 16; }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  bool continuesRun = flags(p) == 1u && p.x > 0 && (flags(p - ivec2(1, 0)) & 1u) != 0u;
  outValue = continuesRun ? 0u : uint(p.x);
}
`;

const SCAN_STEP = `
uniform usampler2D uScan;
uniform int uStep;
out uint outValue;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uint v = texelFetch(uScan, p, 0).x;
  if (p.x >= uStep) v = max(v, texelFetch(uScan, p - ivec2(uStep, 0), 0).x);
  outValue = v;
}
`;

const COMBINE = `
uniform usampler2D uData;
uniform usampler2D uScan;
out uvec2 outData;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uvec2 d = texelFetch(uData, p, 0).xy;
  outData = uvec2((texelFetch(uScan, p, 0).x << 16) | (d.x & 0xFFFFu), d.y);
}
`;

// Every block sorts ascending (first step of each stage mirrors instead of xor-ing),
// so out-of-range partners act as +inf padding and non-power-of-two rows just work.
const BITONIC = `
uniform usampler2D uData;
uniform int uBlock;
uniform int uDist;
uniform bool uFlip;
uniform int uWidth;
out uvec2 outData;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int partner = uFlip ? (p.x ^ (uBlock - 1)) : (p.x ^ uDist);
  uvec2 a = texelFetch(uData, p, 0).xy;
  if (partner >= uWidth) {
    outData = a;
    return;
  }
  uvec2 b = texelFetch(uData, ivec2(partner, p.y), 0).xy;
  // Ties fall back to the original column (y), which makes the sort stable.
  bool bFirst = b.x < a.x || (b.x == a.x && b.y < a.y);
  bool takeB = p.x < partner ? bFirst : !bFirst;
  outData = takeB ? b : a;
}
`;

const RESULT = `
uniform usampler2D uData;
out uvec4 outColor;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 c = sourceColor(px).rgb;
  if (!isSortable(px, c)) {
    outColor = texelFetch(uImage, px, 0);
    return;
  }
  ivec2 r = clamp(ivec2(floor(imageToRotated(vec2(px) + 0.5))), ivec2(0), ivec2(uRotSize) - 1);
  vec2 origin = vec2(float(texelFetch(uData, r, 0).y), float(r.y)) + 0.5;
  ivec2 src = clamp(ivec2(floor(rotatedToImage(origin))), ivec2(0), ivec2(uImageSize) - 1);
  outColor = texelFetch(uImage, src, 0);
}
`;

const BLIT = `
uniform usampler2D uImage;
uniform vec2 uImageSize;
out vec4 outColor;

void main() {
  ivec2 px = ivec2(int(gl_FragCoord.x), int(uImageSize.y) - 1 - int(gl_FragCoord.y));
  outColor = vec4(texelFetch(uImage, px, 0)) / 65535.0;
}
`;

const SELECTIONS: Record<Selection, number> = { all: 0, mask: 1, color: 2 };

export class PixelSorter {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly maxSize: number;
  private readonly programs: Record<ProgramName, Program>;
  private readonly emptyMask: WebGLTexture;
  private source: (Target & { width: number; height: number }) | null = null;
  /** Output of each step, keyed by everything that produced it so unchanged prefixes are reused. */
  private steps: { key: string; output: Target }[] = [];
  private scratch = new Map<string, Scratch>();
  private masks = new Map<PixelData, { tex: WebGLTexture; id: number }>();
  private nextMaskId = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
    });
    if (!gl) throw new Error('This browser does not support WebGL 2.');

    this.canvas = canvas;
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.programs = {
      gather: createProgram(gl, COMMON + GATHER, { uImage: 0, uMask: 1 }),
      scanInit: createProgram(gl, SCAN_INIT, { uData: 2 }),
      scanStep: createProgram(gl, SCAN_STEP, { uScan: 3 }),
      combine: createProgram(gl, COMBINE, { uData: 2, uScan: 3 }),
      bitonic: createProgram(gl, BITONIC, { uData: 2 }),
      result: createProgram(gl, COMMON + RESULT, { uImage: 0, uMask: 1, uData: 2 }),
      blit: createProgram(gl, BLIT, { uImage: 0 }),
    };
    this.emptyMask = createTexture(gl, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  setImage(image: PixelData | null): void {
    const gl = this.gl;
    if (this.source) deleteTarget(gl, this.source);
    for (const { output } of this.steps) deleteTarget(gl, output);
    this.source = null;
    this.steps = [];
    if (!image) return;
    const { width, height, data } = image;
    if (Math.max(width, height) > this.maxSize) {
      throw new Error(`Image too large: this GPU allows at most ${this.maxSize}px per side.`);
    }
    const target = createTarget(gl, width, height, gl.RGBA16UI);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, data);
    this.source = { ...target, width, height };
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Runs the pipeline, reusing cached outputs up to the first step whose settings changed. */
  render(steps: readonly StepSettings[]): void {
    if (!this.source) return;
    const gl = this.gl;
    const { width, height } = this.source;
    const usedSizes = new Set<string>();
    const usedMasks = new Set<PixelData>();
    let input: Target = this.source;
    let key = '';

    steps.forEach((step, i) => {
      const mask = step.selection === 'mask' && step.mask ? this.#maskTexture(step.mask) : null;
      if (step.mask && mask) usedMasks.add(step.mask);
      key += JSON.stringify({ ...step, mask: mask?.id ?? null }) + '\n';
      const cached = this.steps[i];
      if (cached?.key !== key) {
        const output = cached?.output ?? createTarget(gl, width, height, gl.RGBA16UI);
        this.#runStep(step, input, mask?.tex ?? this.emptyMask, output, usedSizes);
        this.steps[i] = { key, output };
      }
      input = this.steps[i].output;
    });

    for (const { output } of this.steps.splice(steps.length)) deleteTarget(gl, output);
    for (const [size, scratch] of this.scratch) {
      if (usedSizes.has(size)) continue;
      for (const t of [...scratch.data, ...scratch.scan]) deleteTarget(gl, t);
      this.scratch.delete(size);
    }
    for (const [pixels, { tex }] of this.masks) {
      if (usedMasks.has(pixels)) continue;
      gl.deleteTexture(tex);
      this.masks.delete(pixels);
    }
  }

  present(view: View): void {
    const target = this.#viewTarget(view);
    if (!target || !this.source) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.source.width, this.source.height);
    this.#bind(0, target.tex);
    this.#draw('blit', null, { uImageSize: [this.source.width, this.source.height] });
  }

  /** The 16-bit color at (x, y) of a view, as 0..1 floats. */
  sample(view: View, x: number, y: number): [number, number, number] {
    const target = this.#viewTarget(view);
    if (!target) throw new Error('No image loaded.');
    const gl = this.gl;
    const px = new Uint32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [px[0] / 65535, px[1] / 65535, px[2] / 65535];
  }

  /** Full-precision copy of the result: RGBA, 16 bits per channel, top row first. */
  exportPixels(): Uint16Array {
    const target = this.#viewTarget('result');
    if (!target || !this.source) throw new Error('Nothing to export yet.');
    const gl = this.gl;
    const { width, height } = this.source;
    const out = new Uint16Array(width * height * 4);
    // RGBA_INTEGER/UNSIGNED_INT is the one read format WebGL2 guarantees for integer targets;
    // reading in strips keeps that 32-bit staging buffer small.
    const rows = Math.max(1, Math.floor((16 << 20) / (width * 16)));
    const staging = new Uint32Array(width * rows * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    for (let y = 0; y < height; y += rows) {
      const n = Math.min(rows, height - y);
      gl.readPixels(0, y, width, n, gl.RGBA_INTEGER, gl.UNSIGNED_INT, staging);
      out.set(staging.subarray(0, width * n * 4), y * width * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  #viewTarget(view: View): Target | null {
    if (!this.source) return null;
    if (view === 'source') return this.source;
    const before = view === 'result' ? this.steps.length : Math.min(view.input, this.steps.length);
    return before > 0 ? this.steps[before - 1].output : this.source;
  }

  #runStep(step: StepSettings, input: Target, mask: WebGLTexture, output: Target, usedSizes: Set<string>) {
    const gl = this.gl;
    const { width, height } = this.source!;
    const dir = direction(step.angle);
    const rw = Math.ceil(Math.abs(width * dir[0]) + Math.abs(height * dir[1]) - 1e-6);
    const rh = Math.ceil(Math.abs(width * dir[1]) + Math.abs(height * dir[0]) - 1e-6);
    if (Math.max(rw, rh) > this.maxSize) {
      throw new Error(
        `At ${step.angle}° the image needs ${Math.max(rw, rh)}px; this GPU allows ${this.maxSize}px.`,
      );
    }
    const t = this.#scratch(rw, rh);
    usedSizes.add(`${rw}x${rh}`);

    const shared: Uniforms = {
      uImageSize: [width, height],
      uRotSize: [rw, rh],
      uDir: dir,
      uKey: step.key,
      uThresholdKey: step.thresholdKey,
      uRange: [step.low, step.high],
      uSelection: SELECTIONS[step.selection],
      uColor: toOklab(step.color),
      uTolerance: step.tolerance,
      uInvert: step.invert,
    };

    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, rw, rh);
    this.#bind(0, input.tex);
    this.#bind(1, mask);
    this.#draw('gather', t.data[0], {
      ...shared,
      uReverse: step.reverse,
      uStreak: step.streakLength,
      uRandomness: step.randomness,
      uSeed: step.seed,
      uEdges: step.edges,
      uLevels: step.levels,
    });

    this.#bind(2, t.data[0].tex);
    this.#draw('scanInit', t.scan[0]);
    let scan = 0;
    for (let s = 1; s < rw; s *= 2) {
      this.#bind(3, t.scan[scan].tex);
      this.#draw('scanStep', t.scan[1 - scan], { uStep: s });
      scan = 1 - scan;
    }
    this.#bind(3, t.scan[scan].tex);
    this.#draw('combine', t.data[1]);

    let src = 1;
    const n = nextPowerOfTwo(rw);
    for (let block = 2; block <= n; block *= 2) {
      for (let dist = block >> 1; dist > 0; dist >>= 1) {
        this.#bind(2, t.data[src].tex);
        this.#draw('bitonic', t.data[1 - src], {
          uBlock: block,
          uDist: dist,
          uFlip: dist === block >> 1,
          uWidth: rw,
        });
        src = 1 - src;
      }
    }

    gl.viewport(0, 0, width, height);
    this.#bind(0, input.tex);
    this.#bind(1, mask);
    this.#bind(2, t.data[src].tex);
    this.#draw('result', output, shared);
  }

  #maskTexture(mask: PixelData) {
    let entry = this.masks.get(mask);
    if (!entry) {
      const gl = this.gl;
      // Integer textures can't be filtered; a mask of a different size needs LINEAR, so drop it to 8 bits.
      const bytes = new Uint8Array(mask.data.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = mask.data[i] >> 8;
      const tex = createTexture(gl, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, mask.width, mask.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      entry = { tex, id: this.nextMaskId++ };
      this.masks.set(mask, entry);
    }
    return entry;
  }

  #scratch(w: number, h: number): Scratch {
    const size = `${w}x${h}`;
    let scratch = this.scratch.get(size);
    if (!scratch) {
      const gl = this.gl;
      scratch = {
        data: [createTarget(gl, w, h, gl.RG32UI), createTarget(gl, w, h, gl.RG32UI)],
        scan: [createTarget(gl, w, h, gl.R32UI), createTarget(gl, w, h, gl.R32UI)],
      };
      this.scratch.set(size, scratch);
    }
    return scratch;
  }

  #bind(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  #draw(name: ProgramName, target: Target | null, uniforms: Uniforms = {}): void {
    const gl = this.gl;
    const prog = this.programs[name];
    gl.useProgram(prog.program);
    for (const [k, v] of Object.entries(uniforms)) prog.set(k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// Multiples of 90° are exact so the rotate→sort→rotate-back round trip is lossless.
const EXACT_DIRECTIONS: readonly (readonly [number, number])[] = [[1, 0], [0, -1], [-1, 0], [0, 1]];

/** Unit vector in y-down image space for a counter-clockwise angle in degrees. */
function direction(angle: number): [number, number] {
  const a = ((angle % 360) + 360) % 360;
  if (a % 90 === 0) return [...EXACT_DIRECTIONS[a / 90]];
  const r = (a * Math.PI) / 180;
  return [Math.cos(r), -Math.sin(r)];
}

export function toOklab([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

function createProgram(
  gl: WebGL2RenderingContext,
  fragmentBody: string,
  samplers: Record<string, number>,
): Program {
  const program = gl.createProgram();
  const stages: [number, string][] = [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, HEADER + fragmentBody],
  ];
  for (const [type, src] of stages) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const setters: Record<string, (value: UniformValue) => void> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name, type } = gl.getActiveUniform(program, i)!;
    const loc = gl.getUniformLocation(program, name);
    setters[name] = type === gl.FLOAT_VEC3
      ? (v) => gl.uniform3fv(loc, v as number[])
      : type === gl.FLOAT_VEC2
      ? (v) => gl.uniform2fv(loc, v as number[])
      : type === gl.FLOAT
      ? (v) => gl.uniform1f(loc, v as number)
      : (v) => gl.uniform1i(loc, Number(v));
  }
  gl.useProgram(program);
  for (const [name, unit] of Object.entries(samplers)) setters[name]?.(unit);

  return { program, set: (name, value) => setters[name]?.(value) };
}

function createTexture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createTarget(gl: WebGL2RenderingContext, w: number, h: number, internalFormat: number): Target {
  const tex = createTexture(gl, gl.NEAREST);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('GPU could not allocate sort buffers (out of memory?).');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

function deleteTarget(gl: WebGL2RenderingContext, { tex, fbo }: Target): void {
  gl.deleteTexture(tex);
  gl.deleteFramebuffer(fbo);
}
