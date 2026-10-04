import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../brain-js/src/config/clean-training';
import { loadCleanDataset, readCleanHistograms, cleanSamples } from '../brain-js/src/dataset/clean';
import {
  brightnessHistogram,
  encodeFourBits,
  quantizeHistogram,
  rankPredictions,
  validateManifest,
} from '../brain-js/src/core';
import { decodeImage } from '../brain-js/src/image/decode';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { evaluateNetwork, metricsFromConfusion } from '../brain-js/src/evaluation/metrics';
import { sha256 } from '../brain-js/src/export/model';
import { contactSheet } from './lib/diagnostic-images';
import type { DatasetSplit } from '../brain-js/src/dataset/types';

// Frozen-model diagnostics only. This script cannot change membership, weights or selection.
const dataset = await loadCleanDataset();
const readModel = async (directory: string) => {
  const manifest = validateManifest(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  const bytes = await readFile(resolve(directory, 'model.json'));
  if (sha256(bytes) !== manifest.modelSha256) {
    throw new Error('Model integrity mismatch.');
  }
  const split = JSON.parse(
    await readFile(resolve(directory, 'splits.json'), 'utf8'),
  ) as DatasetSplit;
  return {
    split,
    manifest,
    network: loadNetwork(JSON.parse(bytes.toString()) as NetworkJSON),
    normalization:
      manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2'
        ? ('sqrt-max15' as const)
        : ('max15' as const),
  };
};
const current = await readModel(config.artifactsDirectory);
const models = await Promise.all([
  readModel(resolve('../docs/lab2/data/model-diagnostics/baseline-3.0.0')),
  readModel(resolve('brain-js/artifacts/geoscene-palette-v1')),
]);
models.push(current);
const comparison = [];
await mkdir(config.reportFigureDirectory, { recursive: true });
for (const phase of ['validation', 'test'] as const) {
  const rows = await readCleanHistograms(dataset, phase);
  comparison.push({
    phase,
    models: models.map((model) => ({
      version: model.manifest.version,
      modelSha256: model.manifest.modelSha256,
      priorSplitOverlap: Object.fromEntries(
        (['train', 'validation', 'test'] as const).map((previousPhase) => [
          previousPhase,
          dataset.manifest.files.filter(
            (file) =>
              file.partition === phase &&
              model.split[previousPhase].some((previous) => previous.sha256 === file.sha256),
          ).length,
        ]),
      ),
      metrics: evaluateNetwork(
        model.network,
        cleanSamples(rows, model.normalization),
        dataset.split.classes,
      ),
    })),
  });
  const predictions = cleanSamples(rows, current.normalization).map((sample) => ({
    ...sample,
    top: rankPredictions(current.network.run(sample.input), current.manifest.classes)[0],
  }));
  const errors = predictions.filter(
    (row) => row.top.label.id !== current.manifest.classes[row.classIndex].id,
  );
  if (errors.length) {
    await contactSheet(
      errors.map((row) => ({
        file: resolve(dataset.root, row.path),
        caption: `${current.manifest.classes[row.classIndex].id} -> ${row.top.label.id} ${(100 * row.top.score).toFixed(1)}%`,
      })),
      resolve(config.reportFigureDirectory, `${phase}-errors.jpg`),
      `Clean model ${current.manifest.version}: ${phase} errors`,
      5,
    );
  }
}
await writeFile(
  resolve(config.reportDataDirectory, 'frozen-model-comparison.json'),
  JSON.stringify(
    {
      scope:
        'Post-selection diagnostic on identical copied partitions; older models used different splits/selection protocols. Inspect priorSplitOverlap: the 3.0.0 scores are contaminated by its own training images and are NOT held-out comparisons. Not used to revise frozen selection.',
      datasetFingerprint: dataset.manifest.fingerprint,
      comparison,
    },
    null,
    2,
  ),
);

const sanity = resolve('../docs/lab2/data/model-diagnostics/external-sanity');
const setBytes = await readFile(resolve(sanity, 'frozen-set.json'));
if (sha256(setBytes) !== (await readFile(resolve(sanity, 'frozen-set.sha256'), 'utf8')).trim()) {
  throw new Error('External sanity set changed.');
}
const set = JSON.parse(setBytes.toString()) as {
  images: { file: string; classId: string; title: string; sha256: string }[];
};
const results: ((typeof set.images)[number] & { scores: { id: string; score: number }[] })[] = [];
for (const row of set.images) {
  const file = resolve(sanity, row.file);
  if (sha256(await readFile(file)) !== row.sha256) {
    throw new Error('External image changed.');
  }
  const histogram = brightnessHistogram((await decodeImage(file)).rgba);
  const quantized = quantizeHistogram(histogram, current.normalization);
  const scores = rankPredictions(
    current.network.run(encodeFourBits(quantized)),
    current.manifest.classes,
  ).map((item) => ({ id: item.label.id, score: item.score }));
  results.push({ ...row, scores });
}
const summarize = (rows: typeof results) => {
  const matrix = current.manifest.classes.map(() => current.manifest.classes.map(() => 0));
  for (const row of rows) {
    matrix[current.manifest.classes.findIndex((item) => item.id === row.classId)][
      current.manifest.classes.findIndex((item) => item.id === row.scores[0].id)
    ]++;
  }
  return metricsFromConfusion(matrix, current.manifest.classes);
};
const report = {
  modelSha256: current.manifest.modelSha256,
  scope:
    'Separate reused external diagnostic photos, outside the strict histogram domain. Not primary test data; never used to train, clean data or select this model. Not a fresh blind benchmark.',
  withoutKnownSahara: summarize(results.filter((row) => row.file !== 'sahara-user.jpg')),
  includingKnownSahara: summarize(results),
  sahara: results.find((row) => row.file === 'sahara-user.jpg'),
  images: results,
};
await writeFile(
  resolve(config.reportDataDirectory, 'external-sanity-results.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { comparison, external: report.includingKnownSahara, sahara: report.sahara?.scores },
    null,
    2,
  ),
);
