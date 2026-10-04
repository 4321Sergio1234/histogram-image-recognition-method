import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { workspaceRoot } from '../config/training';
import {
  loadCuratedDataset,
  prepareCuratedDataset,
  readCuratedSamples,
  selectTrainingFiles,
  curatedSources,
  type CuratedDataset,
  type CuratedFile,
} from '../dataset/curated';
import { trainCandidate, type TrainingRun } from '../model/train';
import { loadNetwork, type NetworkJSON } from '../model/network';
import { evaluateNetwork } from '../evaluation/metrics';
import { exportModel, sha256, synchronizeModel, type FrozenSelection } from '../export/model';
import { validateManifest, type ModelManifest } from '../core';
import { OperationLog } from './progress';
import type { DatasetSplit } from '../dataset/types';
import { reviewCuratedModel } from '../evaluation/review-curated';

export const CLI_HELP = `Horizon training CLI (separate from the browser app)

Usage: pnpm ml <command> [options]
Commands:
  prepare    Inspect all labeled collections in --docs and copy curated originals
  inspect    Verify physical dataset, list split counts and selectable folders
  train      Decode train/validation; search LR/architecture; freeze selection
  evaluate   Score the frozen selection on test; verify reproducibility
  sync       Copy the evaluated model/manifest pair to the browser app
  review     Frozen errors, source counts and external sanity checks in docs
  benchmark  Compare train sizes and LR on the SAME validation set; no test

Options:
  --data PATH             Dataset root (default brain-js/data/scenes-curated-v2)
  --docs PATH             Raw docs collections (prepare only; default ../docs)
  --out PATH              Run folder (default brain-js/artifacts/curated-v2; benchmark ../docs/lab3/data/training-benchmark-v2)
  --folder PATH           Training root/subfolder, repeat to combine folders
  --epochs N              Maximum complete epochs (default 60)
  --learning-rate N       One LR in (0,1] (default search 0.03,0.1,0.3)
  --rates LIST            Comma-separated LR values in (0,1]
  --hidden LIST           Hidden widths, 0 = no hidden layer (default 0,16,32)
  --normalization VALUE   max15 or sqrt-max15 (default sqrt-max15)
  --seed N                Initialization seed (default 20261004)
  --limit N               Deterministic TRAIN subset; never limit holdouts
  --sizes LIST            Benchmark train sizes (default 300,600,all)
  --version X.Y.Z         Exported model version (default 6.1.0)
  --quiet                 Keep progress/events in operations.jsonl only
  --help                  Show this help

Paths are relative to repo/, even when invoked through pnpm's brain package.
Existing trained runs are immutable: choose --out for a new experiment.
No command runs during app build/deployment. Folder quality groups are actual
native resolution (small/medium/large), not upscaled or claimed perceptual quality.
`;
type Command = 'prepare' | 'inspect' | 'train' | 'evaluate' | 'sync' | 'benchmark' | 'review';
export interface CliOptions {
  command: Command;
  data: string;
  docs: string;
  out: string;
  folders: string[];
  epochs: number;
  rates: number[];
  hidden: number[];
  normalization: 'max15' | 'sqrt-max15';
  seed: number;
  limit?: number;
  sizes: (number | 'all')[];
  version: string;
  quiet: boolean;
}
export function parseCli(argv: string[]): CliOptions | null {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      quiet: { type: 'boolean' },
      data: { type: 'string' },
      docs: { type: 'string' },
      out: { type: 'string' },
      folder: { type: 'string', multiple: true },
      epochs: { type: 'string' },
      'learning-rate': { type: 'string' },
      rates: { type: 'string' },
      hidden: { type: 'string' },
      normalization: { type: 'string' },
      seed: { type: 'string' },
      limit: { type: 'string' },
      sizes: { type: 'string' },
      version: { type: 'string' },
    },
  });
  if (values.help || !positionals.length) {
    return null;
  }
  if (
    positionals.length !== 1 ||
    !['prepare', 'inspect', 'train', 'evaluate', 'sync', 'benchmark', 'review'].includes(
      positionals[0],
    )
  ) {
    throw new Error('Choose one documented command; see --help');
  }
  const integer = (name: string, value: string | undefined, fallback?: number): number => {
    const number = value === undefined ? fallback : Number(value);
    if (
      number === undefined ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      (value !== undefined && !/^\d+$/.test(value))
    ) {
      throw new Error(`--${name} must be a positive integer`);
    }
    return number;
  };
  if (values.rates && values['learning-rate']) {
    throw new Error('Use --rates or --learning-rate, not both');
  }
  const rates = (values.rates ?? values['learning-rate'] ?? '0.03,0.1,0.3').split(',').map(Number);
  if (rates.some((value) => !Number.isFinite(value) || value <= 0 || value > 1)) {
    throw new Error('Learning rates must be finite numbers in (0,1]');
  }
  const hidden = (values.hidden ?? '0,16,32').split(',').map(Number);
  if (hidden.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 256)) {
    throw new Error('--hidden requires widths from 0 to 256');
  }
  const normalization = values.normalization ?? 'sqrt-max15';
  if (normalization !== 'max15' && normalization !== 'sqrt-max15') {
    throw new Error('Unsupported normalization');
  }
  const version = values.version ?? '6.1.0';
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('--version must be X.Y.Z');
  }
  return {
    command: positionals[0] as Command,
    data: resolve(workspaceRoot, values.data ?? 'brain-js/data/scenes-curated-v2'),
    docs: resolve(workspaceRoot, values.docs ?? '../docs'),
    out: resolve(
      workspaceRoot,
      values.out ??
        (positionals[0] === 'benchmark'
          ? '../docs/lab3/data/training-benchmark-v2'
          : 'brain-js/artifacts/curated-v2'),
    ),
    folders: values.folder ?? [],
    epochs: integer('epochs', values.epochs, 60),
    rates: [...new Set(rates)],
    hidden: [...new Set(hidden)],
    normalization,
    seed: integer('seed', values.seed, 20261004),
    limit: values.limit === undefined ? undefined : integer('limit', values.limit),
    sizes: (values.sizes ?? '300,600,all')
      .split(',')
      .map((value) => (value === 'all' ? value : integer('sizes', value))),
    version,
    quiet: !!values.quiet,
  };
}
interface Selection extends FrozenSelection {
  schema: 'horizon-training-run-v2';
  options: CliOptions;
  datasetRoot: string;
  trainingFiles: CuratedFile[];
  createdAt: string;
  candidates: Omit<TrainingRun, 'model'>[];
  totalDurationMs: number;
}
async function train(
  options: CliOptions,
  dataset: CuratedDataset,
  log: OperationLog,
): Promise<Selection> {
  if (
    await lstat(resolve(options.out, 'selection.json'))
      .then(() => true)
      .catch(() => false)
  ) {
    throw new Error('Frozen run exists. Choose a different --out rather than overwrite it');
  }
  const started = performance.now(),
    files = selectTrainingFiles(dataset, options.folders, options.limit);
  const subset = {
    ...dataset.split,
    train: dataset.split.train.filter((row) => files.some((file) => file.path === row.path)),
  };
  const train = await readCuratedSamples(dataset, 'train', options.normalization, log, files);
  const validation = await readCuratedSamples(dataset, 'validation', options.normalization, log);
  const runs: TrainingRun[] = [];
  for (const learningRate of options.rates) {
    for (const width of options.hidden) {
      const config = {
        id: `${options.normalization}-h${width}-lr${learningRate}`,
        normalization: options.normalization,
        selectionMetric: 'macroF1' as const,
        hiddenLayers: width ? [width] : [],
        maxIterations: options.epochs,
        checkpointEvery: 1,
        learningRate,
        momentum: 0.1,
        errorThresh: 0.002,
      };
      log.event('candidate-start', { config, trainImages: files.length });
      runs.push(
        trainCandidate(
          train,
          validation,
          dataset.split.classes,
          config,
          options.seed,
          (checkpoint) =>
            log.progress('epochs', checkpoint.iterations, options.epochs, {
              candidate: config.id,
              ...checkpoint,
            }),
        ),
      );
      log.event('candidate-complete', {
        candidate: config.id,
        durationMs: runs.at(-1)!.durationMs,
        selectedEpoch: runs.at(-1)!.iterations,
        executedEpochs: runs.at(-1)!.checkpoints.at(-1)!.iterations,
      });
    }
  }
  const bestF1 = Math.max(...runs.map((row) => row.validationMetrics.macroF1));
  const selected = runs
    .filter((row) => row.validationMetrics.macroF1 >= bestF1 - 0.01 - 1e-12)
    .sort(
      (a, b) =>
        a.parameters - b.parameters ||
        b.validationMetrics.macroF1 - a.validationMetrics.macroF1 ||
        b.validationMetrics.accuracy - a.validationMetrics.accuracy,
    )[0];
  const bytes = JSON.stringify({
    ...selected.model,
    trainOpts: { ...selected.model.trainOpts, iterations: selected.iterations },
  });
  const summary = {
    config: selected.config,
    architecture: selected.architecture,
    iterations: selected.iterations,
    error: selected.error,
    durationMs: selected.durationMs,
    trainMetrics: selected.trainMetrics,
    validationMetrics: selected.validationMetrics,
  };
  const selection: Selection = {
    schema: 'horizon-training-run-v2',
    options,
    datasetRoot: dataset.root,
    trainingFiles: files,
    createdAt: new Date().toISOString(),
    selectionRule:
      'Checkpoint: highest validation macro-F1, accuracy then earlier epoch. Candidate: fewest parameters within 0.01 macro-F1 of the best, then macro-F1 and accuracy. All admitted selected training files used. Test never inferred during selection.',
    initializationSeed: options.seed,
    curationSha256: dataset.manifest.protocolSha256,
    cleanDatasetFingerprint: dataset.manifest.fingerprint,
    cleanManifestSha256: dataset.manifestSha256,
    splitSha256: sha256(JSON.stringify(subset)),
    populationSplitSha256: dataset.manifest.priorPopulationSha256,
    selected: { ...summary, modelSha256: sha256(bytes) },
    candidates: runs.map(({ model: _model, ...run }) => run),
    totalDurationMs: performance.now() - started,
  };
  await mkdir(options.out, { recursive: true });
  await writeFile(resolve(options.out, 'selected-model.json'), bytes);
  await writeFile(resolve(options.out, 'splits.json'), JSON.stringify(subset, null, 2));
  await writeFile(resolve(options.out, 'selection.json'), JSON.stringify(selection, null, 2));
  await writeFile(resolve(options.out, 'effective-config.json'), JSON.stringify(options, null, 2));
  log.event('selection-frozen', {
    sha256: selection.selected.modelSha256,
    selected: selected.config.id,
    selectedEpoch: selected.iterations,
    train: selected.trainMetrics,
    validation: selected.validationMetrics,
    totalDurationMs: selection.totalDurationMs,
  });
  return selection;
}
async function evaluate(options: CliOptions, dataset: CuratedDataset, log: OperationLog) {
  const selection = JSON.parse(
    await readFile(resolve(options.out, 'selection.json'), 'utf8'),
  ) as Selection;
  const bytes = await readFile(resolve(options.out, 'selected-model.json'), 'utf8');
  if (
    selection.cleanManifestSha256 !== dataset.manifestSha256 ||
    selection.cleanDatasetFingerprint !== dataset.manifest.fingerprint ||
    sha256(bytes) !== selection.selected.modelSha256
  ) {
    throw new Error('Dataset or weights changed after selection');
  }
  const split = JSON.parse(
    await readFile(resolve(options.out, 'splits.json'), 'utf8'),
  ) as DatasetSplit;
  if (sha256(JSON.stringify(split)) !== selection.splitSha256) {
    throw new Error('Frozen run split changed');
  }
  const samples = await readCuratedSamples(
    dataset,
    'test',
    selection.selected.config.normalization ?? 'max15',
    log,
  );
  const metrics = evaluateNetwork(
    loadNetwork(JSON.parse(bytes) as NetworkJSON),
    samples,
    split.classes,
  );
  const population = Object.values(dataset.manifest.populationCounts.test).reduce(
    (a, b) => a + b,
    0,
  );
  const domain: ModelManifest['domain'] = {
    id: 'curated-histogram-v2',
    description:
      'Canonical blue/cyan sea, green forest and warm sandy desert with distinct global brightness distributions. Lighting, unusual palettes and overlapping histograms can cause wrong labels.',
    palettes: split.classes.map((label) => ({
      id: label.id,
      description:
        label.id === 'sea'
          ? 'Blue/cyan sea and coast'
          : label.id === 'forest'
            ? 'Green forest'
            : 'Warm sandy desert',
    })),
    paletteTestCoverage: samples.length / population,
    testPopulationCount: population,
    cleanDatasetFingerprint: dataset.manifest.fingerprint,
    sourceCaveat:
      'Conditional cleaned test; identical train/validation/test gate with centroids fit on training only. Coverage denominator: deduplicated source candidates after preserved manual exclusions, before numeric palette/brightness screening. Source photos have been used/inspected in earlier experiments. Automatic palette review for additional sources; no runtime out-of-domain detector. Source confounding and imbalance remain.',
  };
  const evaluation = {
    modelSha256: sha256(bytes),
    datasetFingerprint: dataset.manifest.fingerprint,
    sampleCounts: {
      train: split.train.length,
      validation: split.validation.length,
      test: samples.length,
    },
    test: metrics,
    counts: dataset.manifest.counts,
    coverage: domain.paletteTestCoverage,
  };
  const file = resolve(options.out, 'evaluation.json');
  const previous = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (previous && JSON.stringify(JSON.parse(previous)) !== JSON.stringify(evaluation)) {
    throw new Error('Frozen test evaluation did not reproduce');
  }
  if (!previous) {
    await exportModel(bytes, selection, split, metrics, options.out, domain, {
      version: selection.options.version,
      datasets: curatedSources(dataset.manifest),
      split: {
        strategy:
          'Preserved source-photo group holdouts; previously unassigned groups70/15/15; identical HSV palette and training-only sqrt(H/N) nearest centroid gate in all splits; all selected training originals',
        seed: dataset.manifest.seed,
        validationPercent: 15,
        trainSource: 'brain-js/data/scenes-curated-v2/train (exact subset in run)',
        validationSource: 'brain-js/data/scenes-curated-v2/validation',
        testSource: 'brain-js/data/scenes-curated-v2/test',
      },
    });
    await writeFile(file, JSON.stringify(evaluation, null, 2));
    await writeFile(
      resolve(options.out, 'test-evaluations.json'),
      JSON.stringify([{ evaluatedAt: new Date().toISOString(), ...evaluation }], null, 2),
    );
  }
  log.event(previous ? 'test-reproduced' : 'test-evaluated', evaluation);
}
async function benchmark(options: CliOptions, dataset: CuratedDataset, log: OperationLog) {
  const rows: Record<string, unknown>[] = [];
  for (const size of options.sizes) {
    const out = resolve(options.out, `size-${size}`);
    const run = await train(
      { ...options, command: 'train', out, limit: size === 'all' ? undefined : size },
      dataset,
      new OperationLog(resolve(out, 'operations.jsonl'), options.quiet),
    );
    for (const candidate of run.candidates) {
      rows.push({
        trainImages: run.trainingFiles.length,
        subsetSha256: sha256(JSON.stringify(run.trainingFiles)),
        validationImages: dataset.split.validation.length,
        datasetFingerprint: dataset.manifest.fingerprint,
        ...candidate,
      });
    }
    log.event('benchmark-size-complete', { size, candidates: run.candidates.length });
  }
  await writeFile(
    resolve(options.out, 'benchmark.json'),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        testUsed: false,
        selectionMetric: 'validation macro-F1',
        repetitions: 1,
        caveat:
          'Training timing is one measured run per configuration. Same validation set/seed; sizes are nested deterministic subsets. No test-based selection.',
        rows,
      },
      null,
      2,
    ),
  );
  const header =
    '| Train | LR | Network | Epoch limit | Executed | Saved epoch | Time, s | Validation accuracy | Macro-F1 |\n|---:|---:|---|---:|---:|---:|---:|---:|---:|';
  const table = rows.map((row) => {
    const r = row as unknown as TrainingRun & { trainImages: number };
    return `| ${r.trainImages} | ${r.config.learningRate} | ${r.architecture} | ${r.config.maxIterations} | ${r.checkpoints.at(-1)!.iterations} | ${r.iterations} | ${(r.durationMs / 1000).toFixed(2)} | ${(100 * r.validationMetrics.accuracy).toFixed(2)}% | ${r.validationMetrics.macroF1.toFixed(4)} |`;
  });
  await writeFile(
    resolve(options.out, 'benchmark.md'),
    `# Training benchmark\n\nAll configurations use the same validation set and seed. Test is not used. Times are single measurements, not repeated timing estimates.\n\n${header}\n${table.join('\n')}\n`,
  );
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (!options) {
    console.log(CLI_HELP);
    return;
  }
  const log = new OperationLog(resolve(options.out, 'operations.jsonl'), options.quiet);
  log.event('command-start', { options });
  try {
    if (options.command === 'prepare') {
      await prepareCuratedDataset(options.docs, options.data, log);
    } else {
      const dataset = await loadCuratedDataset(options.data);
      if (options.command === 'inspect') {
        const folders = [
          ...new Set(
            dataset.manifest.files
              .filter((row) => row.partition === 'train')
              .map((row) => row.path.split('/').slice(0, 3).join('/')),
          ),
        ];
        console.log(
          JSON.stringify(
            {
              fingerprint: dataset.manifest.fingerprint,
              counts: dataset.manifest.counts,
              inventory: dataset.manifest.inventory,
              trainingFolders: folders,
            },
            null,
            2,
          ),
        );
      } else if (options.command === 'train') {
        await train(options, dataset, log);
      } else if (options.command === 'evaluate') {
        await evaluate(options, dataset, log);
      } else if (options.command === 'benchmark') {
        await benchmark(options, dataset, log);
      } else if (options.command === 'review') {
        await reviewCuratedModel(dataset, options.out, options.docs, log);
      } else {
        const manifest = validateManifest(
          JSON.parse(await readFile(resolve(options.out, 'manifest.json'), 'utf8')),
        );
        if (manifest.datasetFingerprint !== dataset.manifest.fingerprint) {
          throw new Error('Evaluated model belongs to a different dataset');
        }
        await synchronizeModel(
          options.out,
          resolve(workspaceRoot, 'react-web-app/public/models/scene-recognition'),
        );
        log.event('model-synchronized', {
          version: manifest.version,
          sha256: manifest.modelSha256,
        });
      }
    }
    log.event('command-complete');
  } catch (error) {
    log.event('command-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
