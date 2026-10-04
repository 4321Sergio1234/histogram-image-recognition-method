import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig } from '../brain-js/src/config/training';
import {
  brightnessHistogram,
  encodeFourBits,
  quantizeHistogram,
  rankPredictions,
  validateManifest,
} from '../brain-js/src/core';
import { decodeImage } from '../brain-js/src/image/decode';
import { imageFile } from '../brain-js/src/dataset/audit';
import { readSamples } from '../brain-js/src/dataset/split';
import type { DatasetAudit, DatasetSplit } from '../brain-js/src/dataset/types';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { metricsFromConfusion } from '../brain-js/src/evaluation/metrics';
import { sha256 } from '../brain-js/src/export/model';
import { contactSheet } from './lib/diagnostic-images';

// Final diagnostics only: no fitting, selection, dataset preparation or production synchronization.
const directory = trainingConfig.artifactsDirectory,
  output = trainingConfig.reportDataDirectory;
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const manifest = validateManifest(await json(resolve(directory, 'manifest.json')));
const bytes = await readFile(resolve(directory, 'model.json'));
if (sha256(bytes) !== manifest.modelSha256) {
  throw new Error('Frozen model hash mismatch.');
}
const network = loadNetwork(JSON.parse(bytes.toString()) as NetworkJSON);
const normalization =
  manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15';
const split = await json<DatasetSplit>(resolve(directory, 'splits.json'));
const audit = await json<DatasetAudit>(resolve(directory, 'audit.json'));
const samples = await readSamples(split, 'validation', directory, normalization);
const predictions = samples.map((sample) => ({
  ...sample,
  predictions: rankPredictions(network.run(sample.input), manifest.classes),
}));
const sheets = [];
for (const [truth, prediction] of [
  ['sea', 'sea'],
  ['sea', 'desert'],
  ['desert', 'desert'],
  ['desert', 'sea'],
  ['forest', 'error'],
] as const) {
  const rows = predictions
    .filter(
      (row) =>
        manifest.classes[row.classIndex].id === truth &&
        (prediction === 'error'
          ? row.predictions[0].label.id !== truth
          : row.predictions[0].label.id === prediction),
    )
    .sort((a, b) => b.predictions[0].score - a.predictions[0].score)
    .slice(0, 12);
  if (!rows.length) {
    continue;
  }
  const file = `validation-${truth}-${prediction}.jpg`;
  await contactSheet(
    rows.map((row) => ({
      file: imageFile(
        audit,
        split.validation.find((image) => image.path === row.path)!,
      ),
      caption: `${truth} -> ${row.predictions[0].label.id} ${(100 * row.predictions[0].score).toFixed(1)}%`,
    })),
    resolve(trainingConfig.reportFigureDirectory, file),
    `Palette validation: ${truth} / ${prediction}`,
    4,
  );
  sheets.push({
    file,
    rows: rows.map((row) => ({
      path: row.path,
      truth,
      predicted: row.predictions[0].label.id,
      score: row.predictions[0].score,
    })),
  });
}
await writeFile(resolve(output, 'validation-contact-sheets.json'), JSON.stringify(sheets, null, 2));

// Reuse the previously frozen external sanity set; it is explicitly NOT a fresh blind benchmark.
const sanity = resolve('../docs/lab2/data/model-diagnostics/external-sanity');
const setBytes = await readFile(resolve(sanity, 'frozen-set.json'));
if (sha256(setBytes) !== (await readFile(resolve(sanity, 'frozen-set.sha256'), 'utf8')).trim()) {
  throw new Error('External sanity set changed.');
}
const set = JSON.parse(setBytes.toString()) as {
  images: { file: string; classId: string; title: string; sha256: string }[];
};
const results: ((typeof set.images)[number] & {
  scores: { id: string; score: number }[];
  histogram?: number[];
  quantized?: number[];
  features?: number[];
})[] = [];
for (const row of set.images) {
  const file = resolve(sanity, row.file);
  if (sha256(await readFile(file)) !== row.sha256) {
    throw new Error(`External file changed: ${row.file}`);
  }
  const histogram = brightnessHistogram((await decodeImage(file)).rgba);
  const quantized = quantizeHistogram(histogram, normalization),
    features = encodeFourBits(quantized);
  const scores = rankPredictions(network.run(features), manifest.classes).map((item) => ({
    id: item.label.id,
    score: item.score,
  }));
  results.push({
    ...row,
    scores,
    ...(row.file === 'sahara-user.jpg' ? { histogram, quantized, features } : {}),
  });
}
const summarize = (rows: typeof results) => {
  const matrix = manifest.classes.map(() => manifest.classes.map(() => 0));
  for (const row of rows) {
    matrix[manifest.classes.findIndex((item) => item.id === row.classId)][
      manifest.classes.findIndex((item) => item.id === row.scores[0].id)
    ]++;
  }
  return metricsFromConfusion(matrix, manifest.classes);
};
const report = {
  modelSha256: manifest.modelSha256,
  scope:
    'Previously used frozen external diagnostic photos, including palettes outside the restricted training scope; never used for training, filtering or candidate selection. Repeated evaluation, not fresh-source confirmation.',
  withoutKnownSahara: summarize(results.filter((row) => row.file !== 'sahara-user.jpg')),
  includingKnownSahara: summarize(results),
  sahara: results.find((row) => row.file === 'sahara-user.jpg'),
  images: results,
};
await writeFile(resolve(output, 'external-sanity-results.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({ external: report.withoutKnownSahara, sahara: report.sahara?.scores }, null, 2),
);
