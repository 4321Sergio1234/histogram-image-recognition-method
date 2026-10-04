export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_SIDE = 16_384;

export type ImageSource = 'file' | 'camera';
export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageMetadata {
  name: string;
  mimeType: SupportedImageMime;
  sizeBytes: number;
  width: number;
  height: number;
  pixelCount: number;
  source: ImageSource;
}

export interface SelectedImage {
  file: File;
  previewUrl: string;
  metadata: ImageMetadata;
  dispose(): void;
}

export class ImageInputError extends Error {
  override name = 'ImageInputError';
}

export function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new ImageInputError('This image has invalid dimensions. Choose another image.');
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new ImageInputError(
      'This image is too large. Choose an image up to 24 megapixels and 16,384 pixels per side.',
    );
  }
}

function invalidImage(): never {
  throw new ImageInputError('This file is not a valid JPEG, PNG, or WebP image.');
}

/** Reads dimensions from an encoded header before allocating decoded pixel memory. */
export function inspectImageHeader(bytes: Uint8Array): {
  mimeType: SupportedImageMime;
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 3) === 'PNG' &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    ascii(12, 4) === 'IHDR'
  ) {
    return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    const frames = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) {
        invalidImage();
      }
      while (bytes[offset] === 255) {
        offset++;
      }
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218 || offset + 2 > bytes.length) {
        break;
      }
      if (marker === 1 || (marker >= 208 && marker <= 215)) {
        continue;
      }
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) {
        break;
      }
      if (frames.has(marker) && length >= 8) {
        return {
          mimeType: 'image/jpeg',
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      }
      offset += length;
    }
    invalidImage();
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      if ((bytes[20] & 2) !== 0) {
        throw new ImageInputError('Animated WebP is not supported. Choose a still image.');
      }
      const uint24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return { mimeType: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return {
        mimeType: 'image/webp',
        width: view.getUint16(26, true) & 16383,
        height: view.getUint16(28, true) & 16383,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      return {
        mimeType: 'image/webp',
        width: (bits & 16383) + 1,
        height: ((bits >>> 14) & 16383) + 1,
      };
    }
  }
  return invalidImage();
}

export async function validateImageFile(
  file: File,
): Promise<{ mimeType: SupportedImageMime; width: number; height: number }> {
  if (file.size === 0) {
    throw new ImageInputError('This file is empty. Choose another image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageInputError('This file is too large. Choose an image smaller than 20 MB.');
  }
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.type && !allowedTypes.includes(file.type.toLowerCase())) {
    throw new ImageInputError('Choose a JPEG, PNG, or WebP image.');
  }
  const header = inspectImageHeader(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  if (file.type && file.type.toLowerCase() !== header.mimeType) {
    throw new ImageInputError(
      'The image contents do not match its file type. Choose another image.',
    );
  }
  validateDimensions(header.width, header.height);
  return header;
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        validateDimensions(bitmap.width, bitmap.height);
      } catch (error) {
        bitmap.close();
        throw error;
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      if (error instanceof ImageInputError) {
        throw error;
      }
    }
  }
  if (typeof Image === 'undefined') {
    throw new ImageInputError('Your browser cannot decode this image. Try a JPEG or PNG.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    validateDimensions(image.naturalWidth, image.naturalHeight);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {
        image.src = '';
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (error instanceof ImageInputError) {
      throw error;
    }
    throw new ImageInputError('We could not decode this image. It may be damaged or unsupported.');
  }
}

export function readImagePixels(image: DecodedImage): Uint8ClampedArray {
  let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas === 'function') {
    try {
      canvas = new OffscreenCanvas(image.width, image.height);
      context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    } catch {
      context = null;
    }
  }
  if (!context && typeof document !== 'undefined') {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  }
  if (!canvas) {
    throw new ImageInputError('Your browser does not support image processing.');
  }
  try {
    if (!context) {
      throw new ImageInputError('Your browser could not create an image canvas.');
    }
    context.drawImage(image.source, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  } catch (error) {
    if (error instanceof ImageInputError) {
      throw error;
    }
    throw new ImageInputError(
      'There was not enough memory to process this image. Try a smaller image.',
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Creates a memory-only image selection. Call dispose when replacing or removing it. */
export async function prepareImage(
  file: File,
  source: ImageSource = 'file',
): Promise<SelectedImage> {
  const header = await validateImageFile(file);
  const decoded = await decodeImage(file);
  const { width, height } = decoded;
  decoded.close();
  const previewUrl = URL.createObjectURL(file);
  return {
    file,
    previewUrl,
    metadata: {
      name: file.name || 'Camera capture',
      mimeType: header.mimeType,
      sizeBytes: file.size,
      width,
      height,
      pixelCount: width * height,
      source,
    },
    dispose: () => URL.revokeObjectURL(previewUrl),
  };
}
