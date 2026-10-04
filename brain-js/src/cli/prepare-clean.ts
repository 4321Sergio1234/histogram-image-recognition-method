import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareCleanDataset } from '../dataset/clean';
import { cleanTrainingConfig as config } from '../config/clean-training';
const dataset = await prepareCleanDataset();
await mkdir(config.reportDataDirectory, { recursive: true });
await writeFile(
  resolve(config.reportDataDirectory, 'dataset-manifest.json'),
  JSON.stringify(dataset.manifest, null, 2),
);
console.log(
  JSON.stringify(
    {
      root: dataset.root,
      fingerprint: dataset.manifest.fingerprint,
      counts: dataset.manifest.counts,
      excludedOriginals: dataset.manifest.exclusions.length,
      sameEligibilityEverySplit: true,
    },
    null,
    2,
  ),
);
