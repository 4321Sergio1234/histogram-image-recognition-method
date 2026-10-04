/** Detects the encoded container from its header, independently of a filename suffix. */
export function imageFormat(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)
  ) {
    return 'png';
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') {
    return 'gif';
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'webp';
  }
  if (ascii(0, 2) === 'BM') {
    return 'bmp';
  }
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') {
    return 'tiff';
  }
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) {
    return 'avif';
  }
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1'].includes(ascii(8, 12))) {
    return 'heif';
  }
  return 'unknown';
}
export function normalizedExtension(extension: string): string {
  return extension === 'jpg' ? 'jpeg' : extension;
}
