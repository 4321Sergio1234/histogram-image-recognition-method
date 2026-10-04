import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trainingConfig } from '../config/training';
import { isUncertain, rankPredictions, validateManifest } from '../core';
import { auditSummary } from '../dataset/audit';
import { assertNoLeakage, readSamples } from '../dataset/split';
import type { DatasetAudit, DatasetSplit, SplitName } from '../dataset/types';
import {
  cohenKappa,
  confusionPairs,
  predictionDiagnostics,
  type ReviewedPrediction,
} from '../evaluation/diagnostics';
import { evaluateNetwork } from '../evaluation/metrics';
import { sha256 } from '../export/model';
import { loadNetwork, type NetworkJSON } from '../model/network';

const directory = trainingConfig.artifactsDirectory;
const output = trainingConfig.reportDataDirectory;
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const optional = async <T>(file: string): Promise<T | null> => json<T>(file).catch(() => null);
const manifest = validateManifest(await json(resolve(directory, 'manifest.json')));
const activeManifest = validateManifest(
  await json(resolve(trainingConfig.exportDirectory, 'manifest.json')),
);
const modelText = await readFile(resolve(directory, 'model.json'), 'utf8');
if (sha256(modelText) !== manifest.modelSha256) {
  throw new Error('Model checksum failed.');
}
const split = await json<DatasetSplit>(resolve(directory, 'splits.json'));
const selection = await json<{ selectedId: string; selectionRule: string; candidates: unknown[] }>(
  resolve(directory, 'selection.json'),
);
const curation = await json<{
  exploratorySmallSample: boolean;
  minimumThirtyPerClassPassed: boolean;
  paletteTrainCounts: number[];
  histogramTrainCounts: number[];
  balancedTrainCounts: number[];
}>(resolve(output, 'curation.json'));
const audit = await json<DatasetAudit>(resolve(directory, 'audit.json'));
if (
  manifest.classes.map((label) => label.id).join() !== split.classes.map((label) => label.id).join()
) {
  throw new Error('Model and split classes differ.');
}
if (
  manifest.datasetFingerprint !== split.datasetFingerprint ||
  audit.fingerprint !== split.datasetFingerprint
) {
  throw new Error('Model, split and audit fingerprints differ.');
}
for (const name of ['train', 'validation', 'test'] as const) {
  if (manifest.sampleCounts[name] !== split[name].length) {
    throw new Error(`${name} sample count differs from the manifest.`);
  }
}
assertNoLeakage(split);

const network = loadNetwork(JSON.parse(modelText) as NetworkJSON);
const ids = manifest.classes.map((label) => label.id);
const predictions = {} as Record<SplitName, ReviewedPrediction[]>;
const summaries = {} as Record<SplitName, ReturnType<typeof predictionDiagnostics>>;
const vectors = new Map<string, { classes: Map<string, number>; count: number }>();
for (const name of ['train', 'validation', 'test'] as const) {
  const samples = await readSamples(
    split,
    name,
    directory,
    manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15',
  );
  const recorded = {
    train: manifest.trainMetrics,
    validation: manifest.validationMetrics,
    test: manifest.testMetrics,
  }[name];
  if (
    JSON.stringify(evaluateNetwork(network, samples, manifest.classes)) !== JSON.stringify(recorded)
  ) {
    throw new Error(`${name} metrics differ from the frozen manifest.`);
  }
  predictions[name] = samples.map((sample) => {
    const key = sha256(Uint8Array.from(sample.input));
    const entry = vectors.get(key) ?? { classes: new Map<string, number>(), count: 0 };
    const classId = ids[sample.classIndex];
    entry.classes.set(classId, (entry.classes.get(classId) ?? 0) + 1);
    entry.count++;
    vectors.set(key, entry);
    return {
      path: sample.path,
      classId,
      predictions: rankPredictions(network.run(sample.input), manifest.classes).map(
        (prediction) => ({ id: prediction.label.id, score: prediction.score }),
      ),
    };
  });
  summaries[name] = predictionDiagnostics(predictions[name], manifest.uncertainty);
}

const colliding = [...vectors.values()].filter((value) => value.classes.size > 1);
const featureVectors = {
  total: [...vectors.values()].reduce((sum, value) => sum + value.count, 0),
  unique: vectors.size,
  crossClassCollisions: colliding.length,
  samplesInCrossClassCollisions: colliding.reduce((sum, value) => sum + value.count, 0),
  note: 'Identical 1024-bit feature vectors with different labels, pooled across train, validation and test. Measures representation ambiguity, not image duplication.',
};
const byF1 = [...manifest.testMetrics.perClass].sort((a, b) => b.f1 - a.f1);
const confusions = {
  test: confusionPairs(manifest.testMetrics.confusionMatrix, ids),
  validation: confusionPairs(manifest.validationMetrics.confusionMatrix, ids),
};
const separability = await optional<{
  perClass: { id: string; peakBin: number; meanLuminance: number; withinClassL1: number }[];
  centroidDistances: { pair: string[]; l1: number }[];
  meanWithinClassL1: number;
  inSampleNearestCentroidAgreement: number;
}>(resolve(output, 'feature-separability.json'));

