import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../config/clean-training';
import { loadCleanDataset, readCleanHistograms } from '../dataset/clean';
import { quantizeHistogram } from '../features/histogram';
import { separability } from '../evaluation/separability';
const dataset = await loadCleanDataset();
const rows = await readCleanHistograms(dataset, 'train');
const summary = separability(
  rows.map((row) => ({
    classIndex: row.classIndex,
    histogram: row.histogram,
    quantized: quantizeHistogram(row.histogram),
  })),
  dataset.split.classes.map((row) => row.id),
);
await mkdir(config.reportDataDirectory, { recursive: true });
await writeFile(
  resolve(config.reportDataDirectory, 'feature-separability.json'),
  JSON.stringify(
    {
      datasetFingerprint: dataset.manifest.fingerprint,
      scope:
        'Actual copied train/ images only. Gate centroids remain frozen from the source training partition; these descriptive centroids are not used to refilter any split.',
      ...summary,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { counts: dataset.manifest.counts, centroidDistances: summary.centroidDistances },
    null,
    2,
  ),
);
