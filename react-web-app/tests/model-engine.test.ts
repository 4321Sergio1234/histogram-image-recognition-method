import { describe, expect, it, vi } from 'vitest';
import { extractFeatures } from '@horizon/brain/core';
import { LocalModelEngine, validateNetwork } from '../src/shared/api/model-engine';
import { modelFixture } from './model-fixture';

describe('local Brain.js model engine', () => {
  it('verifies a model and performs real Brain.js inference on shared features', async () => {
    const fixture = await modelFixture();
    const fetcher = vi.fn(fixture.fetcher);
    const engine = new LocalModelEngine('/models/test', fetcher);
    expect(await engine.getModelInfo()).toEqual(fixture.manifest);
    await engine.getModelInfo();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const progress: string[] = [];
    const result = await engine.analyze(new Uint8ClampedArray([255, 0, 0, 255]), (stage) =>
      progress.push(stage),
    );
    expect(progress).toEqual(['features', 'encoding', 'inference']);
    expect(result.histogram).toHaveLength(256);
    expect(result.histogram[76]).toBe(1);
    expect(result.quantized[76]).toBe(15);
    expect(result.predictions.map((p) => p.label.id)).toEqual(['sea', 'forest', 'desert']);
    expect(result.predictions[0].score).toBeCloseTo(1 / (1 + Math.exp(-2)), 5);
    expect(result.predictions.reduce((sum, p) => sum + p.score, 0)).toBeGreaterThan(1);
    expect(result.predictions).toHaveLength(3);
    expect(result.featuresMs).toBeGreaterThanOrEqual(0);
    expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
  });

  it('computes exactly the canonical training features, in the same order, on the browser path', async () => {
    const fixture = await modelFixture();
    const pixels = new Uint8ClampedArray([
      12, 200, 40, 255, 250, 250, 250, 128, 0, 0, 0, 255, 90, 60, 30, 255,
    ]);
    const expected = extractFeatures(new Uint8Array(pixels));
    const result = await new LocalModelEngine('/models/test', fixture.fetcher).analyze(
      new Uint8ClampedArray(pixels),
    );
    expect(result.histogram).toEqual(expected.histogram);
    expect(result.quantized).toEqual(expected.quantized);
  });

  it('refuses a stale model built for the previous recognition task', async () => {
    const legacy = {
      version: '1.2.0',
      algorithm: 'zawyalow-brightness-histogram-v1',
      preprocessingVersion: 'luma-round-max15-msb-v1',
      featureLength: 1024,
      classes: [{ id: 'fresh-apple', displayName: 'Apple' }],
    };
    await expect(
      new LocalModelEngine(
        '/model',
        async () => new Response(JSON.stringify(legacy)),
      ).getModelInfo(),
    ).rejects.toThrow('different recognition task');
  });

  it('rejects missing model assets and allows a subsequent successful retry', async () => {
    const fixture = await modelFixture();
    const fetcher = vi
      .fn(fixture.fetcher)
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));
    const engine = new LocalModelEngine('/model', fetcher);
    await expect(engine.getModelInfo()).rejects.toThrow('unavailable');
    expect((await engine.getModelInfo()).version).toBe('test-only');
  });

  it('rejects invalid JSON, incompatible manifests and failed integrity checks', async () => {
    const fixture = await modelFixture();
    await expect(
      new LocalModelEngine('/model', async () => new Response('bad json')).getModelInfo(),
    ).rejects.toThrow('could not be loaded');
    fixture.manifest.featureLength = 100 as 1024;
    await expect(new LocalModelEngine('/model', fixture.fetcher).getModelInfo()).rejects.toThrow(
      'unsupported preprocessing',
    );
    fixture.manifest.featureLength = 1024;
    fixture.manifest.modelSha256 = '0'.repeat(64);
    await expect(new LocalModelEngine('/model', fixture.fetcher).getModelInfo()).rejects.toThrow(
      'integrity check',
    );
  });

  it('rejects incompatible tensor dimensions, lookup outputs, activation, and nonfinite weights', async () => {
    const { json, manifest } = await modelFixture();
    expect(() => validateNetwork({ ...json, sizes: [1023, 2] }, manifest)).toThrow('dimensions');
    expect(() => validateNetwork({ ...json, outputLookup: { sea: 0 } }, manifest)).toThrow(
      'compatible Brain',
    );
    expect(() =>
      validateNetwork({ ...json, trainOpts: { ...json.trainOpts, activation: 'relu' } }, manifest),
    ).toThrow('activation');
    json.layers[1].weights[0][0] = Number.POSITIVE_INFINITY;
    expect(() => validateNetwork(json, manifest)).toThrow('invalid weights');
  });

  it('bounds artifact size and reports network failures', async () => {
    await expect(
      new LocalModelEngine(
        '/model',
        async () => new Response('{}', { headers: { 'content-length': '50000000' } }),
      ).getModelInfo(),
    ).rejects.toThrow('size limit');
    await expect(
      new LocalModelEngine('/model', async () => {
        throw new TypeError('Failed to fetch');
      }).getModelInfo(),
    ).rejects.toThrow('Failed to fetch');
  });
});
