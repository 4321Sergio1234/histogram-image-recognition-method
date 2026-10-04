import type { ModelManifest } from './contracts';
import { GEOSCENE_CATALOG, SCENE_CATALOG } from './scenes';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function texts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}
function count(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
function ratio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function metrics(value: unknown, classes: number): boolean {
  if (!record(value) || !ratio(value.accuracy) || !ratio(value.macroF1) || !count(value.total)) {
    return false;
  }
  if (
    !Array.isArray(value.confusionMatrix) ||
    value.confusionMatrix.length !== classes ||
    value.confusionMatrix.some(
      (row) => !Array.isArray(row) || row.length !== classes || row.some((v) => !count(v)),
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(value.perClass) ||
    value.perClass.length !== classes ||
    value.perClass.some(
      (item) =>
        !record(item) ||
        !text(item.id) ||
        !count(item.count) ||
        !ratio(item.precision) ||
        !ratio(item.recall) ||
        !ratio(item.f1),
    )
  ) {
    return false;
  }
  return (
    value.confusionMatrix.flat().reduce((sum: number, item: number) => sum + item, 0) ===
    value.total
  );
}

/** Rejects incompatible, stale or malformed artifacts before loading the network. */
export function validateManifest(value: unknown): ModelManifest {
  if (!record(value) || value.task !== 'natural-scene-classification') {
    throw new Error(
      'This model was built for a different recognition task. Reload to update the local model.',
    );
  }
  if (
    value.algorithm !== 'zawyalow-brightness-histogram-v1' ||
    !['luma-round-max15-msb-v1', 'luma-round-sqrtmax15-msb-v2'].includes(
      String(value.preprocessingVersion),
    ) ||
    value.featureLength !== 1024
  ) {
    throw new Error('This model uses an unsupported preprocessing format.');
  }
  if (
    !text(value.version) ||
    !text(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !text(value.brainVersion) ||
    !text(value.modelSha256) ||
    !/^[a-f0-9]{64}$/.test(value.modelSha256)
  ) {
    throw new Error('The model manifest metadata is invalid.');
  }
  if (
    !text(value.datasetFingerprint) ||
    !Array.isArray(value.datasets) ||
    !value.datasets.length ||
    value.datasets.some(
      (item) =>
        !record(item) ||
        !text(item.id) ||
        !text(item.name) ||
        !text(item.url) ||
        !texts(item.selectedClasses) ||
        !texts(item.ignoredClasses),
    )
  ) {
    throw new Error('The model dataset metadata is invalid.');
  }
  const datasets = value.datasets as {
    id: string;
    selectedClasses: string[];
    ignoredClasses: string[];
  }[];
  const profile =
    datasets.length === 1 && datasets[0].id === 'geoscene' ? GEOSCENE_CATALOG : SCENE_CATALOG;
  const known = new Map(profile.map((scene) => [scene.id, scene]));
  if (
    !Array.isArray(value.classes) ||
    !value.classes.length ||
    value.classes.some(
      (item) =>
        !record(item) ||
        !text(item.id) ||
        !known.has(item.id) ||
        !text(item.displayName) ||
        !text(item.source) ||
        !text(item.datasetLabel) ||
        item.displayName !== known.get(item.id)?.displayName ||
        item.source !== known.get(item.id)?.source ||
        item.datasetLabel !== known.get(item.id)?.datasetLabel,
    )
  ) {
    throw new Error('The model class catalog is invalid.');
  }
  const classes = value.classes as { id: string; source: string; datasetLabel: string }[];
  if (new Set(classes.map((item) => item.id)).size !== classes.length) {
    throw new Error('The model class catalog contains duplicate identifiers.');
  }
  if (
    classes.length !== SCENE_CATALOG.length ||
    classes.some((item, index) => item.id !== SCENE_CATALOG[index].id)
  ) {
    throw new Error('The model class catalog output order is incompatible.');
  }
  const curated = record(value.domain) && value.domain.id === 'curated-histogram-v2';
  const sourceLabels: Record<string, string[]> = {
    geoscene: ['sea or ocean', 'forest area', 'desert'],
    intel: ['sea', 'forest'],
    landscape: ['coast', 'forest', 'desert'],
  };
  const consistent =
    classes.every((item) =>
      datasets.some(
        (dataset) =>
          dataset.id === item.source &&
          dataset.selectedClasses.includes(item.datasetLabel) &&
          !dataset.ignoredClasses.includes(item.datasetLabel),
      ),
    ) &&
    datasets.every((dataset) =>
      dataset.selectedClasses.every((label) =>
        curated
          ? sourceLabels[dataset.id]?.includes(label) && !dataset.ignoredClasses.includes(label)
          : classes.some((item) => item.source === dataset.id && item.datasetLabel === label),
      ),
    );
  if (!consistent) {
    throw new Error('The model class catalog does not match its dataset selection.');
  }
  const split = value.split;
  if (
    !record(split) ||
    !text(split.strategy) ||
    !count(split.seed) ||
    !count(split.validationPercent) ||
    split.validationPercent === 0 ||
    split.validationPercent >= 100 ||
    !text(split.trainSource) ||
    !text(split.validationSource) ||
    !text(split.testSource)
  ) {
    throw new Error('The model split metadata is invalid.');
  }
  if (
    !record(value.sampleCounts) ||
    !count(value.sampleCounts.train) ||
    !count(value.sampleCounts.validation) ||
    !count(value.sampleCounts.test) ||
    !count(value.initializationSeed)
  ) {
    throw new Error('The model training metadata is invalid.');
  }
  if (
    !record(value.uncertainty) ||
    !ratio(value.uncertainty.minScore) ||
    !ratio(value.uncertainty.minMargin)
  ) {
    throw new Error('The model uncertainty rule is invalid.');
  }
  const network = value.network;
  if (
    !record(network) ||
    network.activation !== 'sigmoid' ||
    !text(network.architecture) ||
    !Array.isArray(network.hiddenLayers) ||
    network.hiddenLayers.some((layer) => !count(layer) || layer === 0) ||
    !count(network.iterations) ||
    !ratio(network.learningRate) ||
    network.learningRate === 0 ||
    !ratio(network.momentum)
  ) {
    throw new Error('The network configuration is invalid.');
  }
  if (
    !metrics(value.trainMetrics, classes.length) ||
    !metrics(value.validationMetrics, classes.length) ||
    !metrics(value.testMetrics, classes.length)
  ) {
    throw new Error('The evaluation metadata is invalid.');
  }
  for (const evaluation of [value.trainMetrics, value.validationMetrics, value.testMetrics] as {
    perClass: { id: string }[];
  }[]) {
    if (evaluation.perClass.some((item, index) => item.id !== classes[index].id)) {
      throw new Error('Evaluation class order differs from model outputs.');
    }
  }
  if (datasets[0].id === 'geoscene' || curated) {
    const domain = value.domain;
    if (
      !record(domain) ||
      ![
        'geoscene-canonical-palette-v1',
        'geoscene-strict-histogram-v1',
        'curated-histogram-v2',
      ].includes(String(domain.id)) ||
      !text(domain.description) ||
      !text(domain.sourceCaveat) ||
      !ratio(domain.paletteTestCoverage) ||
      (domain.id === 'geoscene-canonical-palette-v1' &&
        !metrics(domain.populationTestMetrics, classes.length)) ||
      (domain.populationTestMetrics !== undefined &&
        !metrics(domain.populationTestMetrics, classes.length)) ||
      (domain.id !== 'geoscene-canonical-palette-v1' &&
        (!count(domain.testPopulationCount) ||
          domain.testPopulationCount === 0 ||
          !text(domain.cleanDatasetFingerprint) ||
          domain.cleanDatasetFingerprint !== value.datasetFingerprint)) ||
      !Array.isArray(domain.palettes) ||
      domain.palettes.length !== classes.length ||
      domain.palettes.some(
        (item, index) => !record(item) || item.id !== classes[index].id || !text(item.description),
      )
    ) {
      throw new Error(
        'The restricted-palette model must declare its domain and full-population test coverage.',
      );
    }
  }
  return value as unknown as ModelManifest;
}
