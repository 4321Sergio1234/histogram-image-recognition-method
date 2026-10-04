import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import {
  encodeFourBits,
  quantizeHistogram,
  rankPredictions,
  validateManifest,
} from '../brain-js/src/core';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { trainingConfig } from '../brain-js/src/config/training';
import { imageFile } from '../brain-js/src/dataset/audit';
import type { DatasetAudit, DatasetSplit } from '../brain-js/src/dataset/types';

/** Compares browser (Chromium canvas) decoding with the Node/Sharp training cache on validation images only. */
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = trainingConfig.artifactsDirectory;
const candidate = process.argv.includes('--candidate');
const modelDirectory = candidate
  ? artifacts
  : path.join(root, 'react-web-app/public/models/scene-recognition');
const split = JSON.parse(
  await readFile(path.join(artifacts, 'splits.json'), 'utf8'),
) as DatasetSplit;
const audit = JSON.parse(
  await readFile(path.join(artifacts, 'audit.json'), 'utf8'),
) as DatasetAudit;
const manifest = validateManifest(
  JSON.parse(await readFile(path.join(modelDirectory, 'manifest.json'), 'utf8')),
);
const network = loadNetwork(
  JSON.parse(await readFile(path.join(modelDirectory, 'model.json'), 'utf8')) as NetworkJSON,
);
const squareRoot = manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2';
const cache = await readFile(path.join(artifacts, squareRoot ? 'histograms.bin' : 'features.bin'));
const images = [...split.validation].sort((a, b) => a.path.localeCompare(b.path, 'en'));
const server = await createServer({
  root: path.join(root, 'react-web-app'),
  configFile: path.join(root, 'react-web-app/vite.config.ts'),
  server: { port: 5182, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  if (candidate) {
    await page.route('**/models/scene-recognition/*.json', (route) =>
      route.fulfill({
        path: path.join(modelDirectory, new URL(route.request().url()).pathname.split('/').at(-1)!),
        contentType: 'application/json',
      }),
    );
  }
  const harness = await server.transformIndexHtml(
    '/__parity',
    '<!doctype html><html><head><title>Horizon parity</title></head><body>Parity harness</body></html>',
  );
  await page.route('**/__parity', (route) =>
    route.fulfill({ contentType: 'text/html', body: harness }),
  );
  await page.route('**/__input/**', (route) =>
    route.fulfill({
      path: imageFile(audit, images[Number(route.request().url().split('/').at(-1))]),
      contentType: 'image/jpeg',
    }),
  );
  await page.goto('http://127.0.0.1:5182/__parity');
  const browserResults = await page.evaluate(async (count) => {
    const { LocalBrainSceneRecognitionService } = (await import(
      '/src/entities/recognition-result/index.ts' as string
    )) as typeof import('../react-web-app/src/entities/recognition-result');
    const { prepareImage } = (await import(
      '/src/entities/image-analysis/index.ts' as string
    )) as typeof import('../react-web-app/src/entities/image-analysis');
    const service = new LocalBrainSceneRecognitionService({ preferWorker: false });
    const results: { quantized: number[]; top: string; scores: number[] }[] = [];
    for (let index = 0; index < count; index++) {
      const blob = await (await fetch(`/__input/${index}`)).blob();
      const image = await prepareImage(new File([blob], `${index}.jpg`, { type: 'image/jpeg' }));
      try {
        const result = await service.recognize(image);
        results.push({
          quantized: result.quantized,
          top: result.prediction.label.id,
          scores: result.model.classes.map(
            (label) => result.predictions.find((item) => item.label.id === label.id)!.score,
          ),
        });
      } finally {
        image.dispose();
      }
    }
    service.dispose();
    return results;
  }, images.length);
  let identical = 0;
  let hamming = 0;
  let maxHamming = 0;
  let sameTop = 0;
  let maxScoreDifference = 0;
  const differences: { path: string; bits: number; nodeTop: string; browserTop: string }[] = [];
  images.forEach((image, index) => {
    const node = squareRoot
      ? encodeFourBits(
          quantizeHistogram(
            Array.from({ length: 256 }, (_, bin) =>
              cache.readUInt32LE(image.featureIndex * 1024 + bin * 4),
            ),
            'sqrt-max15',
          ),
        )
      : Array.from(cache.subarray(image.featureIndex * 1024, image.featureIndex * 1024 + 1024));
    const web = encodeFourBits(browserResults[index].quantized);
    const bits = node.reduce((sum, bit, position) => sum + (bit !== web[position] ? 1 : 0), 0);
    const nodeScores = Array.from(network.run(node));
    const nodeTop = rankPredictions(nodeScores, manifest.classes)[0].label.id;
    if (!bits) {
      identical++;
    }
    hamming += bits;
    maxHamming = Math.max(maxHamming, bits);
    if (nodeTop === browserResults[index].top) {
      sameTop++;
    }
    maxScoreDifference = Math.max(
      maxScoreDifference,
      ...nodeScores.map((score, position) =>
        Math.abs(score - browserResults[index].scores[position]),
      ),
    );
    if (bits) {
      differences.push({ path: image.path, bits, nodeTop, browserTop: browserResults[index].top });
    }
  });
  const report = {
    measuredAt: new Date().toISOString(),
    browser: `Chromium ${browser.version()}`,
    modelVersion: manifest.version,
    modelSha256: manifest.modelSha256,
    status: candidate ? 'unpromoted-candidate' : 'active-production',
    scope:
      'All manually palette-eligible GeoSceneNet16K validation representatives; no histogram pruning or test inputs.',
    images: images.length,
    identicalFeatureVectors: identical,
    meanDifferingBits: hamming / images.length,
    maxDifferingBits: maxHamming,
    sameTopPrediction: sameTop,
    maxAbsoluteScoreDifference: maxScoreDifference,
    note: 'Node features: Sharp/libvips decode → shared extractFeatures (training cache). Browser features: createImageBitmap/canvas decode → the same shared functions. Opaque unprofiled images use Sharp; profiled/alpha images use the pinned Chromium canvas decoder in Node. Any recorded difference is a regression, not an accepted discrepancy.',
    perSource: Object.fromEntries(
      [...new Set(images.map((image) => image.source))].map((source) => [
        source,
        {
          images: images.filter((image) => image.source === source).length,
          identical: images.filter(
            (image) =>
              image.source === source && !differences.some((item) => item.path === image.path),
          ).length,
        },
      ]),
    ),
    examples: differences.sort((a, b) => b.bits - a.bits).slice(0, 20),
  };
  await writeFile(
    path.resolve(
      trainingConfig.reportDataDirectory,
      candidate ? 'candidate-preprocessing-parity.json' : 'preprocessing-parity.json',
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, examples: report.examples.slice(0, 5) }, null, 2));
  if (identical !== images.length || sameTop !== images.length || maxScoreDifference > 1e-7) {
    throw new Error('Preprocessing or model parity regression.');
  }
} finally {
  await browser.close();
  await server.close();
}
