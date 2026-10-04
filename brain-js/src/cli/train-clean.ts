import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../config/clean-training';
import { cleanSamples, loadCleanDataset, readCleanHistograms } from '../dataset/clean';
import { trainCandidate, selectCandidate, type TrainingRun } from '../model/train';
import { sha256, type FrozenSelection } from '../export/model';

const dataset = await loadCleanDataset();
console.log(
  `Reading materialized cleaned images from ${dataset.root}. Same histogram eligibility in every split.`,
);
console.log(JSON.stringify(dataset.manifest.counts));
// Test image bytes are checked for integrity; test pixels are not decoded and predictions are not run here.
const trainRows = await readCleanHistograms(dataset, 'train');
const validationRows = await readCleanHistograms(dataset, 'validation');
const runs: TrainingRun[] = [];
const summary = ({ model: _model, ...rest }: TrainingRun) => rest;
await mkdir(config.artifactsDirectory, { recursive: true });
await mkdir(config.reportDataDirectory, { recursive: true });
for (const normalization of ['max15', 'sqrt-max15'] as const) {
  const train = cleanSamples(trainRows, normalization),
    validation = cleanSamples(validationRows, normalization);
  for (const candidate of config.candidates) {
    const settings = {
      ...candidate,
      id: `${normalization}-${candidate.id}`,
      normalization,
      maxIterations: config.maxIterations,
      checkpointEvery: config.checkpointEvery,
      learningRate: config.learningRate,
      momentum: config.momentum,
      errorThresh: config.errorThresh,
    };
    runs.push(
      trainCandidate(train, validation, dataset.split.classes, settings, config.initializationSeed),
    );
  }
}
const selected = selectCandidate(runs, config.equivalenceMargin);
const bytes = JSON.stringify({
  ...selected.model,
  trainOpts: { ...selected.model.trainOpts, iterations: selected.iterations },
});
const selection: FrozenSelection & {
  selectedId: string;
  createdAt: string;
  candidates: ReturnType<typeof summary>[];
  datasetRoot: string;
} = {
  selectedId: selected.config.id,
  createdAt: new Date().toISOString(),
  datasetRoot: dataset.root,
  selectionRule:
    'Best strict-clean validation accuracy checkpoint (macro-F1, then earliest epoch ties); fewest parameters within1percentage point of best candidate. Same eligibility in every split. Test not used for selection.',
  initializationSeed: config.initializationSeed,
  curationSha256: dataset.manifestSha256,
  cleanManifestSha256: dataset.manifestSha256,
  cleanDatasetFingerprint: dataset.manifest.fingerprint,
  splitSha256: sha256(JSON.stringify(dataset.split)),
  populationSplitSha256: dataset.manifest.sourcePopulationSha256,
  selected: {
    config: selected.config,
    architecture: selected.architecture,
    iterations: selected.iterations,
    error: selected.error,
    durationMs: selected.durationMs,
    trainMetrics: selected.trainMetrics,
    validationMetrics: selected.validationMetrics,
    modelSha256: sha256(bytes),
  },
  candidates: runs.map(summary),
};
for (const directory of [config.artifactsDirectory, config.reportDataDirectory]) {
  await writeFile(resolve(directory, 'selected-model.json'), bytes);
  await writeFile(resolve(directory, 'selection.json'), JSON.stringify(selection, null, 2));
  await writeFile(resolve(directory, 'splits.json'), JSON.stringify(dataset.split, null, 2));
}
console.log(
  JSON.stringify(
    {
      selected: selected.config.id,
      architecture: selected.architecture,
      epoch: selected.iterations,
      train: selected.trainMetrics,
      validation: selected.validationMetrics,
      modelSha256: selection.selected.modelSha256,
      test: 'Not inferred during selection; run pnpm evaluate.',
    },
    null,
    2,
  ),
);