type Baseline = {
  manifest: {
    version: string;
    classes: unknown[];
    metrics: { accuracy: number; macroF1: number; total: number; confusionMatrix: number[][] };
    validationMetrics: { accuracy: number };
  };
};
const baselineEvaluation = await optional<Baseline>(
  resolve(output, 'previous-food-baseline/model-evaluation.json'),
);
const baselineReview = await optional<{
  summaries: Record<SplitName, { accuracy: number }>;
  featureVectors: {
    crossClassCollisions: number;
    samplesInCrossClassCollisions: number;
    total: number;
  };
}>(resolve(output, 'previous-food-baseline/model-review.json'));
const describe = (
  classes: number,
  test: { accuracy: number; macroF1: number; confusionMatrix: number[][] },
  train: number,
  validation: number,
) => {
  const majority =
    Math.max(...test.confusionMatrix.map((row) => row.reduce((a, b) => a + b, 0))) /
    test.confusionMatrix.flat().reduce((a, b) => a + b, 0);
  const balancedAccuracy =
    test.confusionMatrix.reduce(
      (sum, row, index) => sum + row[index] / row.reduce((a, b) => a + b, 0),
      0,
    ) / classes;
  return {
    classes,
    chanceAccuracy: 1 / classes,
    majorityClassAccuracy: majority,
    testAccuracy: test.accuracy,
    testBalancedAccuracy: balancedAccuracy,
    testMacroF1: test.macroF1,
    testCohenKappa: cohenKappa(test.confusionMatrix),
    accuracyAboveChanceNormalized: (test.accuracy - 1 / classes) / (1 - 1 / classes),
    trainAccuracy: train,
    validationAccuracy: validation,
    trainValidationGap: train - validation,
  };
};
const current = {
  ...describe(
    ids.length,
    manifest.testMetrics,
    summaries.train.accuracy!,
    summaries.validation.accuracy!,
  ),
  crossClassFeatureCollisions: featureVectors.crossClassCollisions,
  samplesInCollisions: featureVectors.samplesInCrossClassCollisions,
  samplesPooled: featureVectors.total,
};
const previous =
  baselineEvaluation && baselineReview
    ? {
        label: 'Previous food-domain baseline (not a current result)',
        modelVersion: baselineEvaluation.manifest.version,
        ...describe(
          baselineEvaluation.manifest.classes.length,
          baselineEvaluation.manifest.metrics,
          baselineReview.summaries.train.accuracy,
          baselineReview.summaries.validation.accuracy,
        ),
        crossClassFeatureCollisions: baselineReview.featureVectors.crossClassCollisions,
        samplesInCollisions: baselineReview.featureVectors.samplesInCrossClassCollisions,
        samplesPooled: baselineReview.featureVectors.total,
      }
    : null;
type SceneRun = {
  modelVersion: string;
  answers: { classes: string[] };
  summaries: Record<SplitName, { accuracy: number }>;
  featureVectors: {
    crossClassCollisions: number;
    samplesInCrossClassCollisions: number;
    total: number;
  };
};
const mountainReview = await optional<SceneRun>(
  resolve(output, 'previous-scene-mountain-2.0.0/model-review.json'),
);
const mountainManifest = await optional<{
  testMetrics: { accuracy: number; macroF1: number; confusionMatrix: number[][] };
}>(resolve(output, 'previous-scene-mountain-2.0.0/manifest-2.0.0.json'));
const previousScene =
  mountainReview && mountainManifest
    ? {
        label:
          'Previous Sea/Forest/Mountain configuration 2.0.0 (replaced after its test evaluation; not a current result)',
        modelVersion: mountainReview.modelVersion,
        classNames: mountainReview.answers.classes,
        ...describe(
          mountainReview.answers.classes.length,
          mountainManifest.testMetrics,
          mountainReview.summaries.train.accuracy,
          mountainReview.summaries.validation.accuracy,
        ),
        crossClassFeatureCollisions: mountainReview.featureVectors.crossClassCollisions,
        samplesInCollisions: mountainReview.featureVectors.samplesInCrossClassCollisions,
        samplesPooled: mountainReview.featureVectors.total,
      }
    : null;
const testEvaluations = await optional<unknown[]>(resolve(directory, 'test-evaluations.json'));

