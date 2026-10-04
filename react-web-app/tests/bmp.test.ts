import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { encodeBmp } from '../src/shared/lib/bmp';
import { analysisFilename } from '../src/shared/lib/export-analysis';

describe('BMP image export', () => {
  it('writes a valid Windows DIB with BGR pixels, bottom-up rows and padding', () => {
    const buffer = encodeBmp(1, 2, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 2))).toBe('BM');
    expect(view.getUint32(2, true)).toBe(62);
    expect(view.getUint32(10, true)).toBe(54);
    expect(view.getUint16(28, true)).toBe(24);
    expect(view.getInt32(18, true)).toBe(1);
    expect(view.getInt32(22, true)).toBe(2);
    expect(Array.from(bytes.subarray(54))).toEqual([255, 0, 0, 0, 0, 0, 255, 0]);
  });

  it('composites transparent input onto white and accepts every row alignment', () => {
    for (const width of [1, 2, 3, 4]) {
      const bytes = new Uint8Array(encodeBmp(width, 1, new Uint8Array(width * 4)));
      const stride = Math.ceil((width * 3) / 4) * 4;
      expect(bytes.length).toBe(54 + stride);
      expect(Array.from(bytes.subarray(54, 57))).toEqual([255, 255, 255]);
    }
  });

  it('encodes the same color as an independently decoded PNG source', async () => {
    const png = await sharp({
      create: { width: 2, height: 1, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const bytes = new Uint8Array(encodeBmp(2, 1, data));
    expect(Array.from(bytes.subarray(54, 57))).toEqual([142, 137, 132]);
  });

  it('rejects inconsistent or unsafe inputs', () => {
    expect(() => encodeBmp(2, 2, new Uint8Array(4))).toThrow('Invalid');
    expect(() => encodeBmp(0, 1, new Uint8Array())).toThrow('Invalid');
    expect(() => encodeBmp(5000, 5000, new Uint8Array())).toThrow('Invalid');
  });

  it('produces safe meaningful filenames for every export format', () => {
    expect(analysisFilename('../Sea View <script>', 'jpeg')).toBe(
      'horizon-sea-view-script-analysis.jpg',
    );
    expect(analysisFilename('Desert', 'png')).toBe('horizon-desert-analysis.png');
    expect(analysisFilename('🌊', 'bmp')).toBe('horizon-scene-analysis.bmp');
  });
});
