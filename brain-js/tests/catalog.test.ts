import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DATASETS,
  GEOSCENE_CATALOG,
  IGNORED_DATASET_LABELS,
  SCENE_CATALOG,
  USED_DATASETS,
  validateManifest,
} from '../src/core';

const web = (path: string) =>
  fileURLToPath(new URL(`../../react-web-app/public/${path}`, import.meta.url));

describe('supported scene catalog', () => {
  it('supports exactly Sea, Forest and Desert, in network output order, each from a declared source', () => {
    expect(SCENE_CATALOG.map((scene) => [scene.id, scene.displayName, scene.source])).toEqual([
      ['sea', 'Sea', 'intel'],
      ['forest', 'Forest', 'intel'],
      ['desert', 'Desert', 'landscape'],
    ]);
    for (const scene of SCENE_CATALOG) {
      expect(DATASETS[scene.source as keyof typeof DATASETS].labels).toContain(scene.datasetLabel);
    }
    expect(IGNORED_DATASET_LABELS).toMatchObject({
      intel: ['buildings', 'glacier', 'mountain', 'street'],
      landscape: ['coast', 'forest', 'glacier', 'mountain'],
    });
    expect(GEOSCENE_CATALOG.map((scene) => [scene.id, scene.source, scene.datasetLabel])).toEqual([
      ['sea', 'geoscene', 'sea or ocean'],
      ['forest', 'geoscene', 'forest area'],
      ['desert', 'geoscene', 'desert'],
    ]);
    expect(USED_DATASETS.map((dataset) => dataset.name)).toEqual([
      'Intel Image Classification',
      'Landscape Recognition Image Dataset (12k)',
    ]);
  });

  it('ships one validated scene model, without Mountain or any food-recognition model', () => {
    expect(existsSync(web('models/food-recognition'))).toBe(false);
    const manifest = validateManifest(
      JSON.parse(readFileSync(web('models/scene-recognition/manifest.json'), 'utf8')),
    );
    expect(manifest.classes.map((label) => label.displayName)).toEqual(['Sea', 'Forest', 'Desert']);
    expect(manifest.datasets.map((dataset) => [dataset.id, dataset.selectedClasses])).toEqual([
      ['geoscene', ['desert', 'forest area', 'sea or ocean']],
      ['intel', ['forest', 'sea']],
      ['landscape', ['coast', 'desert', 'forest']],
    ]);
    expect(manifest.datasets[0].ignoredClasses).toContain('hill or mountain');
    expect(manifest.version).toBe('6.1.0');
    expect(manifest.domain?.id).toBe('curated-histogram-v2');
    expect(manifest.network.hiddenLayers).toEqual([16]);
    expect(manifest.modelSha256).toBe(
      '5e4dbd351c39ba21ef3d0afc7d86940373a22ece361b4c421d7ce72275cd5235',
    );
    expect(JSON.stringify(manifest.classes)).not.toMatch(/mountain/i);
    expect(JSON.stringify(manifest)).not.toMatch(/fresh|rotten|food|produce|nutrition/i);
  });
});

it('binds each training target to the corresponding serialized numeric output and UI label', async () => {
  const { rankPredictions } = await import('../src/core');
  const { classIndex } = await import('../src/dataset/split');
  const { loadNetwork } = await import('../src/model/network');
  const { image } = await import('./fixtures');
  const manifest = validateManifest(
    JSON.parse(readFileSync(web('models/scene-recognition/manifest.json'), 'utf8')),
  );
  const json = JSON.parse(readFileSync(web('models/scene-recognition/model.json'), 'utf8'));
  expect(json.outputLookup).toBeNull();
  expect(json.outputLookupLength).toBe(0);
  expect(json.sizes.at(-1)).toBe(3);
  manifest.classes.forEach((label, outputIndex) => {
    expect(
      classIndex(
        { classes: manifest.classes },
        image('mapping', 'Training Data', label.datasetLabel, 'mapping', label.source),
      ),
    ).toBe(outputIndex);
    const target = manifest.classes.map((_, index) => (index === outputIndex ? 1 : 0));
    expect(rankPredictions(target, manifest.classes)[0].label).toEqual(label);
    // Isolate the serialized output position from classifier correctness by setting only final-layer biases.
    const probe = structuredClone(json);
    const final = probe.layers.at(-1);
    final.weights = final.weights.map((row: number[]) => row.map(() => 0));
    final.biases = target.map((value) => (value ? 8 : -8));
    const prediction = rankPredictions(
      loadNetwork(probe).run(new Array(1024).fill(0)),
      manifest.classes,
    )[0];
    expect([prediction.label.id, prediction.label.displayName]).toEqual([
      label.id,
      label.displayName,
    ]);
  });
  const swapped = structuredClone(manifest);
  swapped.classes[2].displayName = 'Sea';
  expect(() => validateManifest(swapped)).toThrow('catalog');
});
