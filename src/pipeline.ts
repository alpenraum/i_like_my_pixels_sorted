import type { LoadedImage } from './images.ts';
import { type Selection, SORT_KEYS, type StepSettings } from './sorter.ts';

export interface Step {
  id: number;
  enabled: boolean;
  angle: number;
  key: number;
  /** Index into LEVELS. */
  levels: number;
  reverse: boolean;
  /** Index into SORT_KEYS, or null to threshold by the sort key. */
  thresholdKey: number | null;
  low: number;
  high: number;
  selection: Selection;
  mask: LoadedImage | null;
  color: [number, number, number];
  /** Slider 0..1. */
  tolerance: number;
  invert: boolean;
  /** Slider 0..1; 1 = unlimited. */
  streak: number;
  randomness: number;
  seed: number;
  edges: number;
}

// Coarse levels leave many ties, and ties keep their original order: texture survives inside streaks.
// 100 matches Void-ux/pixelsort; the last entry is the full 16-bit key.
export const LEVELS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 100, 128, 256, 512, 1024, 4096, 65535];

let nextId = 1;

export function newStep(): Step {
  return {
    id: nextId++,
    enabled: true,
    angle: 270,
    key: 0,
    levels: LEVELS.length - 1,
    reverse: false,
    thresholdKey: null,
    low: 0,
    high: 1,
    selection: 'all',
    mask: null,
    color: [1, 1, 1],
    tolerance: 0.2,
    invert: false,
    streak: 1,
    randomness: 0.5,
    seed: 1,
    edges: 0,
  };
}

/** 4px … 8192px on a log scale; the top of the slider means no limit. */
export function streakLength(slider: number): number {
  return slider >= 1 ? 0 : Math.round(2 ** (2 + slider * 11));
}

// OKLab distances beyond ~0.5 already span very different colors.
const MAX_TOLERANCE = 0.5;

export function toSettings(step: Step): StepSettings {
  return {
    angle: step.angle,
    key: step.key,
    levels: LEVELS[step.levels],
    reverse: step.reverse,
    thresholdKey: step.thresholdKey ?? step.key,
    low: step.low,
    high: step.high,
    selection: step.selection === 'mask' && !step.mask ? 'all' : step.selection,
    mask: step.mask?.pixels ?? null,
    color: step.color,
    tolerance: step.tolerance * MAX_TOLERANCE,
    invert: step.invert,
    streakLength: streakLength(step.streak),
    randomness: step.randomness,
    seed: step.seed,
    edges: step.edges,
  };
}

const ARROWS: Record<number, string> = { 0: '→', 90: '↑', 180: '←', 270: '↓' };

export function summarize(step: Step): string {
  const parts = [`${ARROWS[step.angle] ?? `${step.angle}°`} ${SORT_KEYS[step.key]}`];
  if (step.levels < LEVELS.length - 1) parts.push(`${LEVELS[step.levels]} levels`);
  if (step.selection === 'mask') parts.push(step.mask ? 'mask' : 'no mask');
  if (step.selection === 'color') parts.push('color');
  if (step.streak < 1) parts.push(`${streakLength(step.streak)}px`);
  if (step.edges > 0) parts.push('edges');
  return parts.join(' · ');
}

export const toHex = (c: readonly number[]) =>
  '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