const report = {
  reviewedAt: new Date().toISOString(),
  modelVersion: manifest.version,
  modelSha256: manifest.modelSha256,
  architecture: manifest.network.architecture,
  selectedCandidate: selection.selectedId,
  selectionRule: selection.selectionRule,
  deploymentStatus:
    manifest.modelSha256 === activeManifest.modelSha256
      ? 'active-production'
      : 'unpromoted-candidate',
  activeModel: { version: activeManifest.version, sha256: activeManifest.modelSha256 },
  methodology:
    'Frozen restricted-palette model diagnostics: no training, threshold fitting or export. Recorded metrics must reproduce exactly. Palette eligibility was manually reviewed before training; histogram filtering/balancing use training only. Primary validation/test are palette eligible, without histogram pruning. Full-population test and conditional coverage are in evaluation-scopes.json. Scores are uncalibrated. GeoScene source categories inherit prior Intel/Landscape content.',
  answers: {
    feasibility: {
      exploratorySmallSample: curation.exploratorySmallSample,
      minimumThirtyPerClassPassed: curation.minimumThirtyPerClassPassed,
      paletteTrainCounts: curation.paletteTrainCounts,
      histogramTrainCounts: curation.histogramTrainCounts,
      balancedTrainCounts: curation.balancedTrainCounts,
    },
    classes: manifest.classes.map((label) => label.displayName),
    labeledSamples: {
      ...manifest.sampleCounts,
      total:
        manifest.sampleCounts.train + manifest.sampleCounts.validation + manifest.sampleCounts.test,
      excludedFromSelection: split.excluded.length,
      perClass: split.counts,
      note: 'One representative per exact/pixel/perceptual source-photo group; conflicting-label groups excluded. Fixed seeded 70/15/15 GeoScene partition. All 6545 selected originals manually reviewed; only canonical palettes included. Training-only histogram margin and balance. Holdout palette membership is unchanged by feature filtering. Large crops may evade grouping.',
    },
    trainAccuracy: summaries.train.accuracy,
    validationAccuracy: summaries.validation.accuracy,
    testAccuracy: manifest.testMetrics.accuracy,
    testMacroF1: manifest.testMetrics.macroF1,
    testTop2Accuracy: summaries.test.top2Accuracy,
    strongestClass: byF1[0],
    weakestClass: byF1.at(-1),
    mostCommonConfusions: confusions.test.directed.slice(0, 3),
    confusionPairs: confusions.test.pairs,
    overfitting: {
      trainValidationGap: summaries.train.accuracy! - summaries.validation.accuracy!,
      validationTestGap: summaries.validation.accuracy! - manifest.testMetrics.accuracy,
    },
    classHistograms: separability
      ? {
          peakBins: Object.fromEntries(
            separability.perClass.map((item) => [item.id, item.peakBin]),
          ),
          meanLuminance: Object.fromEntries(
            separability.perClass.map((item) => [item.id, item.meanLuminance]),
          ),
          centroidDistances: separability.centroidDistances,
          meanWithinClassL1: separability.meanWithinClassL1,
          inSampleNearestCentroidAgreement: separability.inSampleNearestCentroidAgreement,
        }
      : 'Run pnpm diagnose:features first.',
    domainComparison: {
      current,
      previousScene,
      previous,
      caveat:
        'Different datasets, image sources, class counts and split protocols; not a controlled experiment. Chance-corrected measures (Cohen kappa, accuracy normalized above chance) are more comparable than raw accuracy across 3 vs 13 classes.',
    },
    testSetUse: {
      frozenModelsScoredOnTest: testEvaluations?.length ?? null,
      note: 'GeoScene group holdouts fixed before training; final inference only after selection freeze. These images are renamed prior Intel/Landscape content and earlier models saw many of them, so old-model comparisons would not be independent. This is a new restricted-palette task, not a fresh-source benchmark.',
    },
  },
  domain: manifest.domain,
  summaries,
  featureVectors,
  confusions,
};
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'model-review.json'), JSON.stringify(report, null, 2));
const csv = (value: string | number | boolean) => `"${String(value).replaceAll('"', '""')}"`;
const errorRows = (['validation', 'test'] as const).flatMap((name) =>
  predictions[name]
    .filter((row) => row.predictions[0].id !== row.classId)
    .map((row) => {
      const uncertain = isUncertain(
        row.predictions.map((item) => ({
          label: manifest.classes.find((label) => label.id === item.id)!,
          score: item.score,
        })),
        manifest.uncertainty,
      );
      return [
        name,
        row.path,
        row.classId,
        row.predictions[0].id,
        row.predictions[0].score,
        row.predictions[1]?.id ?? '',
        row.predictions[1]?.score ?? '',
        uncertain,
      ]
        .map(csv)
        .join(',');
    }),
);
await writeFile(
  resolve(output, 'prediction-errors.csv'),
  [
    'split,path,true_class,predicted_class,top_score,second_class,second_score,shown_as_uncertain',
    ...errorRows,
  ].join('\n') + '\n',
);
await writeFile(
  resolve(output, 'confusion-matrix.csv'),
  [
    `true/predicted (test),${ids.join(',')}`,
    ...manifest.testMetrics.confusionMatrix.map((row, index) => [ids[index], ...row].join(',')),
  ].join('\n') + '\n',
);
await writeFile(
  resolve(output, 'model-evaluation.json'),
  JSON.stringify(
    {
      manifest,
      selection,
      split: {
        seed: split.seed,
        validationPercent: split.validationPercent,
        counts: split.counts,
        excluded: split.excluded,
      },
      audit: auditSummary(audit),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { model: manifest.version, answers: report.answers, featureVectors, output },
    null,
    2,
  ),
);
