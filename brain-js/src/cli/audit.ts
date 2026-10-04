import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditDataset, auditSummary } from '../dataset/audit';
import { datasetPaths, trainingConfig } from '../config/training';
const audit = await auditDataset(datasetPaths(), trainingConfig.artifactsDirectory);
await mkdir(trainingConfig.reportDataDirectory, { recursive: true });
await writeFile(
  resolve(trainingConfig.reportDataDirectory, 'dataset-audit.json'),
  JSON.stringify(auditSummary(audit), null, 2),
);
console.log(
  `Audit summary written to ${resolve(trainingConfig.reportDataDirectory, 'dataset-audit.json')}`,
);
