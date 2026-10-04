import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig, datasetPaths, numberOption } from '../config/training';
import { preparePaletteExperiment } from '../dataset/palette';
import { loadOrCreateAudit } from '../dataset/audit';
import { readSamples } from '../dataset/split';
import { selectCandidate, trainCandidate, type TrainingRun } from '../model/train';
import { sha256, type FrozenSelection } from '../export/model';

const directory = trainingConfig.artifactsDirectory;
await mkdir(directory, { recursive: true });
const audit = await loadOrCreateAudit(datasetPaths(), directory);
const seed = numberOption('--seed', trainingConfig.splitSeed);
const { split } = await preparePaletteExperiment(
  audit,
  directory,
  trainingConfig.reportDataDirectory,
  seed,
  process.argv.includes('--exploratory-small-sample'),
);
await writeFile(resolve(directory, 'splits.json'), JSON.stringify(split, null, 2));
console.log(
  `Split (seed ${seed}): ${split.train.length} train / ${split.validation.length} validation from manually accepted palette representatives; ${split.test.length} palette test representatives reserved (no inference during training). Excluded originals: ${split.excluded.length}.`,
);
console.log(JSON.stringify(split.counts));

const maxIterations = numberOption('--max-iterations', trainingConfig.maxIterations);
const runs: TrainingRun[] = [];
const summary = ({ model: _model, ...rest }: TrainingRun) => rest;
for (const normalization of ['max15', 'sqrt-max15'] as const) {
  const train = await readSamples(split, 'train', directory, normalization);
  const validation = await readSamples(split, 'validation', directory, normalization);
  for (const candidate of trainingConfig.candidates) {
    const config = {
      ...candidate,
      id: `${normalization}-${candidate.id}`,
      normalization,
      maxIterations,
      checkpointEvery: trainingConfig.checkpointEvery,
      learningRate: trainingConfig.learningRate,
      momentum: trainingConfig.momentum,
      errorThresh: trainingConfig.errorThresh,
    };
    console.log(`Training candidate ${config.id}…`);
    runs.push(
      trainCandidate(train, validation, split.classes, config, trainingConfig.initializationSeed),
    );
    await writeFile(
      resolve(directory, 'candidates.json'),
      JSON.stringify(runs.map(summary), null, 2),
    );
  }
}
const selected = selectCandidate(runs, trainingConfig.equivalenceMargin);
const modelJson = JSON.stringify({
  ...selected.model,
  trainOpts: { ...selected.model.trainOpts, iterations: selected.iterations },
});
const selectionRule = `Highest validation top-1 accuracy per candidate (checkpoint every ${trainingConfig.checkpointEvery} epochs, macro-F1 then fewer epochs break ties); candidates within ${trainingConfig.equivalenceMargin * 100} percentage points of the best are equivalent and the fewest parameters wins. Test sections not used.`;
const frozen: FrozenSelection & {
  selectedId: string;
  candidates: ReturnType<typeof summary>[];
  splitSeed: number;
  createdAt: string;
} = {
  curationSha256: sha256(
    await readFile(resolve(trainingConfig.reportDataDirectory, 'curation.json')),
  ),
  splitSha256: sha256(await readFile(resolve(directory, 'splits.json'))),
  populationSplitSha256: sha256(
    await readFile(resolve(trainingConfig.reportDataDirectory, 'population-splits.json')),
  ),
  createdAt: new Date().toISOString(),
  selectedId: selected.config.id,
  selectionRule,
  initializationSeed: trainingConfig.initializationSeed,
  splitSeed: seed,
  selected: {
    config: selected.config,
    architecture: selected.architecture,
    iterations: selected.iterations,
    error: selected.error,
    durationMs: selected.durationMs,
    trainMetrics: selected.trainMetrics,
    validationMetrics: selected.validationMetrics,
    modelSha256: sha256(modelJson),
  },
  candidates: runs.map(summary),
};
await writeFile(resolve(directory, 'selected-model.json'), modelJson);
await writeFile(resolve(directory, 'selection.json'), JSON.stringify(frozen, null, 2));
for (const run of runs) {
  console.log(
    `${run.config.id} ${run.architecture}: validation ${(100 * run.validationMetrics.accuracy).toFixed(2)}% / macro-F1 ${run.validationMetrics.macroF1.toFixed(4)} at epoch ${run.iterations}; train ${(100 * run.trainMetrics.accuracy).toFixed(2)}%; ${run.parameters} parameters`,
  );
}
console.log(
  `Selected ${selected.config.id} (${selected.architecture}) at epoch ${selected.iterations}. Test sections have not been read. Run "pnpm evaluate" once to score the frozen model on the test sections and export it.`,
);
