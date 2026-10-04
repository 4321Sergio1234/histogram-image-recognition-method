import { NeuralNetwork } from 'brain.js/dist/browser.js';
import { SCENE_CATALOG, type ModelManifest } from '@horizon/brain/core';
import { sha256 } from '../src/shared/api/model-engine';

export const sceneClasses = SCENE_CATALOG.map((scene) => ({ ...scene }));

export function manifestFixture(overrides: Partial<ModelManifest> = {}): ModelManifest {
  const metrics = {
    accuracy: 0.5,
    macroF1: 0.5,
    total: 6,
    confusionMatrix: [
      [1, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
    ],
    perClass: sceneClasses.map((item) => ({
      id: item.id,
      count: 2,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    })),
  };
  return {
    version: 'test-only',
    createdAt: '2026-01-01T00:00:00.000Z',
    task: 'natural-scene-classification',
    algorithm: 'zawyalow-brightness-histogram-v1',
    preprocessingVersion: 'luma-round-max15-msb-v1',
    featureLength: 1024,
    datasets: [
      {
        id: 'intel',
        name: 'Intel Image Classification',
        url: 'https://example.test/intel',
        selectedClasses: ['sea', 'forest'],
        ignoredClasses: ['buildings', 'glacier', 'mountain', 'street'],
      },
      {
        id: 'landscape',
        name: 'Landscape Recognition Image Dataset (12k)',
        url: 'https://example.test/landscape',
        selectedClasses: ['desert'],
        ignoredClasses: ['coast', 'forest', 'glacier', 'mountain'],
      },
    ],
    datasetFingerprint: 'unit-test-fixture',
    classes: sceneClasses,
    split: {
      strategy: 'fixture',
      seed: 42,
      validationPercent: 15,
      trainSource: 'pool sections',
      validationSource: 'pool sections',
      testSource: 'test sections',
    },
    sampleCounts: { train: 1, validation: 6, test: 6 },
    initializationSeed: 42,
    network: {
      architecture: '1024 → 3',
      hiddenLayers: [],
      activation: 'sigmoid',
      iterations: 1,
      learningRate: 0.3,
      momentum: 0.1,
    },
    trainMetrics: metrics,
    validationMetrics: metrics,
    testMetrics: metrics,
    uncertainty: { minScore: 0.9, minMargin: 0.15 },
    modelSha256: 'a'.repeat(64),
    brainVersion: '2.0.0-beta.24',
    ...overrides,
  };
}

/** Small deterministic network fixture; never exported as the application model. */
export async function modelFixture() {
  const network = new NeuralNetwork<number[], number[]>({ hiddenLayers: [] });
  network.train([{ input: new Array<number>(1024).fill(0), output: [1, 0, 0] }], { iterations: 1 });
  const json = network.toJSON();
  json.layers[1].biases = [2, 1, 0];
  json.layers[1].weights = [0, 1, 2].map(() => new Array<number>(1024).fill(0));
  const modelBytes = new TextEncoder().encode(JSON.stringify(json));
  const manifest = manifestFixture({ modelSha256: await sha256(modelBytes.buffer) });
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith('manifest.json')
      ? new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } })
      : new Response(modelBytes, { headers: { 'content-type': 'application/json' } });
  return { json, modelBytes, manifest, fetcher };
}
