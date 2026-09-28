import { useEffect, useRef, useState } from 'preact/hooks';
import type { LoadedImage } from '../images.ts';
import { encodeTiff } from '../codec.ts';
import { PixelSorter, type StepSettings, type View } from '../sorter.ts';
import { useDropTarget } from '../useDropTarget.ts';

interface Props {
  image: LoadedImage | null;
  settings: StepSettings[];
  /** While set, the canvas shows the input of that step and a click picks a color from it. */
  pickIndex: number | null;
  onPick: (color: [number, number, number]) => void;
  onFile: (file: File) => void;
  onError: (message: string | null) => void;
}

type Format = 'tiff' | 'png';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function save(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function Preview({ image, settings, pickIndex, onPick, onFile, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sorter = useRef<PixelSorter | null>(null);
  const [comparing, setComparing] = useState(false);
  const [format, setFormat] = useState<Format>('tiff');
  const [exporting, setExporting] = useState(false);
  const { dragging, handlers } = useDropTarget(onFile);

  useEffect(() => {
    try {
      sorter.current = new PixelSorter(canvas.current!);
    } catch (err) {
      onError(message(err));
    }
  }, []);

  useEffect(() => {
    try {
      sorter.current?.setImage(image?.pixels ?? null);
    } catch (err) {
      onError(message(err));
    }
  }, [image]);

  const view: View = pickIndex !== null ? { input: pickIndex } : comparing ? 'source' : 'result';
  const viewKey = JSON.stringify(view);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        sorter.current?.render(settings);
        sorter.current?.present(view);
        onError(null);
      } catch (err) {
        onError(message(err));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [image, settings, viewKey]);

  const download = async () => {
    if (!image || !sorter.current) return;
    const base = `${image.name.replace(/\.[^.]+$/, '')}-sorted`;
    setExporting(true);
    try {
      if (format === 'tiff') {
        const { width, height, bitDepth } = image.pixels;
        const data = sorter.current.exportPixels();
        save(await encodeTiff({ width, height, bitDepth, data }), `${base}.tif`);
      } else {
        sorter.current.present('result');
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.current!.toBlob(resolve, 'image/png')
        );
        sorter.current.present(view);
        if (blob) save(blob, `${base}.png`);
      }
    } catch (err) {
      onError(message(err));
    } finally {
      setExporting(false);
    }
  };

  const stopComparing = () => setComparing(false);

  return (
    <main class={`stage${dragging ? ' dragging' : ''}`} {...handlers}>
      <canvas
        ref={canvas}
        hidden={!image}
        class={pickIndex !== null ? 'picking' : ''}
        onPointerDown={(e) => {
          if (pickIndex !== null) {
            const rect = e.currentTarget.getBoundingClientRect();
            const { width, height } = e.currentTarget;
            const x = Math.min(width - 1, Math.floor(((e.clientX - rect.left) / rect.width) * width));
            const y = Math.min(height - 1, Math.floor(((e.clientY - rect.top) / rect.height) * height));
            if (sorter.current) onPick(sorter.current.sample(view, x, y));
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          setComparing(true);
        }}
        onPointerUp={stopComparing}
        onPointerCancel={stopComparing}
      />
      {!image && (
        <div class='empty'>
          <p class='glitch' aria-label='Drop an image'>
            <span data-text='Drop_an' aria-hidden='true'>Drop_an</span>
            <span data-text='image' aria-hidden='true'>image</span>
          </p>
          <p class='hint'>PNG, JPEG, TIFF or camera raw. TIFF and raw keep their full 16 bits.</p>
        </div>
      )}
      {image && (
        <div class='toolbar'>
          <span class='hint'>
            {pickIndex !== null
              ? 'Showing this step’s input · click a color, Esc to cancel'
              : comparing
              ? 'Showing original'
              : 'Hold on the image to compare'}
          </span>
          <div class='export'>
            <select
              value={format}
              aria-label='Export format'
              onChange={(e) => setFormat(e.currentTarget.value as Format)}
            >
              <option value='tiff'>TIFF · {image.pixels.bitDepth}-bit</option>
              <option value='png'>PNG · 8-bit</option>
            </select>
            <button
              type='button'
              class={`btn filled glowable${exporting ? ' glowing' : ''}`}
              onClick={download}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Download'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
