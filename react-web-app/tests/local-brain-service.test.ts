import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { LocalBrainSceneRecognitionService } from '../src/entities/recognition-result/api/local-brain-service';
import type { RecognitionProgress } from '../src/entities/recognition-result/model/types';
import type { SelectedImage } from '../src/shared/lib/image-input';
import { modelFixture } from './model-fixture';
import type { WorkerRequest, WorkerResponse } from '../src/shared/api/worker-protocol';

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const fixture = await modelFixture();
  const close = vi.fn();
  vi.stubGlobal('fetch', vi.fn(fixture.fetcher));
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width = 1;
      height = 1;
      getContext() {
        return {
          drawImage() {},
          getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255]) }),
        };
      }
    },
  );
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } })
    .png()
    .toBuffer();
  const file = new File([new Uint8Array(bytes)], 'coast.png', { type: 'image/png' });
  const image: SelectedImage = {
    file,
    previewUrl: 'blob:test',
    metadata: {
      name: file.name,
      mimeType: 'image/png',
      sizeBytes: file.size,
      width: 1,
      height: 1,
      pixelCount: 1,
      source: 'file',
    },
    dispose() {},
  };
  return { image, close, fixture };
}

describe('recognition service orchestration', () => {
  it('maps a verified model prediction, uncertain state, honest stages and timings', async () => {
    const { image, close } = await setup();
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    const progress: RecognitionProgress[] = [];
    const result = await service.recognize(image, (item) => progress.push(item));
    expect(result.prediction.label).toEqual({
      id: 'sea',
      displayName: 'Sea',
      source: 'intel',
      datasetLabel: 'sea',
    });
    expect(result.predictions.map((item) => item.label.id)).toEqual(['sea', 'forest', 'desert']);
    expect(result.uncertain).toBe(true);
    expect(result.execution).toBe('main-thread');
    expect(result.model.featureLength).toBe(1024);
    expect(result.histogram.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(progress.map((p) => p.stage)).toEqual([
      'loading-model',
      'decoding',
      'pixels',
      'features',
      'encoding',
      'inference',
      'result',
      'complete',
    ]);
    expect(progress.map((p) => p.label)).toEqual([
      'Preparing the local model',
      'Decoding image',
      'Reading image pixels',
      'Extracting brightness histogram',
      'Encoding 1,024 features',
      'Running neural network',
      'Preparing result',
      'Complete',
    ]);
    expect(progress.at(-1)).toMatchObject({ step: 8, totalSteps: 8 });
    for (const duration of Object.values(result.timings)) {
      expect(duration).toBeGreaterThanOrEqual(0);
    }
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(
      result.timings.featuresMs + result.timings.inferenceMs,
    );
    expect(close).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('marks a confident, clearly leading score as a predicted scene and loads the scene model path', async () => {
    const { image, fixture } = await setup();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => await fixture.fetcher(input));
    vi.stubGlobal('fetch', fetcher);
    fixture.manifest.uncertainty = { minScore: 0.5, minMargin: 0.1 };
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    expect((await service.recognize(image)).uncertain).toBe(false);
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([expect.stringContaining('/models/scene-recognition/manifest.json')]),
    );
    service.dispose();
  });

  it('falls back gracefully when constructing a worker is unsupported', async () => {
    const { image } = await setup();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );
    const service = new LocalBrainSceneRecognitionService();
    expect((await service.recognize(image)).execution).toBe('main-thread');
    service.dispose();
  });

  it('recovers immediately when an initialized worker crashes while idle', async () => {
    const { image, close, fixture } = await setup();
    let crash: () => void = () => undefined;
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        onmessage?: (event: { data: WorkerResponse }) => void;
        onerror?: () => void;
        onmessageerror?: () => void;
        terminate = terminate;
        constructor() {
          crash = () => this.onerror?.();
        }
        postMessage(request: WorkerRequest) {
          if (request.type === 'initialize') {
            queueMicrotask(() =>
              this.onmessage?.({
                data: { id: request.id, type: 'ready', manifest: fixture.manifest },
              }),
            );
          }
        }
      },
    );
    const service = new LocalBrainSceneRecognitionService();
    await service.getModelInfo();
    fixture.manifest = {
      ...fixture.manifest,
      version: 'fallback-model',
      uncertainty: { minScore: 0.5, minMargin: 0.1 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('manifest.json')
          ? new Response(JSON.stringify(fixture.manifest))
          : new Response(fixture.modelBytes),
      ),
    );
    crash();
    const result = await service.recognize(image);
    expect(result.execution).toBe('main-thread');
    expect(result.prediction.label.id).toBe('sea');
    expect(result.model.version).toBe('fallback-model');
    expect(result.uncertain).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalled();
    service.dispose();
  });

  it('does not decode invalid input and remains reusable after a failure', async () => {
    const { image } = await setup();
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    await expect(service.recognize({ ...image, file: new File([], 'empty.png') })).rejects.toThrow(
      'empty',
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect((await service.recognize(image)).prediction.label.id).toBe('sea');
    service.dispose();
  });

  it('rejects overlapping recognition calls', async () => {
    const { image } = await setup();
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    const first = service.recognize(image);
    await expect(service.recognize(image)).rejects.toThrow('already being analyzed');
    await first;
    service.dispose();
  });

  it('cancels an in-flight decode on disposal and releases the decoded bitmap', async () => {
    const { image, close } = await setup();
    let finishDecode: () => void = () => undefined;
    let startedDecode: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      startedDecode = resolve;
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise((resolve) => {
            finishDecode = () => resolve({ width: 1, height: 1, close });
            startedDecode();
          }),
      ),
    );
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    const pending = service.recognize(image);
    const rejected = expect(pending).rejects.toThrow('canceled');
    await started;
    service.dispose();
    finishDecode();
    await rejected;
    expect(close).toHaveBeenCalledOnce();
  });

  it('surfaces model errors before decoding and closes bitmaps after canvas failures', async () => {
    const { image, close } = await setup();
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(
      new LocalBrainSceneRecognitionService({ preferWorker: false }).recognize(image),
    ).rejects.toThrow('unavailable');
    expect(createImageBitmap).not.toHaveBeenCalled();
    const { fixture } = await setup();
    vi.stubGlobal('fetch', fixture.fetcher);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      },
    );
    await expect(
      new LocalBrainSceneRecognitionService({ preferWorker: false }).recognize(image),
    ).rejects.toThrow('canvas');
    expect(close).toHaveBeenCalledOnce();
  });
});
