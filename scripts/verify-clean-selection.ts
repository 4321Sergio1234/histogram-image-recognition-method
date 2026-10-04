import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../brain-js/src/config/clean-training';
import { cleanSamples, loadCleanDataset, readCleanHistograms } from '../brain-js/src/dataset/clean';
import { trainCandidate } from '../brain-js/src/model/train';
import { sha256, type FrozenSelection } from '../brain-js/src/export/model';
const dataset = await loadCleanDataset();
const selected = JSON.parse(
  await readFile(resolve(config.artifactsDirectory, 'selection.json'), 'utf8'),
) as FrozenSelection;
if (dataset.manifestSha256 !== selected.cleanManifestSha256) {
  throw new Error('Clean dataset changed.');
}
const settings = selected.selected.config;
const run = trainCandidate(
  cleanSamples(await readCleanHistograms(dataset, 'train'), settings.normalization ?? 'max15'),
  cleanSamples(await readCleanHistograms(dataset, 'validation'), settings.normalization ?? 'max15'),
  dataset.split.classes,
  settings,
  selected.initializationSeed,
);
const hash = sha256(
  JSON.stringify({
    ...run.model,
    trainOpts: { ...run.model.trainOpts, iterations: run.iterations },
  }),
);
if (hash !== selected.selected.modelSha256) {
  throw new Error('Clean-data selected weights failed reproduction.');
}
await writeFile(
  resolve(config.reportDataDirectory, 'selection-reproduction.json'),
  JSON.stringify(
    {
      modelSha256: hash,
      datasetFingerprint: dataset.manifest.fingerprint,
      source: 'Physical clean train/ and validation/ files only; no test inference.',
      sameWeights: true,
      epoch: run.iterations,
    },
    null,
    2,
  ),
);
console.log(`Same model hash: ${hash}`);
