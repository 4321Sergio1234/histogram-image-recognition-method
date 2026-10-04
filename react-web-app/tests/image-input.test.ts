import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  decodeImage,
  inspectImageHeader,
  MAX_IMAGE_BYTES,
  prepareImage,
  readImagePixels,
  validateDimensions,
  validateImageFile,
} from '../src/shared/lib/image-input';

afterEach(() => vi.unstubAllGlobals());

async function encoded(format: 'png' | 'jpeg' | 'webp') {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#f54838' } })
    .toFormat(format)
    .toBuffer();
  return new File([new Uint8Array(bytes)], `photo.${format}`, { type: `image/${format}` });
}

describe('image input guards', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'reads dimensions and signature of a real %s file',
    async (format) => {
      const file = await encoded(format);
      expect(await validateImageFile(file)).toEqual({
        width: 3,
        height: 2,
        mimeType: `image/${format}`,
      });
    },
  );

  it('rejects empty, oversized, unsupported and mislabeled files', async () => {
    await expect(
      validateImageFile(new File([], 'empty.png', { type: 'image/png' })),
    ).rejects.toThrow('empty');
    const oversized = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.png', {
      type: 'image/png',
    });
    await expect(validateImageFile(oversized)).rejects.toThrow('too large');
    await expect(
      validateImageFile(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('JPEG, PNG, or WebP');
    const png = await encoded('png');
    await expect(
      validateImageFile(new File([png], 'wrong.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('do not match');
    await expect(
      validateImageFile(new File(['not an image'], 'photo.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('not a valid');
  });

  it('accepts a missing MIME type only when the signature is valid', async () => {
    const png = await encoded('png');
    expect((await validateImageFile(new File([png], 'extensionless'))).mimeType).toBe('image/png');
  });

  it('blocks excessive encoded dimensions before calling an image decoder', async () => {
    const file = await encoded('png');
    const bytes = await file.arrayBuffer();
    new DataView(bytes).setUint32(16, 100_000);
    const decoder = vi.fn();
    vi.stubGlobal('createImageBitmap', decoder);
    await expect(
      prepareImage(new File([bytes], 'huge.png', { type: 'image/png' })),
    ).rejects.toThrow('too large');
    expect(decoder).not.toHaveBeenCalled();
  });

  it.each([
    [0, 1],
    [-1, 1],
    [1.5, 2],
    [16_385, 1],
    [6000, 5000],
  ])('rejects dimensions %s × %s', (width, height) => {
    expect(() => validateDimensions(width, height)).toThrow();
  });

  it('rejects truncated JPEG markers and animated WebP', () => {
    expect(() => inspectImageHeader(new Uint8Array([255, 216, 255, 192, 0, 8, 0]))).toThrow();
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    webp[20] = 2;
    expect(() => inspectImageHeader(webp)).toThrow('Animated');
  });

  it('releases a decoded bitmap and revokes the selected preview on disposal', async () => {
    const close = vi.fn();
    const revoke = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3, height: 2, close }));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:preview', revokeObjectURL: revoke });
    const selected = await prepareImage(await encoded('png'), 'camera');
    expect(selected.metadata).toMatchObject({
      width: 3,
      height: 2,
      source: 'camera',
      pixelCount: 6,
    });
    expect(close).toHaveBeenCalledOnce();
    selected.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });

  it('rejects decode failures and releases a bitmap with invalid decoded dimensions', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decoder failed')));
    await expect(decodeImage(new Blob())).rejects.toThrow('cannot decode');
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 30_000, height: 2, close }),
    );
    await expect(decodeImage(new Blob())).rejects.toThrow('too large');
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports missing canvas support without an uncaught platform error', () => {
    expect(() =>
      readImagePixels({ source: {} as CanvasImageSource, width: 2, height: 2, close() {} }),
    ).toThrow('does not support');
  });
});
