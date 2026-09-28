import { useState } from 'preact/hooks';
import { firstImageFile } from './images.ts';

export function useDropTarget(onFile: (file: File) => void) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    handlers: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        // dragleave also fires when crossing into a child element.
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = firstImageFile(e.dataTransfer?.files);
        if (file) onFile(file);
      },
    },
  };
}
