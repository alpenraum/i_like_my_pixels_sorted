import { type ComponentChildren, Fragment } from 'preact';
import type { LoadedImage } from '../images.ts';
import { type Step, summarize } from '../pipeline.ts';
import { ImageSlot } from './ImageSlot.tsx';

interface Props {
  image: LoadedImage | null;
  steps: Step[];
  selectedId: number | null;
  onImageFile: (file: File) => void;
  onImageClear: () => void;
  onSelect: (id: number | null) => void;
  onInsert: (index: number) => void;
  onToggle: (id: number) => void;
  onRemove: (id: number) => void;
  renderControls: (step: Step) => ComponentChildren;
}

function Insert({ onClick }: { onClick: () => void }) {
  return (
    <li class='link'>
      <button
        type='button'
        class='insert'
        aria-label='Add a sort step here'
        title='Add a sort step'
        onClick={onClick}
      >
        +
      </button>
    </li>
  );
}

export function Pipeline(
  {
    image,
    steps,
    selectedId,
    onImageFile,
    onImageClear,
    onSelect,
    onInsert,
    onToggle,
    onRemove,
    renderControls,
  }: Props,
) {
  return (
    <ol class='pipeline'>
      <li class='node'>
        <div class='node-head static'>
          <span class='node-title'>Source</span>
          {image && <span class='node-summary'>{image.name}</span>}
        </div>
        <ImageSlot
          label='Image'
          hint='Drop or click'
          value={image}
          onFile={onImageFile}
          onClear={onImageClear}
        />
      </li>

      {steps.map((step, i) => {
        const selected = step.id === selectedId;
        return (
          <Fragment key={step.id}>
            <Insert onClick={() => onInsert(i)} />
            <li
              class={`node glowable${selected ? ' selected glowing' : ''}${step.enabled ? '' : ' disabled'}`}
            >
              <div class='node-head'>
                <button
                  type='button'
                  class='node-select'
                  aria-expanded={selected}
                  onClick={() => onSelect(selected ? null : step.id)}
                >
                  <span class='node-title'>Sort {String(i + 1).padStart(2, '0')}</span>
                  <span class='node-summary'>{summarize(step)}</span>
                </button>
                <label class='toggle' title={step.enabled ? 'Disable step' : 'Enable step'}>
                  <input
                    type='checkbox'
                    checked={step.enabled}
                    aria-label={`Enable sort ${i + 1}`}
                    onChange={() => onToggle(step.id)}
                  />
                </label>
                <button
                  type='button'
                  class='node-remove'
                  aria-label={`Remove sort ${i + 1}`}
                  title='Remove step'
                  onClick={() => onRemove(step.id)}
                >
                  ×
                </button>
              </div>
              {selected && <div class='node-body'>{renderControls(step)}</div>}
            </li>
          </Fragment>
        );
      })}

      <Insert onClick={() => onInsert(steps.length)} />
      <li class='node'>
        <div class='node-head static'>
          <span class='node-title'>Result</span>
          <span class='node-summary'>
            {steps.filter((s) => s.enabled).length} of {steps.length} steps active
          </span>
        </div>
      </li>
    </ol>
  );
}
