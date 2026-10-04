import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportAnalysis } from '../src/shared/lib/export-analysis';
import type { SelectedImage } from '../src/shared/lib/image-input';

afterEach(() => vi.unstubAllGlobals());

function exportFixture() {
  const close = vi.fn();
  const fillText = vi.fn();
  const context = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText,
    getImageData: () => ({ data: new Uint8ClampedArray(1200 * 1320 * 4).fill(255) }),
  };
  const toBlob = vi.fn((callback: (blob: Blob | null) => void, type: string) =>
    callback(new Blob(['encoded'], { type })),
  );
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 480, close }));
  const file = new File(['test'], 'coast.png', { type: 'image/png' });
  const image: SelectedImage = {
    file,
    previewUrl: 'blob:local',
    metadata: {
      name: file.name,
      mimeType: 'image/png',
      sizeBytes: file.size,
      width: 640,
      height: 480,
      pixelCount: 307200,
      source: 'file',
    },
    dispose() {},
  };
  const result = {
    prediction: { label: { displayName: 'Sea' }, score: 0.82 },
    uncertain: false,
    model: {
      version: '2.0.0-test',
      classes: [{ displayName: 'Sea' }, { displayName: 'Forest' }, { displayName: 'Desert' }],
    },
    completedAt: '2026-01-01T12:00:00Z',
  };
  return { image, result, close, context, canvas, toBlob, fillText };
}

describe('analysis card exports', () => {
  it.each(['png', 'jpeg'] as const)(
    'uses the browser %s encoder and includes the source, predicted scene, confidence and model version',
    async (format) => {
      const fixture = exportFixture();
      const exported = await exportAnalysis(fixture.image, fixture.result, format);
      expect(exported.blob.type).toBe(`image/${format}`);
      expect(fixture.toBlob).toHaveBeenCalledWith(expect.any(Function), `image/${format}`, 0.92);
      expect(fixture.context.drawImage).toHaveBeenCalledOnce();
      const text = fixture.fillText.mock.calls.map((call) => call[0]).join('\n');
      expect(text).toContain('HORIZON');
      expect(text).toContain('Sea');
      expect(text).toContain('Predicted scene · Model confidence 82.0%');
      expect(text).toContain('Recognizes only sea, forest and desert scenes');
      expect(text).toContain('Model 2.0.0-test');
      expect(text).not.toMatch(/fresh|food|produce|harvest/i);
      expect(fixture.close).toHaveBeenCalledOnce();
      expect(fixture.canvas.width).toBe(0);
    },
  );

  it('exports a complete BMP result card with the expected header and dimensions', async () => {
    const fixture = exportFixture();
    const { blob, filename } = await exportAnalysis(fixture.image, fixture.result, 'bmp');
    expect(blob.type).toBe('image/bmp');
    expect(filename).toBe('horizon-sea-analysis.bmp');
    const header = new DataView(await blob.slice(0, 54).arrayBuffer());
    expect(header.getUint16(0, true)).toBe(0x4d42);
    expect(header.getUint32(18, true)).toBe(1200);
    expect(header.getUint32(22, true)).toBe(1320);
    expect(fixture.toBlob).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it('labels an uncertain export as uncertain rather than as a predicted scene', async () => {
    const fixture = exportFixture();
    await exportAnalysis(fixture.image, { ...fixture.result, uncertain: true }, 'png');
    expect(fixture.fillText.mock.calls.map((call) => call[0]).join('\n')).toContain(
      'Uncertain result · Model confidence 82.0%',
    );
  });

  it('does not silently save PNG under a JPEG extension when a browser lacks support', async () => {
    const fixture = exportFixture();
    fixture.toBlob.mockImplementation((callback) =>
      callback(new Blob(['png'], { type: 'image/png' })),
    );
    await expect(exportAnalysis(fixture.image, fixture.result, 'jpeg')).rejects.toThrow(
      'does not support JPEG',
    );
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.canvas.width).toBe(0);
  });

  it('handles failed encoding and releases temporary pixel storage', async () => {
    const fixture = exportFixture();
    fixture.toBlob.mockImplementation((callback) => callback(null));
    await expect(exportAnalysis(fixture.image, fixture.result, 'png')).rejects.toThrow(
      'could not be exported',
    );
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.canvas.height).toBe(0);
  });
});
