import type { CodecRequest, CodecResponse } from './codec.ts';
import { decodeImage } from './decode.ts';
import { encodeTiff } from './encode.ts';
import { thumbnail } from './thumbnail.ts';

// The project type-checks against the DOM lib, whose `self` is a Window; this is the worker's shape.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CodecRequest>) => void) | null;
  postMessage(message: CodecResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: request }) => {
  const { id } = request;
  try {
    if (request.type === 'decode') {
      const pixels = await decodeImage(request.blob);
      const thumb = await thumbnail(pixels);
      scope.postMessage({ id, type: 'decoded', pixels, thumbnail: thumb }, [pixels.data.buffer]);
    } else {
      scope.postMessage({ id, type: 'encoded', blob: await encodeTiff(request.pixels) });
    }
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
