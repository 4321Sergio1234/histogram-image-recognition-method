import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { decodeImage } from '../src/image/decode';
import { extractFeatures } from '../src/core';

it('native training decoding feeds exactly the shared browser RGBA feature contract', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'horizon-decode-'));
  try {
    const file = join(folder, 'pixels.png');
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]);
    await sharp(Buffer.from(pixels), { raw: { width: 2, height: 1, channels: 4 } })
      .png()
      .toFile(file);
    const decoded = await decodeImage(file);
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 2, height: 1 });
    expect(extractFeatures(decoded.rgba)).toEqual(extractFeatures(new Uint8ClampedArray(pixels)));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
