// Main-thread client for codec-worker.ts: decoding and TIFF encoding run off the UI thread.
import type { PixelData } from './sorter.ts';

export type CodecRequest =
  | { id: number; type: 'decode'; blob: Blob }
  | { id: number; type: 'encodeTiff'; pixels: PixelData };

export type CodecResponse =
  | { id: number; type: 'decoded'; pixels: PixelData; thumbnail: Blob }
  | { id: number; type: 'encoded'; blob: Blob }
  | { id: number; type: 'error'; message: string };

type Pending = { resolve: (response: CodecResponse) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function codecWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('codec-worker.js', document.baseURI), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<CodecResponse>) => {
    const call = pending.get(data.id);
    pending.delete(data.id);
    if (data.type === 'error') call?.reject(new Error(data.message));
    else call?.resolve(data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    for (const call of pending.values()) call.reject(new Error(event.message || 'Image worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(request: CodecRequest, transfer: Transferable[] = []): Promise<CodecResponse> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    codecWorker().postMessage(request, transfer);
  });
}

export async function decode(blob: Blob): Promise<{ pixels: PixelData; thumbnail: Blob }> {
  const response = await send({ id: nextId++, type: 'decode', blob });
  if (response.type !== 'decoded') throw new Error(`Unexpected worker reply: ${response.type}`);
  return response;
}

/** Hands `pixels.data` over to the worker; the array is unusable afterwards. */
export async function encodeTiff(pixels: PixelData): Promise<Blob> {
  const response = await send({ id: nextId++, type: 'encodeTiff', pixels }, [pixels.data.buffer]);
  if (response.type !== 'encoded') throw new Error(`Unexpected worker reply: ${response.type}`);
  return response.blob;
}
