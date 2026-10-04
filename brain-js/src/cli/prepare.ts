import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig, datasetPaths } from '../config/training';
import { loadOrCreateAudit } from '../dataset/audit';
import { populationSplit, preparePaletteExperiment } from '../dataset/palette';
const audit = await loadOrCreateAudit(datasetPaths(), trainingConfig.artifactsDirectory);
if (process.argv.includes('--population-only')) {
  const split = populationSplit(audit, trainingConfig.splitSeed),
    text = JSON.stringify(split, null, 2),
    file = resolve(trainingConfig.reportDataDirectory, 'population-splits.json');
  await mkdir(trainingConfig.reportDataDirectory, { recursive: true });
  const existing = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (existing && existing !== text) {
    throw new Error('Frozen population split changed.');
  }
  if (!existing) {
    await writeFile(file, text);
  }
  console.log(
    JSON.stringify(
      {
        scope: 'Unfiltered group partition, no model inference',
        counts: split.counts,
        excluded: split.excluded.length,
      },
      null,
      2,
    ),
  );
} else {
  const result = await preparePaletteExperiment(
    audit,
    trainingConfig.artifactsDirectory,
    trainingConfig.reportDataDirectory,
    trainingConfig.splitSeed,
    process.argv.includes('--exploratory-small-sample'),
  );
  console.log(
    JSON.stringify(
      {
        counts: result.split.counts,
        paletteTrain: result.paletteTrainCounts,
        histogramTrain: result.histogramTrainCounts,
      },
      null,
      2,
    ),
  );
}
