import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../config/clean-training';
import { loadCleanDataset, readCleanHistograms, cleanSamples } from '../dataset/clean';
import { sha256, exportModel, type FrozenSelection } from '../export/model';
import { loadNetwork, type NetworkJSON } from '../model/network';
import { evaluateNetwork } from '../evaluation/metrics';
import { validateManifest, type ModelManifest } from '../core';

const dataset = await loadCleanDataset();
const selection = JSON.parse(
  await readFile(resolve(config.artifactsDirectory, 'selection.json'), 'utf8'),
) as FrozenSelection;
const bytes = await readFile(resolve(config.artifactsDirectory, 'selected-model.json'), 'utf8');
if (
  selection.cleanManifestSha256 !== dataset.manifestSha256 ||
  selection.cleanDatasetFingerprint !== dataset.manifest.fingerprint ||
  selection.splitSha256 !== sha256(JSON.stringify(dataset.split))
) {
  throw new Error('Clean dataset changed after selection.');
}
if (sha256(bytes) !== selection.selected.modelSha256) {
  throw new Error('Frozen weights changed.');
}
const samples = cleanSamples(
  await readCleanHistograms(dataset, 'test'),
  selection.selected.config.normalization ?? 'max15',
);
const metrics = evaluateNetwork(
  loadNetwork(JSON.parse(bytes) as NetworkJSON),
  samples,
  dataset.split.classes,
);
const domain: ModelManifest['domain'] = {
  id: 'geoscene-strict-histogram-v1',
  description:
    'Blue/cyan sea, green forest and warm sandy desert with clearly separated brightness histograms. Similar or unusual brightness patterns can be misclassified, even when their colors look typical.',
  palettes: [
    { id: 'sea', description: 'Blue/cyan sea with a distinct brightness pattern' },
    { id: 'forest', description: 'Green forest with a distinct brightness pattern' },
    { id: 'desert', description: 'Warm sandy desert with a distinct brightness pattern' },
  ],
  paletteTestCoverage: samples.length / dataset.manifest.sourcePopulationCounts.test,
  testPopulationCount: dataset.manifest.sourcePopulationCounts.test,
  cleanDatasetFingerprint: dataset.manifest.fingerprint,
  sourceCaveat:
    'Only the strictly cleaned domain is evaluated. Test eligibility uses known labels and training-only histogram centroids; it is not an automatic unknown-scene detector. The same source photos were inspected in earlier experiments. Sea/Forest inherit Intel content and Desert inherits Landscape content.',
};
const scopes = {
  modelSha256: selection.selected.modelSha256,
  cleanDatasetFingerprint: dataset.manifest.fingerprint,
  cleanManifestSha256: dataset.manifestSha256,
  evaluationScope:
    'Physical clean dataset/test only; same own-class histogram eligibility as train and validation.',
  test: metrics,
  counts: dataset.manifest.counts,
  coverageOfOriginalGroupTest: domain.paletteTestCoverage,
  originalGroupTestCount: dataset.manifest.sourcePopulationCounts.test,
  caveat:
    'Conditional, previously inspected test population. Small per-class counts must accompany accuracy. No unfiltered images are included in this primary test.',
};
await mkdir(config.reportDataDirectory, { recursive: true });
const manifestFile = resolve(config.artifactsDirectory, 'manifest.json'),
  scopesFile = resolve(config.reportDataDirectory, 'evaluation.json');
const existing = await readFile(manifestFile, 'utf8')
  .then((text) => validateManifest(JSON.parse(text)))
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
if (existing?.modelSha256 === selection.selected.modelSha256) {
  if (
    JSON.stringify(existing.testMetrics) !== JSON.stringify(metrics) ||
    JSON.stringify(JSON.parse(await readFile(scopesFile, 'utf8'))) !== JSON.stringify(scopes)
  ) {
    throw new Error('Clean evaluation reproduction mismatch.');
  }
  console.log('Existing frozen clean-model evaluation reproduced exactly.');
} else {
  const manifest = await exportModel(
    bytes,
    selection,
    dataset.split,
    metrics,
    config.artifactsDirectory,
    domain,
    {
      version: config.modelVersion,
      split: {
        strategy:
          'Preserved GeoScene source-photo group70/15/15 partition; identical manual and own-class5% margin in H/N and max15 bits for ALL splits; train-only balance; physical copied images',
        seed: dataset.manifest.seed,
        validationPercent: 15,
        trainSource: 'brain-js/data/geoscene-clean-v1/train',
        validationSource: 'brain-js/data/geoscene-clean-v1/validation',
        testSource: 'brain-js/data/geoscene-clean-v1/test',
      },
    },
  );
  await writeFile(scopesFile, JSON.stringify(scopes, null, 2));
  for (const [file, content] of [
    ['manifest.json', JSON.stringify(manifest, null, 2)],
    ['model.json', bytes],
  ] as const) {
    await writeFile(resolve(config.reportDataDirectory, file), content);
  }
  const journalFile = resolve(config.artifactsDirectory, 'test-evaluations.json');
  const journal: unknown[] = await readFile(journalFile, 'utf8')
    .then((text) => JSON.parse(text) as unknown[])
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    });
  journal.push({
    evaluatedAt: manifest.createdAt,
    modelSha256: manifest.modelSha256,
    cleanDatasetFingerprint: dataset.manifest.fingerprint,
    metrics,
  });
  await writeFile(journalFile, JSON.stringify(journal, null, 2));
  await writeFile(
    resolve(config.reportDataDirectory, 'test-evaluations.json'),
    JSON.stringify(journal, null, 2),
  );
}
console.log(JSON.stringify(scopes, null, 2));
