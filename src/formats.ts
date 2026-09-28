// deno-fmt-ignore
const RAW_FORMATS = [
  '3fr', 'arw', 'cr2', 'cr3', 'crw', 'dcr', 'dng', 'erf', 'iiq', 'k25', 'kdc', 'mef', 'mos',
  'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2', 'rwl', 'sr2', 'srf', 'srw', 'x3f',
];
export const RAW_EXTENSIONS = new RegExp(`\\.(${RAW_FORMATS.join('|')})$`, 'i');

export const ACCEPTED_TYPES = ['image/*', '.tif', '.tiff', ...RAW_FORMATS.map((ext) => `.${ext}`)].join(',');

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.tiff?$/i.test(file.name) || RAW_EXTENSIONS.test(file.name);
}
