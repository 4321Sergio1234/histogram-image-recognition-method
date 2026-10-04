import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig } from '../config/training';
import type { AuditedImage, DatasetSplit } from '../dataset/types';
import type { ManualDecision } from '../dataset/palette';
import { classIndex } from '../dataset/split';
import { quantizeHistogram } from '../features/histogram';
import { separability } from '../evaluation/separability';
const directory = trainingConfig.artifactsDirectory,
  output = trainingConfig.reportDataDirectory;
const split = JSON.parse(await readFile(resolve(directory, 'splits.json'), 'utf8')) as DatasetSplit;
const population = JSON.parse(
  await readFile(resolve(output, 'population-splits.json'), 'utf8'),
) as DatasetSplit;
const cache = await readFile(resolve(directory, 'histograms.bin'));
const accepted = new Set<string>();
for (const label of split.classes) {
  const ledger = JSON.parse(
    await readFile(resolve(output, 'manual-review', `${label.id}-decisions.json`), 'utf8'),
  ) as { images?: ManualDecision[]; decisions?: ManualDecision[] };
  for (const row of ledger.images ?? ledger.decisions ?? []) {
    if (row.decision === 'include') {
      accepted.add(row.path);
    }
  }
}
const sample = (image: AuditedImage) => {
  const histogram = Array.from({ length: 256 }, (_, i) =>
    cache.readUInt32LE(image.featureIndex * 1024 + i * 4),
  );
  return {
    classIndex: classIndex(split, image),
    histogram,
    quantized: quantizeHistogram(histogram),
  };
};
const stats = (images: AuditedImage[]) => {
  const samples = images.map(sample),
    summary = separability(
      samples,
      split.classes.map((label) => label.id),
    );
  const perClass = summary.perClass.map((row) => {
    const same = samples.filter((sample) => split.classes[sample.classIndex].id === row.id);
    const meanRaw = Array.from(
      { length: 256 },
      (_, i) => same.reduce((sum, s) => sum + s.histogram[i], 0) / same.length,
    );
    const std = (series: number[][], mean: number[]) =>
      mean.map((m, i) =>
        Math.sqrt(series.reduce((sum, v) => sum + (v[i] - m) ** 2, 0) / series.length),
      );
    const share = same.map((s) => {
      const total = s.histogram.reduce((a, b) => a + b, 0);
      return s.histogram.map((n) => n / total);
    });
    return {
      ...row,
      peakBin: row.centroid.indexOf(Math.max(...row.centroid)),
      meanRaw,
      stdRaw: std(
        same.map((s) => s.histogram),
        meanRaw,
      ),
      stdShare: std(share, row.centroid),
      stdQuantized: std(
        same.map((s) => s.quantized),
        row.meanQuantized,
      ),
    };
  });
  const distances = perClass.flatMap((a, i) =>
    perClass.slice(i + 1).map((b) => ({
      pair: [a.id, b.id],
      euclidean: Math.sqrt(a.centroid.reduce((sum, n, j) => sum + (n - b.centroid[j]) ** 2, 0)),
      cosine:
        a.centroid.reduce((sum, n, j) => sum + n * b.centroid[j], 0) /
        Math.sqrt(
          a.centroid.reduce((sum, n) => sum + n * n, 0) *
            b.centroid.reduce((sum, n) => sum + n * n, 0),
        ),
    })),
  );
  return { ...summary, perClass, distances };
};
const stages = {
  unfilteredTrain: stats(population.train),
  manualPaletteTrain: stats(population.train.filter((image) => accepted.has(image.path))),
  filteredBalancedTrain: stats(split.train),
};
const report = {
  createdAt: new Date().toISOString(),
  scope:
    'TRAIN ONLY. Unfiltered source-photo representatives -> manual canonical palette -> histogram-margin filtering and balancing. No holdout data fits the centroids or filters.',
  ...stages.filteredBalancedTrain,
  stages,
  note: 'Colour is manual eligibility only. All ANN input features remain 256 luminance bins encoded into 1024 bits. Training selection deliberately makes distributions more separable, so a train-centroid diagnostic is not holdout accuracy.',
};
await writeFile(resolve(output, 'feature-separability.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(stages).map(([name, data]) => [
        name,
        {
          perClass: data.perClass.map((x) => ({
            id: x.id,
            count: x.count,
            meanLuminance: x.meanLuminance,
          })),
          distances: data.distances,
        },
      ]),
    ),
    null,
    2,
  ),
);
