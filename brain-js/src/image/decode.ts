import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/**
 * Native opaque, unprofiled images use Sharp (verified against Chromium on every validation image).
 * ICC conversion and alpha premultiplication differ between libvips and browser canvas, even by one
 * channel level. For these inputs use the same pinned Chromium canvas semantics as the web app.
 * No resize, crop, colour-feature extension or histogram change is performed.
 */
export async function decodeImage(file: string) {
  const decoder = sharp(file, { failOn: 'error', limitInputPixels: 40_000_000 });
  const metadata = await decoder.metadata();
  if (metadata.icc || metadata.hasAlpha) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const bytes = await readFile(file);
      const decoded = await page.evaluate(
        async ({ base64, mime }) => {
          const blob = new Blob(
            [Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))],
            { type: mime },
          );
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          try {
            const context = canvas.getContext('2d', {
              willReadFrequently: true,
              colorSpace: 'srgb',
            });
            if (!context) {
              throw new Error('Cannot create canonical sRGB canvas.');
            }
            context.drawImage(bitmap, 0, 0);
            const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
            let binary = '';
            for (let offset = 0; offset < rgba.length; offset += 8192) {
              binary += String.fromCharCode(...rgba.subarray(offset, offset + 8192));
            }
            return { width: bitmap.width, height: bitmap.height, base64: btoa(binary) };
          } finally {
            bitmap.close();
            canvas.width = 0;
            canvas.height = 0;
          }
        },
        { base64: bytes.toString('base64'), mime: `image/${metadata.format}` },
      );
      return {
        rgba: new Uint8Array(Buffer.from(decoded.base64, 'base64')),
        width: decoded.width,
        height: decoded.height,
      };
    } finally {
      await browser.close();
    }
  }
  const { data, info } = await decoder
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}
