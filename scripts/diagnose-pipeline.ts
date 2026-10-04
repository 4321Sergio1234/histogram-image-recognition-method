import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import sharp from 'sharp';
import { extractFeatures, rankPredictions, validateManifest } from '../brain-js/src/core';
import { decodeImage } from '../brain-js/src/image/decode';
import { imageFile } from '../brain-js/src/dataset/audit';
import { classIndex, readSamples } from '../brain-js/src/dataset/split';
import type { DatasetAudit, DatasetSplit } from '../brain-js/src/dataset/types';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { sha256 } from '../brain-js/src/export/model';
const root = process.cwd();
const out = resolve(root, '../docs/lab2/data/model-diagnostics');
const base = resolve(out, 'baseline-3.0.0');
const audit = JSON.parse(await readFile(resolve(base, 'audit.json'), 'utf8')) as DatasetAudit;
const split = JSON.parse(await readFile(resolve(base, 'splits.json'), 'utf8')) as DatasetSplit;
const manifest = validateManifest(
  JSON.parse(await readFile(resolve(base, 'manifest.json'), 'utf8')),
);
const json = JSON.parse(await readFile(resolve(base, 'model.json'), 'utf8')) as NetworkJSON;
const network = loadNetwork(json);
const samples = await readSamples(split, 'train', base);
const mapping = split.classes.map((label, index) => {
  const position = samples.findIndex(
    (sample) =>
      sample.classIndex === index &&
      rankPredictions(network.run(sample.input), split.classes)[0].label.id === label.id,
  );
  const sample = samples[position];
  return {
    trainingPath: sample.path,
    datasetLabel: split.train[position].label,
    target: sample.output,
    outputIndex: classIndex(split, split.train[position]),
    lookup: json.outputLookup,
    scores: Array.from(network.run(sample.input)),
    domain: rankPredictions(network.run(sample.input), split.classes).map((x) => ({
      id: x.label.id,
      uiLabel: x.label.displayName,
      score: x.score,
    })),
  };
});
const files = [
  resolve('/Users/admin/Downloads/desertSachara.jpg'),
  ...mapping.map((x) =>
    imageFile(
      audit,
      split.train.find((i) => i.path === x.trainingPath)!,
    ),
  ),
];
// Inspect embedded profiles across selected classes without using their predictions.
const iccFiles: string[] = [];
for (const row of audit.images.filter(
  (x) =>
    (x.source === 'intel' && ['sea', 'forest'].includes(x.label ?? '')) ||
    (x.source === 'landscape' && x.label === 'desert'),
)) {
  const file = imageFile(audit, row);
  const metadata = await sharp(file).metadata();
  if (metadata.icc) {
    iccFiles.push(file);
    if (!files.includes(file)) {
      files.push(file);
    }
  }
}
await mkdir(resolve(out, 'fixtures'), { recursive: true });
const rgba = Buffer.alloc(64 * 48 * 4);
for (let y = 0; y < 48; y++) {
  for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    rgba[i] = x * 4;
    rgba[i + 1] = y * 5;
    rgba[i + 2] = (x * 3 + y * 7) % 256;
    rgba[i + 3] = 255;
  }
}
const raw = { width: 64, height: 48, channels: 4 as const };
for (const [name, buffer] of [
  ['srgb.png', await sharp(rgba, { raw }).png().toBuffer()],
  ['display-p3.png', await sharp(rgba, { raw }).withIccProfile('p3').png().toBuffer()],
  [
    'orientation-6.jpg',
    await sharp(rgba, { raw }).withMetadata({ orientation: 6 }).jpeg({ quality: 93 }).toBuffer(),
  ],
  [
    'alpha.png',
    await sharp(Buffer.from(rgba.map((v, i) => (i % 4 === 3 ? (i % 7) * 40 : v))), { raw })
      .png()
      .toBuffer(),
  ],
] as const) {
  const file = resolve(out, 'fixtures', name);
  await writeFile(file, buffer);
  files.push(file);
}
const server = await createServer({
  root: resolve(root, 'react-web-app'),
  configFile: resolve(root, 'react-web-app/vite.config.ts'),
  server: { port: 5183, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5183');
  const comparisons = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const meta = await sharp(bytes).metadata();
    const web = await page.evaluate(
      async ({ bytes, type }) => {
        const { decodeImage, readImagePixels } = (await import(
          '/src/shared/lib/image-input.ts' as string
        )) as typeof import('../react-web-app/src/shared/lib/image-input');
        const image = await decodeImage(
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type }),
        );
        try {
          return {
            width: image.width,
            height: image.height,
            rgba: Array.from(readImagePixels(image)),
          };
        } finally {
          image.close();
        }
      },
      { bytes: bytes.toString('base64'), type: `image/${meta.format}` },
    );
    const node = await decodeImage(file);
    const nf = extractFeatures(node.rgba);
    const wf = extractFeatures(Uint8Array.from(web.rgba));
    const variants = [];
    for (const mode of ['icc-srgb', 'pipeline-srgb'] as const) {
      let decoder = sharp(bytes).rotate();
      decoder =
        mode === 'icc-srgb' ? decoder.withIccProfile('srgb') : decoder.pipelineColourspace('srgb');
      const data = await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer();
      const f = extractFeatures(data);
      variants.push({
        mode,
        differentBits: f.features.filter((x, i) => x !== wf.features[i]).length,
        maxPixelDelta: Math.max(
          ...Array.from(data, (x, i) => Math.abs(x - web.rgba[i])).slice(0, 10000),
        ),
      });
    }
    comparisons.push({
      file,
      sha256: sha256(bytes),
      icc: meta.icc?.length ?? 0,
      orientation: meta.orientation ?? 1,
      nodeDimensions: [node.width, node.height],
      browserDimensions: [web.width, web.height],
      differentPixels: node.rgba.filter((x, i) => x !== web.rgba[i]).length,
      differentBits: nf.features.filter((x, i) => x !== wf.features[i]).length,
      nodeScores: Array.from(network.run(nf.features)),
      browserScores: Array.from(network.run(wf.features)),
      variants,
      ...(file === files[0]
        ? { histogram: wf.histogram, quantized: wf.quantized, features: wf.features }
        : {}),
    });
  }
  if (
    process.env.DIAGNOSTIC_PHASE !== 'baseline' &&
    comparisons.some(
      (row) => row.differentBits || row.nodeDimensions.join() !== row.browserDimensions.join(),
    )
  ) {
    throw new Error('Node/browser preprocessing regression.');
  }
  await writeFile(
    resolve(out, `pipeline-${process.env.DIAGNOSTIC_PHASE ?? 'corrected'}.json`),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        modelVersion: manifest.version,
        hash: manifest.modelSha256,
        outputOrder: manifest.classes.map((x) => x.id),
        mapping,
        iccFiles,
        comparisons,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        mapping,
        comparisons: comparisons.map(({ histogram: _h, quantized: _q, features: _f, ...r }) => r),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
