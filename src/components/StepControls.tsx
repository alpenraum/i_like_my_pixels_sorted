import type { ComponentChildren } from 'preact';
import { fromHex, LEVELS, type Step, streakLength, toHex } from '../pipeline.ts';
import { type Selection, SORT_KEYS } from '../sorter.ts';
import { ImageSlot } from './ImageSlot.tsx';

export type StepPatch = Partial<Step> | ((current: Step) => Partial<Step>);

interface Props {
  step: Step;
  picking: boolean;
  onChange: (patch: StepPatch) => void;
  onMaskFile: (file: File) => void;
  onMaskClear: () => void;
  onTogglePick: () => void;
}

const PRESETS = [
  { angle: 0, label: '→', name: 'Right' },
  { angle: 90, label: '↑', name: 'Up' },
  { angle: 180, label: '←', name: 'Left' },
  { angle: 270, label: '↓', name: 'Down' },
];

const SELECTIONS: { value: Selection; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mask', label: 'Mask' },
  { value: 'color', label: 'Color' },
];

const percent = (v: number) => `${Math.round(v * 100)}%`;

function Range(
  { label, value, output, step = 0.005, min = 0, max = 1, onInput }: {
    label: string;
    value: number;
    output: string;
    step?: number;
    min?: number;
    max?: number;
    onInput: (value: number) => void;
  },
) {
  return (
    <label class='range'>
      <span>{label}</span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onInput(e.currentTarget.valueAsNumber)}
      />
      <output>{output}</output>
    </label>
  );
}

/** Pill track with a sliding selection pill (design.md: segmented toggle). */
function Segmented(
  { count, index, children }: { count: number; index: number; children: ComponentChildren },
) {
  return (
    <div
      class='segmented'
      style={`--count:${count};--index:${Math.max(index, 0)}`}
      data-none={index < 0 || undefined}
    >
      {children}
    </div>
  );
}

export function StepControls({ step, picking, onChange, onMaskFile, onMaskClear, onTogglePick }: Props) {
  const length = streakLength(step.streak);

  return (
    <form class='controls' onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Direction</legend>
        <Segmented count={PRESETS.length} index={PRESETS.findIndex((p) => p.angle === step.angle)}>
          {PRESETS.map((p) => (
            <button
              key={p.angle}
              type='button'
              title={p.name}
              aria-label={p.name}
              aria-pressed={step.angle === p.angle}
              onClick={() => onChange({ angle: p.angle })}
            >
              {p.label}
            </button>
          ))}
        </Segmented>
        <Range
          label='Angle'
          value={step.angle}
          step={1}
          max={359}
          output={`${step.angle}°`}
          onInput={(angle) => onChange({ angle })}
        />
      </fieldset>

      <fieldset>
        <legend>Sort by</legend>
        <select value={step.key} onChange={(e) => onChange({ key: Number(e.currentTarget.value) })}>
          {SORT_KEYS.map((name, i) => <option key={name} value={i}>{name}</option>)}
        </select>
        <Range
          label='Levels'
          value={step.levels}
          step={1}
          max={LEVELS.length - 1}
          output={step.levels === LEVELS.length - 1 ? 'Smooth' : String(LEVELS[step.levels])}
          onInput={(levels) => onChange({ levels })}
        />
        <p class='hint'>Fewer levels keep more of the photo's texture inside streaks.</p>
        <label class='check'>
          <input
            type='checkbox'
            checked={step.reverse}
            onChange={(e) => onChange({ reverse: e.currentTarget.checked })}
          />
          Reverse order
        </label>
      </fieldset>

      <fieldset>
        <legend>Threshold</legend>
        <select
          aria-label='Threshold by'
          value={step.thresholdKey ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ thresholdKey: v === '' ? null : Number(v) });
          }}
        >
          <option value=''>By sort value</option>
          {SORT_KEYS.map((name, i) => <option key={name} value={i}>By {name.toLowerCase()}</option>)}
        </select>
        <Range
          label='Min'
          value={step.low}
          output={percent(step.low)}
          onInput={(low) => onChange((s) => ({ low, high: Math.max(low, s.high) }))}
        />
        <Range
          label='Max'
          value={step.high}
          output={percent(step.high)}
          onInput={(high) => onChange((s) => ({ high, low: Math.min(high, s.low) }))}
        />
        <p class='hint'>Only pixels whose value falls in this range get sorted.</p>
      </fieldset>

      <fieldset>
        <legend>Streaks</legend>
        <Range
          label='Length'
          value={step.streak}
          output={length ? `${length}px` : '∞'}
          onInput={(streak) => onChange({ streak })}
        />
        <Range
          label='Vary'
          value={step.randomness}
          output={percent(step.randomness)}
          onInput={(randomness) => onChange({ randomness })}
        />
        <Range
          label='Edges'
          value={step.edges}
          output={step.edges ? percent(step.edges) : 'off'}
          onInput={(edges) => onChange({ edges })}
        />
        <div class='row'>
          <p class='hint'>Edges break streaks where brightness jumps.</p>
          <button
            type='button'
            class='btn outline'
            title='New random streak pattern'
            disabled={!length}
            onClick={() => onChange((s) => ({ seed: s.seed + 1 }))}
          >
            Reroll
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Selection</legend>
        <Segmented count={SELECTIONS.length} index={SELECTIONS.findIndex((s) => s.value === step.selection)}>
          {SELECTIONS.map(({ value, label }) => (
            <button
              key={value}
              type='button'
              aria-pressed={step.selection === value}
              onClick={() => onChange({ selection: value })}
            >
              {label}
            </button>
          ))}
        </Segmented>

        {step.selection === 'mask' && (
          <ImageSlot
            label='Mask'
            hint='White = sort'
            value={step.mask}
            onFile={onMaskFile}
            onClear={onMaskClear}
          />
        )}

        {step.selection === 'color' && (
          <>
            <div class='color-pick'>
              <input
                type='color'
                aria-label='Color to sort'
                value={toHex(step.color)}
                onInput={(e) => onChange({ color: fromHex(e.currentTarget.value) })}
              />
              <button type='button' class='btn outline' aria-pressed={picking} onClick={onTogglePick}>
                {picking ? 'Click the image…' : 'Pick from image'}
              </button>
            </div>
            <Range
              label='Range'
              value={step.tolerance}
              output={percent(step.tolerance)}
              onInput={(tolerance) => onChange({ tolerance })}
            />
          </>
        )}

        {step.selection !== 'all' && (
          <label class='check'>
            <input
              type='checkbox'
              checked={step.invert}
              onChange={(e) => onChange({ invert: e.currentTarget.checked })}
            />
            Invert selection
          </label>
        )}
      </fieldset>
    </form>
  );
}
