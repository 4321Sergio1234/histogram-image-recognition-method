import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateManifest } from '../../brain-js/src/core';
import { loadNetwork, type NetworkJSON } from '../../brain-js/src/model/network';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Check the exact files that will be served, against the frozen training run. */
export async function verifyModelAssets(assetRoot: string, runDirectory: string) {
  const modelRoot = join(assetRoot, 'models');
  const folders = await readdir(modelRoot);
  if (folders.length !== 1 || folders[0] !== 'scene-recognition') {
    throw new Error('Assets must contain only the current scene-recognition model');
  }

  const directory = join(modelRoot, 'scene-recognition');
  const files = (await readdir(directory)).sort();
  if (JSON.stringify(files) !== JSON.stringify(['manifest.json', 'model.json'])) {
    throw new Error('The served model directory must contain model.json and manifest.json only');
  }

  const [weights, metadata, exportedWeights, selectedWeights, exportedMetadata] = await Promise.all(
    [
      readFile(join(directory, 'model.json')),
      readFile(join(directory, 'manifest.json')),
      readFile(join(runDirectory, 'model.json')),
      readFile(join(runDirectory, 'selected-model.json')),
      readFile(join(runDirectory, 'manifest.json')),
    ],
  );
  const manifest = validateManifest(JSON.parse(metadata.toString()));
  if (hash(weights) !== manifest.modelSha256) {
    throw new Error('Served model checksum does not match its manifest');
  }
  if (!weights.equals(exportedWeights) || !weights.equals(selectedWeights)) {
    throw new Error('Served weights differ from the frozen training selection');
  }
  if (!metadata.equals(exportedMetadata)) {
    throw new Error('Served manifest differs from the frozen training export');
  }

  const model = JSON.parse(weights.toString()) as NetworkJSON;
  const expectedSizes = [
    manifest.featureLength,
    ...manifest.network.hiddenLayers,
    manifest.classes.length,
  ];
  if (JSON.stringify(model.sizes) !== JSON.stringify(expectedSizes)) {
    throw new Error('Serialized network dimensions differ from the manifest');
  }
  if (model.inputLookup !== null || model.outputLookup !== null) {
    throw new Error('The scene model must use numeric input and output order');
  }
  const scores = Array.from(loadNetwork(model).run(new Array(manifest.featureLength).fill(0)));
  if (
    scores.length !== manifest.classes.length ||
    scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)
  ) {
    throw new Error('The served network cannot produce valid scene scores');
  }
  for (const phase of ['train', 'validation', 'test'] as const) {
    const metrics = manifest[`${phase}Metrics`];
    if (metrics.total !== manifest.sampleCounts[phase]) {
      throw new Error(`The ${phase} count differs from its evaluation metadata`);
    }
  }

  return {
    directory: resolve(directory),
    version: manifest.version,
    modelSha256: manifest.modelSha256,
    architecture: manifest.network.architecture,
    classes: manifest.classes.map((label) => label.id),
    sampleCounts: manifest.sampleCounts,
  };
}
