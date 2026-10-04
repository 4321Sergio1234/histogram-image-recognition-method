import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from '../brain-js/src/export/model';
import { workspaceRoot } from '../brain-js/src/config/training';
import { loadCuratedDataset, readCuratedSamples } from '../brain-js/src/dataset/curated';
import { OperationLog } from '../brain-js/src/cli/progress';
import { validateManifest, rankPredictions } from '../brain-js/src/core';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
const url = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4176';
const local = await readFile('react-web-app/public/models/scene-recognition/model.json');
const expected = validateManifest(
  JSON.parse(await readFile('react-web-app/public/models/scene-recognition/manifest.json', 'utf8')),
);
const reportConfig = {
  reportDataDirectory: resolve(workspaceRoot, '../docs/lab2/data/curated-v2'),
  reportFigureDirectory: resolve(workspaceRoot, '../docs/lab1/figures'),
};
const dataset = await loadCuratedDataset(resolve(workspaceRoot, 'brain-js/data/scenes-curated-v2'));
if (dataset.manifest.fingerprint !== expected.datasetFingerprint) {
  throw new Error('Active model dataset mismatch.');
}
const normalization =
  expected.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15';
const samples = await readCuratedSamples(
  dataset,
  'train',
  normalization,
  new OperationLog(resolve(reportConfig.reportDataDirectory, 'production-operations.jsonl'), true),
);
const sampleFile = (path: string) => resolve(dataset.root, path);
const network = loadNetwork(JSON.parse(local.toString()) as NetworkJSON);
const checked = samples.map((sample) => ({
  ...sample,
  scores: Array.from(network.run(sample.input)),
}));
const examples = expected.classes.map((label, index) => {
  const sample = checked
    .filter(
      (sample) =>
        sample.classIndex === index &&
        rankPredictions(sample.scores, expected.classes)[0].label.id === label.id,
    )
    .sort((a, b) => b.scores[index] - a.scores[index])[0];
  if (!sample) {
    throw new Error(`No correctly recognized training mapping example for ${label.id}`);
  }
  return { ...sample, label };
});
await mkdir(reportConfig.reportFigureDirectory, { recursive: true });
await mkdir(reportConfig.reportDataDirectory, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(url);
  await page.getByText('Local model ready', { exact: true }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }),
      );
    }
  });
  const snapshot = () =>
    page.evaluate(async () => {
      const bytes = await (await fetch('/models/scene-recognition/model.json')).arrayBuffer(),
        hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
      const manifest = await (await fetch('/models/scene-recognition/manifest.json')).json();
      const entries = [];
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          if (request.url.includes('/models/')) {
            entries.push({ cache: name, key: request.url });
          }
        }
      }
      return {
        manifest,
        hash,
        serviceWorker: navigator.serviceWorker.controller?.scriptURL,
        entries,
      };
    });
  const online = await snapshot(),
    uiMapping = [];
  for (const example of examples) {
    if (await page.getByTestId('recognition-result').count()) {
      await page.getByRole('button', { name: 'Analyze another image', exact: true }).click();
    }
    await page.getByLabel('Choose an image file').setInputFiles(sampleFile(example.path));
    await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
    const result = page.getByTestId('recognition-result');
    await result.waitFor();
    const label = await result.getByRole('heading', { level: 2 }).innerText();
    expect(label).toBe(example.label.displayName);
    await page.getByRole('button', { name: 'Analysis details', exact: true }).click();
    const outputs = await page.locator('.scene-outputs').innerText();
    await expect(page.getByRole('dialog')).toContainText(expected.modelSha256);
    uiMapping.push({
      path: example.path,
      trainingLabel: example.label.id,
      target: example.output,
      serializedOutputIndex: example.classIndex,
      nodeScores: example.scores,
      actualUiLabel: label,
      outputs,
    });
    await page.screenshot({
      path: resolve(
        reportConfig.reportFigureDirectory,
        `production-${example.label.id}-details.png`,
      ),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Close dialog' }).click();
  }
  await context.setOffline(true);
  await page.reload();
  await page.getByText('Local model ready', { exact: true }).waitFor();
  const offline = await snapshot();
  await page.getByLabel('Choose an image file').setInputFiles(sampleFile(examples[0].path));
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await page.getByTestId('recognition-result').waitFor();
  await expect(
    page.getByTestId('recognition-result').getByRole('heading', { level: 2 }),
  ).toHaveText(examples[0].label.displayName);
  if (
    online.hash !== sha256(local) ||
    offline.hash !== expected.modelSha256 ||
    online.manifest.version !== expected.version ||
    offline.manifest.version !== expected.version
  ) {
    throw new Error('Production model mismatch');
  }
  await writeFile(
    resolve(reportConfig.reportDataDirectory, 'production-verification.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        url,
        expectedVersion: expected.version,
        expectedSha256: expected.modelSha256,
        online,
        offline,
        uiMapping,
        offlineRecognition: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        version: expected.version,
        hash: online.hash,
        offlineHash: offline.hash,
        uiMapping,
        offlineRecognition: true,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
