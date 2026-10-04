import { describe, expect, it } from 'vitest';
import {
  isUncertain,
  rankPredictions,
  SCENE_CATALOG,
  validateManifest,
  type ModelManifest,
} from '../src/core';
import { metricsFromConfusion } from '../src/evaluation/metrics';
import { createNetwork, loadNetwork } from '../src/model/network';
import { seededRandom } from '../src/dataset/random';
import {
  architecture,
  betterValidation,
  parameterCount,
  selectCandidate,
} from '../src/model/train';

const classes = [...SCENE_CATALOG];
const metrics = metricsFromConfusion(
  [
    [3, 1, 0],
    [2, 4, 0],
    [0, 1, 5],
  ],
  classes,
);
const manifest: ModelManifest = {
  version: 'test',
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
  datasetFingerprint: 'fixture',
  classes,
  split: {
    strategy: 'fixture',
    seed: 1,
    validationPercent: 15,
    trainSource: 'seg_train',
    validationSource: 'seg_train',
    testSource: 'seg_test',
  },
  sampleCounts: { train: 10, validation: 10, test: 16 },
  initializationSeed: 42,
  network: {
    architecture: '1024 → 3',
    hiddenLayers: [],
    activation: 'sigmoid',
    iterations: 1,
    learningRate: 0.1,
    momentum: 0.1,
  },
  trainMetrics: metrics,
  validationMetrics: metrics,
  testMetrics: metrics,
  uncertainty: { minScore: 0.65, minMargin: 0.15 },
  modelSha256: 'a'.repeat(64),
  brainVersion: '2.0.0-beta.24',
};

