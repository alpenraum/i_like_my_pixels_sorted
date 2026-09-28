import { useEffect, useRef, useState } from 'preact/hooks';

const DEFAULT_SHARE = 0.4;
const MAX_SHARE = 0.6;
const MIN_WIDTH = 280;

const clamp = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(globalThis.innerWidth * MAX_SHARE, w)));
const defaultWidth = () => clamp(globalThis.innerWidth * DEFAULT_SHARE);

/** Drag handle on the sidebar's right edge; drives the `--sidebar` column width of `#app`. */
export function SidebarResizer() {
  const [width, setWidth] = useState(defaultWidth);
  const [dragging, setDragging] = useState(false);
  const live = useRef(width);
  const dragged = useRef(false);

  useEffect(() => {
    document.getElementById('app')?.style.setProperty('--sidebar', `${width}px`);
    live.current = width;
  }, [width]);

  useEffect(() => {
    // Until the edge is dragged the sidebar stays at 40 % of the window.
    const onResize = () => setWidth((w) => (dragged.current ? clamp(w) : defaultWidth()));
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  const stop = () => {
    setDragging(false);
    setWidth(live.current);
  };

  return (
    <div
      class={`resizer${dragging ? ' dragging' : ''}`}
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize sidebar'
      title='Drag to resize'
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragged.current = true;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        // Set the property directly while dragging: a state update per pointer event re-renders the app.
        live.current = clamp(e.clientX);
        document.getElementById('app')?.style.setProperty('--sidebar', `${live.current}px`);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  );
}
