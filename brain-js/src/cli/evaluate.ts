import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig } from '../config/training';
import { validateManifest } from '../core/manifest';
import { loadNetwork, type NetworkJSON } from '../model/network';
import { evaluateNetwork } from '../evaluation/metrics';
import { assertNoLeakage, readSamples } from '../dataset/split';
import { exportModel, sha256, type FrozenSelection } from '../export/model';
import type { DatasetSplit } from '../dataset/types';
import type { ModelManifest } from '../core/contracts';

const directory = trainingConfig.artifactsDirectory;
const splitBytes = await readFile(resolve(directory, 'splits.json'));
const split = JSON.parse(splitBytes.toString()) as DatasetSplit;
const selection = JSON.parse(
  await readFile(resolve(directory, 'selection.json'), 'utf8'),
) as FrozenSelection;
const modelJson = await readFile(resolve(directory, 'selected-model.json'), 'utf8');
if (sha256(modelJson) !== selection.selected.modelSha256) {
  throw new Error('The frozen model does not match its selection record. Retrain.');
}
const curationBytes = await readFile(resolve(trainingConfig.reportDataDirectory, 'curation.json'));
if (sha256(curationBytes) !== selection.curationSha256) {
  throw new Error(
    'Curation changed after model selection. Start a new experiment; do not silently rescore a changed holdout.',
  );
}
if (sha256(splitBytes) !== selection.splitSha256) {
  throw new Error('Curated split changed after model selection.');
}
const curation = JSON.parse(curationBytes.toString()) as {
  testAdmission: { path: string; accepted: boolean; paletteEligible: boolean }[];
};
assertNoLeakage(split);
const logFile = resolve(directory, 'test-evaluations.json');
type TestEvaluation = {
  evaluatedAt: string;
  modelSha256: string;
  architecture: string;
  accuracy: number;
  macroF1: number;
};
const log: TestEvaluation[] = await readFile(logFile, 'utf8')
  .then((text) => JSON.parse(text) as TestEvaluation[])
  .catch(() => []);
let existing;
try {
  existing = validateManifest(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
} catch {
  existing = undefined;
}
const test = await readSamples(split, 'test', directory, selection.selected.config.normalization);
const metrics = evaluateNetwork(
  loadNetwork(JSON.parse(modelJson) as NetworkJSON),
  test,
  split.classes,
);
const populationBytes = await readFile(
  resolve(trainingConfig.reportDataDirectory, 'population-splits.json'),
);
if (sha256(populationBytes) !== selection.populationSplitSha256) {
  throw new Error('Population split changed after model selection.');
}
const population = JSON.parse(populationBytes.toString()) as DatasetSplit;
assertNoLeakage(population);
const populationTest = await readSamples(
  population,
  'test',
  directory,
  selection.selected.config.normalization,
);
const network = loadNetwork(JSON.parse(modelJson) as NetworkJSON);
const fullMetrics = evaluateNetwork(network, populationTest, split.classes);
const admitted = new Set(
  curation.testAdmission
    .filter((row) => row.accepted && row.paletteEligible)
    .map((row) => row.path),
);
const admittedMetrics = evaluateNetwork(
  network,
  test.filter((sample) => admitted.has(sample.path)),
  split.classes,
);
const domain: ModelManifest['domain'] = {
  id: 'geoscene-canonical-palette-v1',
  description:
    'Blue/cyan sea, green leafy forest and warm sandy desert in natural daylight; other palettes are outside the trained scope.',
  palettes: [
    { id: 'sea', description: 'Blue or cyan water-dominant sea' },
    { id: 'forest', description: 'Green leafy forest' },
    { id: 'desert', description: 'Warm tan, golden or ochre sandy desert' },
  ],
  paletteTestCoverage: test.length / populationTest.length,
  populationTestMetrics: fullMetrics,
  sourceCaveat:
    'The local GeoSceneNet16K classes byte-match prior Intel (Sea/Forest) and Landscape (Desert) photographs. One folder does not remove inherited source/class confounding.',
};
const scopes = {
  modelSha256: selection.selected.modelSha256,
  paletteTest: metrics,
  populationTest: fullMetrics,
  paletteCoverage: domain.paletteTestCoverage,
  histogramAdmittedPaletteTest: admittedMetrics,
  histogramAdmittedCoverageOfPalette: admittedMetrics.total / metrics.total,
  note: 'Selection used palette validation only. All-palette and class-independent histogram-admitted test scopes are final diagnostics, not tuning targets. Never interpret conditional accuracy without its coverage.',
};
const scopesFile = resolve(trainingConfig.reportDataDirectory, 'evaluation-scopes.json');
if (existing?.modelSha256 === selection.selected.modelSha256) {
  if (JSON.stringify(metrics) !== JSON.stringify(existing.testMetrics)) {
    throw new Error('Re-evaluation does not reproduce the recorded test metrics.');
  }
  if (JSON.stringify(scopes) !== JSON.stringify(JSON.parse(await readFile(scopesFile, 'utf8')))) {
    throw new Error('Re-evaluation does not reproduce every recorded evaluation scope.');
  }
  console.log(
    `Model ${existing.version} was already evaluated on the test sections; re-evaluation exactly reproduces accuracy ${(100 * metrics.accuracy).toFixed(2)}% and macro-F1 ${metrics.macroF1.toFixed(4)}. No new export.`,
  );
} else {
  await writeFile(scopesFile, JSON.stringify(scopes, null, 2));
  const manifest = await exportModel(modelJson, selection, split, metrics, directory, domain);
  log.push({
    evaluatedAt: manifest.createdAt,
    modelSha256: manifest.modelSha256,
    architecture: manifest.network.architecture,
    accuracy: metrics.accuracy,
    macroF1: metrics.macroF1,
  });
  await writeFile(logFile, JSON.stringify(log, null, 2));
  console.log(
    `Final test evaluation of frozen ${manifest.network.architecture}: accuracy ${(100 * metrics.accuracy).toFixed(2)}%, macro-F1 ${metrics.macroF1.toFixed(4)} on ${metrics.total} images.`,
  );
  if (log.length > 1) {
    console.warn(
      `Note: ${log.length} distinct frozen models have now been scored on test sections (see test-evaluations.json).`,
    );
  }
}
console.log(
  'Evaluation does not replace the production model. Promotion is a separate pnpm sync:model operation.',
);
