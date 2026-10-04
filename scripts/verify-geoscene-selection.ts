import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig } from '../brain-js/src/config/training';
import { readSamples } from '../brain-js/src/dataset/split';
import type { DatasetSplit } from '../brain-js/src/dataset/types';
import { trainCandidate } from '../brain-js/src/model/train';
import { sha256, type FrozenSelection } from '../brain-js/src/export/model';

// Retrain the already selected configuration without reading test or changing frozen artifacts.
const directory = trainingConfig.artifactsDirectory;
const selection = JSON.parse(
  await readFile(resolve(directory, 'selection.json'), 'utf8'),
) as FrozenSelection;
const split = JSON.parse(await readFile(resolve(directory, 'splits.json'), 'utf8')) as DatasetSplit;
const config = selection.selected.config;
const run = trainCandidate(
  await readSamples(split, 'train', directory, config.normalization),
  await readSamples(split, 'validation', directory, config.normalization),
  split.classes,
  config,
  selection.initializationSeed,
);
const bytes = JSON.stringify({
  ...run.model,
  trainOpts: { ...run.model.trainOpts, iterations: run.iterations },
});
const report = {
  scope: 'Reproduce the frozen selected configuration; no test reads or new candidate selection.',
  expectedSha256: selection.selected.modelSha256,
  actualSha256: sha256(bytes),
  sameWeights: sha256(bytes) === selection.selected.modelSha256,
  iterations: run.iterations,
};
if (!report.sameWeights) {
  throw new Error('Selected model retraining did not reproduce the frozen weights.');
}
await writeFile(
  resolve(trainingConfig.reportDataDirectory, 'selection-reproduction.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
