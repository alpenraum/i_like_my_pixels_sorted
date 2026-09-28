import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Pipeline } from './components/Pipeline.tsx';
import { Preview } from './components/Preview.tsx';
import { SidebarResizer } from './components/SidebarResizer.tsx';
import { StepControls, type StepPatch } from './components/StepControls.tsx';
import { type LoadedImage, loadImage, releaseImage } from './images.ts';
import { newStep, type Step, toSettings } from './pipeline.ts';

export function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [steps, setSteps] = useState<Step[]>(() => [newStep()]);
  const [selectedId, setSelectedId] = useState<number | null>(() => steps[0].id);
  const [pickingId, setPickingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState<string | null>(null);
  const latest = useRef<Record<string, number>>({});

  useEffect(() => () => releaseImage(image), [image]);

  useEffect(() => {
    if (pickingId === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickingId(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickingId]);

  /** Decodes `file`; resolves null if a newer load for the same slot started meanwhile. */
  const load = async (slot: string, file: File): Promise<LoadedImage | null> => {
    const request = latest.current[slot] = (latest.current[slot] ?? 0) + 1;
    setDecoding(`Decoding ${file.name}…`);
    try {
      const loaded = await loadImage(file);
      if (request !== latest.current[slot]) {
        releaseImage(loaded);
        return null;
      }
      setLoadError(null);
      return loaded;
    } catch (err) {
      if (request === latest.current[slot]) {
        setLoadError(`Couldn't decode ${file.name}${err instanceof Error ? `: ${err.message}` : '.'}`);
      }
      return null;
    } finally {
      if (request === latest.current[slot]) setDecoding(null);
    }
  };

  const cancelLoad = (slot: string) => latest.current[slot] = (latest.current[slot] ?? 0) + 1;

  const loadSource = async (file: File) => {
    const loaded = await load('image', file);
    if (loaded) setImage(loaded);
  };

  const update = (id: number, patch: StepPatch) =>
    setSteps((all) =>
      all.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s))
    );

  const setMask = (id: number, mask: LoadedImage | null) => {
    releaseImage(steps.find((s) => s.id === id)?.mask ?? null);
    update(id, { mask });
  };

  const insert = (index: number) => {
    const step = newStep();
    setSteps((all) => [...all.slice(0, index), step, ...all.slice(index)]);
    setSelectedId(step.id);
  };

  const remove = (id: number) => {
    cancelLoad(`mask-${id}`);
    releaseImage(steps.find((s) => s.id === id)?.mask ?? null);
    setSteps((all) => all.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (pickingId === id) setPickingId(null);
  };

  const settings = useMemo(() => steps.filter((s) => s.enabled).map(toSettings), [steps]);
  const pickIndex = pickingId === null
    ? null
    : steps.slice(0, steps.findIndex((s) => s.id === pickingId)).filter((s) => s.enabled).length;

  const error = renderError ?? loadError;

  return (
    <>
      <aside class='panel'>
        <h1 class='glitch' aria-label='Pixel Sorter'>
          <span data-text='Pixel' aria-hidden='true'>Pixel</span>
          <span data-text='Sorter' aria-hidden='true'>Sorter</span>
        </h1>
        <Pipeline
          image={image}
          steps={steps}
          selectedId={selectedId}
          onImageFile={loadSource}
          onImageClear={() => {
            cancelLoad('image');
            setImage(null);
          }}
          onSelect={(id) => {
            setSelectedId(id);
            setPickingId(null);
          }}
          onInsert={insert}
          onToggle={(id) => update(id, (s) => ({ enabled: !s.enabled }))}
          onRemove={remove}
          renderControls={(step) => (
            <StepControls
              step={step}
              picking={pickingId === step.id}
              onChange={(patch) => update(step.id, patch)}
              onMaskFile={async (file) => {
                const loaded = await load(`mask-${step.id}`, file);
                if (loaded) setMask(step.id, loaded);
              }}
              onMaskClear={() => {
                cancelLoad(`mask-${step.id}`);
                setMask(step.id, null);
              }}
              onTogglePick={() => setPickingId(pickingId === step.id ? null : step.id)}
            />
          )}
        />
        <p class={`status${error ? ' error' : decoding ? ' busy' : ''}`} role='status'>
          {error ?? decoding ?? describe(image, steps.find((s) => s.id === selectedId))}
        </p>
        <footer class='credits'>
          <a href='https://barely-engineered.org' target='_blank' rel='noopener'>barely-engineered.org</a>
          <a href='https://github.com/alpenraum' target='_blank' rel='noopener'>GitHub</a>
        </footer>
      </aside>
      <SidebarResizer />
      <Preview
        image={image}
        settings={settings}
        pickIndex={pickIndex}
        onPick={(color) => {
          if (pickingId !== null) update(pickingId, { color });
          setPickingId(null);
        }}
        onFile={loadSource}
        onError={setRenderError}
      />
    </>
  );
}

function describe(image: LoadedImage | null, step: Step | undefined): string {
  if (!image) return '';
  const { width, height, bitDepth } = image.pixels;
  const size = `${width} × ${height} · ${bitDepth}-bit`;
  const mask = step?.selection === 'mask' ? step.mask?.pixels : null;
  if (!mask) return size;
  const stretched = Math.abs(mask.width / mask.height - width / height) > 0.01;
  return stretched ? `${size} · mask stretched to fit` : size;
}