describe('scene model contract', () => {
  it('ranks raw outputs without renormalizing them', () =>
    expect(
      rankPredictions(new Float32Array([0.25, 0.5, 0.125]), classes).map((item) => [
        item.label.id,
        item.score,
      ]),
    ).toEqual([
      ['forest', 0.5],
      ['sea', 0.25],
      ['desert', 0.125],
    ]));
  it.each(
    [
      [0.2, 0.1],
      [NaN, 0.1, 0.2],
      [-0.2, 0.1, 0.1],
      [0.1, 1.2, 0.1],
    ].map((output) => ({ output })),
  )('rejects incompatible output %j', ({ output }) =>
    expect(() => rankPredictions(output, classes)).toThrow(),
  );
  it.each([
    { scores: [0.9, 0.2, 0.1], uncertain: false },
    { scores: [0.6, 0.1, 0.05], uncertain: true },
    { scores: [0.8, 0.7, 0.1], uncertain: true },
    { scores: [0.65, 0.5, 0.1], uncertain: false },
  ])('flags low or ambiguous scores $scores as uncertain=$uncertain', ({ scores, uncertain }) =>
    expect(isUncertain(rankPredictions(scores, classes), manifest.uncertainty)).toBe(uncertain),
  );
  it('treats an empty ranking as uncertain', () =>
    expect(isUncertain([], manifest.uncertainty)).toBe(true));
  it('calculates accuracy, per-class precision/recall/F1 and macro-F1', () => {
    expect(metrics.accuracy).toBe(12 / 16);
    expect(metrics.perClass[0]).toMatchObject({ id: 'sea', precision: 0.6, recall: 0.75 });
    expect(metrics.perClass[0].f1).toBeCloseTo(2 / 3);
    expect(metrics.total).toBe(16);
  });
  it('validates a complete compatible scene manifest', () =>
    expect(validateManifest(manifest)).toEqual(manifest));
  it('rejects the previous food-recognition manifest shape as a different task', () => {
    const legacy = {
      version: '1.2.0',
      algorithm: 'zawyalow-brightness-histogram-v1',
      preprocessingVersion: 'luma-round-max15-msb-v1',
      featureLength: 1024,
      dataset: 'ulnnproject/food-freshness-dataset',
      classes: [
        {
          id: 'fresh-apple',
          foodType: 'apple',
          displayName: 'Apple',
          freshness: 'fresh',
          sourceFolders: ['Fresh/FreshApple'],
        },
      ],
    };
    expect(() => validateManifest(legacy)).toThrow('different recognition task');
  });
  it.each([
    { featureLength: 2048 },
    { preprocessingVersion: 'other' },
    { modelSha256: 'bad' },
    { brainVersion: '' },
    { classes: [classes[0], classes[0], classes[2]] },
    {
      classes: [
        ...classes,
        { id: 'mountain', displayName: 'Mountain', source: 'intel', datasetLabel: 'mountain' },
      ],
    },
    {
      classes: [
        { id: 'apple', displayName: 'Apple', source: 'intel', datasetLabel: 'apple' },
        classes[1],
        classes[2],
      ],
    },
    { classes: [classes[0], classes[1], { ...classes[2], source: 'intel' }] },
    { datasets: [{ ...manifest.datasets[0], ignoredClasses: ['sea'] }, manifest.datasets[1]] },
    {
      datasets: [
        { ...manifest.datasets[0], selectedClasses: ['sea', 'forest', 'mountain'] },
        manifest.datasets[1],
      ],
    },
    { datasets: [manifest.datasets[0]] },
    { datasetFingerprint: '' },
    { uncertainty: { minScore: 2, minMargin: 0.1 } },
    { split: { ...manifest.split, validationPercent: 0 } },
    { testMetrics: { ...metrics, total: 100 } },
  ])('rejects malformed manifest field %j', (fields) =>
    expect(() => validateManifest({ ...manifest, ...fields })).toThrow(),
  );
  it('describes candidate architectures and their parameter counts', () => {
    expect(architecture([], 3)).toBe('1024 → 3');
    expect(architecture([32], 3)).toBe('1024 → 32 → 3');
    expect(parameterCount([], 3)).toBe(1024 * 3 + 3);
    expect(parameterCount([16], 3)).toBe(1024 * 16 + 16 + 16 * 3 + 3);
  });
  it('selects validation accuracy first and macro-F1 only to break a tie', () => {
    expect(
      betterValidation(
        { ...metrics, accuracy: 0.8, macroF1: 0.6 },
        { ...metrics, accuracy: 0.7, macroF1: 0.9 },
      ),
    ).toBe(true);
    expect(betterValidation({ ...metrics, macroF1: 0.8 }, { ...metrics, macroF1: 0.7 })).toBe(true);
    expect(betterValidation(metrics, metrics)).toBe(false);
  });
  it('prefers the simplest candidate among validation-equivalent ones', () => {
    const run = (id: string, parameters: number, accuracy: number) => ({
      id,
      parameters,
      validationMetrics: { ...metrics, accuracy },
    });
    expect(
      selectCandidate([run('A', 3075, 0.7), run('B', 16451, 0.705), run('D', 65795, 0.71)], 0.01)
        .id,
    ).toBe('A');
    expect(
      selectCandidate([run('A', 3075, 0.69), run('B', 16451, 0.705), run('D', 65795, 0.72)], 0.01)
        .id,
    ).toBe('D');
    expect(
      selectCandidate([run('A', 3075, 0.7), run('B', 16451, 0.715), run('C', 32899, 0.72)], 0.01)
        .id,
    ).toBe('B');
    expect(() => selectCandidate([], 0.01)).toThrow();
  });
  it('reproduces Brain.js initialization and serialization for the installed CPU runtime', () => {
    function train() {
      const saved = Math.random;
      Math.random = seededRandom(4);
      try {
        const network = createNetwork([]);
        network.train(
          [
            { input: [0, 0], output: [0, 1] },
            { input: [1, 1], output: [1, 0] },
          ],
          { iterations: 4, log: false },
        );
        return network;
      } finally {
        Math.random = saved;
      }
    }
    const first = train();
    const second = train();
    expect(first.toJSON()).toEqual(second.toJSON());
    expect(loadNetwork(first.toJSON()).run([1, 0])).toEqual(first.run([1, 0]));
  });
});
