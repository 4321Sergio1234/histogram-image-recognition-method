import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateManifest } from '../core/manifest';
import { DATASETS, type DatasetId } from '../core/scenes';
import type { ModelManifest, EvaluationMetrics } from '../core/contracts';
import type { DatasetSplit } from '../dataset/types';
import type { CandidateConfig } from '../model/train';
import { trainingConfig } from '../config/training';

export const brainVersion: string = (
  createRequire(import.meta.url)('brain.js/package.json') as { version: string }
).version;

export interface FrozenSelection {
  selected: {
    config: CandidateConfig;
    architecture: string;
    iterations: number;
    error: number;
    durationMs: number;
    trainMetrics: EvaluationMetrics;
    validationMetrics: EvaluationMetrics;
    modelSha256: string;
  };
  selectionRule: string;
  initializationSeed: number;
  curationSha256?: string;
  splitSha256?: string;
  populationSplitSha256?: string;
  cleanDatasetFingerprint?: string;
  cleanManifestSha256?: string;
}

export function sha256(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function exportModel(
  modelJson: string,
  selection: FrozenSelection,
  split: DatasetSplit,
  testMetrics: EvaluationMetrics,
  directory: string,
  domain?: ModelManifest['domain'],
  options?: {
    version: string;
    split: ModelManifest['split'];
    datasets?: ModelManifest['datasets'];
  },
): Promise<ModelManifest> {
  const { selected } = selection;
  const manifest: ModelManifest = {
    version: options?.version ?? trainingConfig.modelVersion,
    createdAt: new Date().toISOString(),
    task: 'natural-scene-classification',
    algorithm: 'zawyalow-brightness-histogram-v1',
    preprocessingVersion:
      selected.config.normalization === 'sqrt-max15'
        ? 'luma-round-sqrtmax15-msb-v2'
        : 'luma-round-max15-msb-v1',
    featureLength: 1024,
    datasets:
      options?.datasets ??
      [...new Set(split.classes.map((label) => label.source))].map((id) => ({
        id,
        name: DATASETS[id as DatasetId].name,
        url: DATASETS[id as DatasetId].url,
        selectedClasses: split.classes
          .filter((label) => label.source === id)
          .map((label) => label.datasetLabel),
        ignoredClasses: split.ignoredClasses[id] ?? [],
      })),
    datasetFingerprint: split.datasetFingerprint,
    classes: split.classes,
    split: options?.split ?? {
      strategy:
        'GeoSceneNet16K source-photo groups, fixed seeded 70/15/15 partition; manual palette eligibility; training-only 5% histogram margin in H/N and max15 bits; training-only balance; palette validation/test not histogram-pruned',
      seed: split.seed,
      validationPercent: split.validationPercent,
      trainSource: 'GeoSceneNet16K: filtered 70% group partition',
      validationSource: 'GeoSceneNet16K: palette-eligible 15% group partition',
      testSource: 'GeoSceneNet16K: palette-eligible reserved 15% group partition',
    },
    sampleCounts: {
      train: split.train.length,
      validation: split.validation.length,
      test: split.test.length,
    },
    initializationSeed: selection.initializationSeed,
    network: {
      architecture: selected.architecture,
      hiddenLayers: selected.config.hiddenLayers,
      activation: 'sigmoid',
      iterations: selected.iterations,
      learningRate: selected.config.learningRate,
      momentum: selected.config.momentum,
    },
    trainMetrics: selected.trainMetrics,
    validationMetrics: selected.validationMetrics,
    testMetrics,
    uncertainty: trainingConfig.uncertainty,
    modelSha256: sha256(modelJson),
    brainVersion,
    domain,
    provenance: {
      decoderPolicy: 'sharp-opaque-chromium-profile-alpha-v2',
      groupingPolicy: 'D4-pHash-Hamming4-MAE10-correlation985; one image/source-photo group',
      filterRulesSha256: selection.curationSha256,
      holdoutAnchorSha256:
        selection.populationSplitSha256 ??
        sha256(
          await readFile(resolve(trainingConfig.reportDataDirectory, 'population-splits.json')),
        ),
      trainingDurationMs: selected.durationMs,
      trainingError: selected.error,
      alphaBackground: 'white',
      nativeResolution: true,
      selectionRule: selection.selectionRule,
      uncertaintyMeaning:
        'Uncalibrated heuristic fixed before training: uncertain when the top score is below minScore or leads the runner-up by less than minMargin. Does not detect a different palette or unsupported scene.',
    },
  };
  validateManifest(manifest);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'model.json'), modelJson);
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Replaces the web model directory so that only the current model/manifest pair can be served. */
export async function synchronizeModel(source: string, destination: string): Promise<void> {
  const manifest = validateManifest(
    JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8')),
  );
  const model = await readFile(resolve(source, 'model.json'));
  if (sha256(model) !== manifest.modelSha256) {
    throw new Error('The model checksum does not match its manifest.');
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyFile(resolve(source, 'model.json'), resolve(destination, 'model.json'));
  await copyFile(resolve(source, 'manifest.json'), resolve(destination, 'manifest.json'));
  console.log(
    `Synchronized model ${manifest.version} (${manifest.classes.map((label) => label.displayName).join(', ')}) to ${destination}`,
  );
}
