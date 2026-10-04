import { trainingConfig } from '../config/training';
import { synchronizeModel } from '../export/model';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const decision = await readFile(
  resolve(trainingConfig.reportDataDirectory, 'deployment-decision.json'),
  'utf8',
)
  .then((text) => JSON.parse(text) as { candidateSha256: string; decision: string; reason: string })
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
const manifest = JSON.parse(
  await readFile(resolve(trainingConfig.artifactsDirectory, 'manifest.json'), 'utf8'),
) as { modelSha256: string };
if (decision?.candidateSha256 === manifest.modelSha256 && decision.decision === 'retain-baseline') {
  throw new Error(`This candidate was not accepted for production: ${decision.reason}`);
}
await synchronizeModel(trainingConfig.artifactsDirectory, trainingConfig.exportDirectory);
