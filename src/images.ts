import { decode } from './codec.ts';
import { isImageFile } from './formats.ts';
import type { PixelData } from './sorter.ts';

export interface LoadedImage {
  pixels: PixelData;
  thumbnail: string;
  name: string;
}

export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const { pixels, thumbnail } = await decode(blob);
  const name = blob instanceof File ? blob.name : 'image';
  return { pixels, thumbnail: URL.createObjectURL(thumbnail), name };
}

export function releaseImage(image: LoadedImage | null): void {
  if (image) URL.revokeObjectURL(image.thumbnail);
}

export function firstImageFile(files: FileList | null | undefined): File | undefined {
  return [...(files ?? [])].find(isImageFile);
}
