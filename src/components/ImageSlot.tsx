import { useRef } from 'preact/hooks';
import { ACCEPTED_TYPES } from '../formats.ts';
import { firstImageFile, type LoadedImage } from '../images.ts';
import { useDropTarget } from '../useDropTarget.ts';

interface Props {
  label: string;
  hint: string;
  value: LoadedImage | null;
  onFile: (file: File) => void;
  onClear: () => void;
}

export function ImageSlot({ label, hint, value, onFile, onClear }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { dragging, handlers } = useDropTarget(onFile);

  return (
    <div class={`slot${value ? ' filled' : ''}`}>
      <button
        type='button'
        class={`drop glowable${dragging ? ' dragging glowing' : ''}`}
        onClick={() => fileInput.current?.click()}
        aria-label={value ? `Replace ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
        {...handlers}
      >
        {value && <img src={value.thumbnail} alt='' />}
        <span class='drop-label'>{label}</span>
        {!value && <span class='drop-hint'>{hint}</span>}
      </button>
      <button type='button' class='btn text cancel' onClick={onClear} disabled={!value}>Clear</button>
      <input
        ref={fileInput}
        type='file'
        accept={ACCEPTED_TYPES}
        hidden
        onChange={(e) => {
          const file = firstImageFile(e.currentTarget.files);
          if (file) onFile(file);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
