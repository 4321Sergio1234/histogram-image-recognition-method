import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanTrainingConfig as config } from '../config/clean-training';
import { loadCleanDataset } from '../dataset/clean';
import { validateManifest } from '../core';
import { synchronizeModel } from '../export/model';
const dataset = await loadCleanDataset();
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(config.artifactsDirectory, 'manifest.json'), 'utf8')),
);
if (
  manifest.datasetFingerprint !== dataset.manifest.fingerprint ||
  manifest.domain?.id !== 'geoscene-strict-histogram-v1'
) {
  throw new Error('Only the evaluated clean dataset model can be synchronized by this command.');
}
const decision = await readFile(
  resolve(config.reportDataDirectory, 'deployment-decision.json'),
  'utf8',
)
  .then((text) => JSON.parse(text) as { candidateSha256: string; decision: string; reason: string })
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
if (decision?.candidateSha256 === manifest.modelSha256 && decision.decision === 'retain-baseline') {
  throw new Error(`This candidate was not accepted for production: ${decision.reason}`);
}
await synchronizeModel(config.artifactsDirectory, config.exportDirectory);
