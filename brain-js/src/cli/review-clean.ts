import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../config/clean-training';
import { loadCleanDataset, readCleanHistograms, cleanSamples } from '../dataset/clean';
import { loadNetwork, type NetworkJSON } from '../model/network';
import { rankPredictions, validateManifest } from '../core';
import { evaluateNetwork } from '../evaluation/metrics';
import { sha256 } from '../export/model';

const dataset = await loadCleanDataset();
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(config.artifactsDirectory, 'manifest.json'), 'utf8')),
);
const bytes = await readFile(resolve(config.artifactsDirectory, 'model.json'));
if (
  sha256(bytes) !== manifest.modelSha256 ||
  manifest.datasetFingerprint !== dataset.manifest.fingerprint
) {
  throw new Error('Model/dataset mismatch.');
}
const network = loadNetwork(JSON.parse(bytes.toString()) as NetworkJSON);
const errors = [],
  phases = [];
for (const phase of ['train', 'validation', 'test'] as const) {
  const samples = cleanSamples(
    await readCleanHistograms(dataset, phase),
    manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15',
  );
  const metrics = evaluateNetwork(network, samples, manifest.classes);
  if (JSON.stringify(metrics) !== JSON.stringify(manifest[`${phase}Metrics`])) {
    throw new Error(`${phase} metrics mismatch.`);
  }
  phases.push({ phase, metrics });
  for (const sample of samples) {
    const predictions = rankPredictions(network.run(sample.input), manifest.classes);
    if (predictions[0].label.id !== manifest.classes[sample.classIndex].id) {
      errors.push({
        phase,
        path: sample.path,
        truth: manifest.classes[sample.classIndex].id,
        predicted: predictions[0].label.id,
        score: predictions[0].score,
      });
    }
  }
}
const active = validateManifest(
  JSON.parse(await readFile(resolve(config.exportDirectory, 'manifest.json'), 'utf8')),
);
const report = {
  reviewedAt: new Date().toISOString(),
  modelVersion: manifest.version,
  modelSha256: manifest.modelSha256,
  datasetRoot: dataset.root,
  datasetFingerprint: dataset.manifest.fingerprint,
  deploymentStatus:
    active.modelSha256 === manifest.modelSha256 ? 'active-production' : 'trained-not-synchronized',
  activeModelVersion: active.version,
  activeModelSha256: active.modelSha256,
  counts: dataset.manifest.counts,
  sameEligibilityAllSplits: true,
  copiedImagesVerified: dataset.manifest.files.length,
  imageSourceDuringTrainingAndEvaluation:
    'Physical copied files only; old source feature cache is not read.',
  phases,
  errors,
  domain: manifest.domain,
  limitations: dataset.manifest.provenance,
};
await writeFile(
  resolve(config.reportDataDirectory, 'model-review.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, errors: `${errors.length} errors recorded` }, null, 2));
