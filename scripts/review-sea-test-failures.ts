import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import sharp from 'sharp';
import { trainingConfig } from '../brain-js/src/config/training';
import {
  encodeFourBits,
  quantizeHistogram,
  rankPredictions,
  validateManifest,
} from '../brain-js/src/core';
import { imageFile } from '../brain-js/src/dataset/audit';
import { classIndex } from '../brain-js/src/dataset/split';
import { histogramAdmission, type PaletteCentroids } from '../brain-js/src/dataset/palette';
import type { DatasetAudit, DatasetSplit, AuditedImage } from '../brain-js/src/dataset/types';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { metricsFromConfusion } from '../brain-js/src/evaluation/metrics';
import { sha256 } from '../brain-js/src/export/model';
import { escapeXml } from './lib/diagnostic-images';

// Post-test inspection only. Frozen weights, centroids, decisions and splits are never modified.
const directory = trainingConfig.artifactsDirectory;
const output = resolve(trainingConfig.reportDataDirectory, 'sea-test-error-review');
const figures = resolve(trainingConfig.reportFigureDirectory, 'sea-test-error-review');
await mkdir(output, { recursive: true });
await mkdir(figures, { recursive: true });
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const manifest = validateManifest(await json(resolve(directory, 'manifest.json')));
const modelBytes = await readFile(resolve(directory, 'model.json'));
if (sha256(modelBytes) !== manifest.modelSha256) {
  throw new Error('Model checksum mismatch.');
}
const network = loadNetwork(JSON.parse(modelBytes.toString()) as NetworkJSON);
const normalization =
  manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15';
const audit = await json<DatasetAudit>(resolve(directory, 'audit.json'));
const splitBytes = await readFile(resolve(directory, 'splits.json'));
const split = JSON.parse(splitBytes.toString()) as DatasetSplit;
const curationBytes = await readFile(resolve(trainingConfig.reportDataDirectory, 'curation.json'));
const curation = JSON.parse(curationBytes.toString()) as { centroids: PaletteCentroids };
const selection = await json<{ curationSha256: string; splitSha256: string }>(
  resolve(directory, 'selection.json'),
);
if (
  sha256(splitBytes) !== selection.splitSha256 ||
  sha256(curationBytes) !== selection.curationSha256
) {
  throw new Error('Frozen data checksum mismatch.');
}
const cache = await readFile(resolve(directory, 'histograms.bin'));
const ledger = await json<{
  images: { id: number; path: string; decision: string; reason: string }[];
}>(resolve(trainingConfig.reportDataDirectory, 'manual-review/sea-decisions.json'));
const inspect = (image: AuditedImage) => {
  const histogram = Array.from({ length: 256 }, (_, bin) =>
    cache.readUInt32LE(image.featureIndex * 1024 + bin * 4),
  );
  const count = histogram.reduce((a, b) => a + b, 0),
    share = histogram.map((n) => n / count);
  const vector = { share, bits: encodeFourBits(quantizeHistogram(histogram, 'max15')) };
  const admission = histogramAdmission(vector, curation.centroids);
  const truthIndex = classIndex(split, image),
    truth = split.classes[truthIndex].id;
  const predictions = rankPredictions(
    network.run(encodeFourBits(quantizeHistogram(histogram, normalization))),
    manifest.classes,
  ).map((item) => ({ id: item.label.id, score: item.score }));
  const ratio = (distances: number[]) =>
    distances[truthIndex] / Math.min(...distances.filter((_, i) => i !== truthIndex));
  const decision = ledger.images.find((row) => row.path === image.path);
  return {
    path: image.path,
    sha256: image.sha256,
    reviewId: decision?.id,
    originalDecision: decision,
    truth,
    predictions,
    correct: predictions[0].id === truth,
    admission,
    strictOwnClassEligible: admission.accepted && admission.nearestClassIndex === truthIndex,
    ownToForeignRatio: {
      share: ratio(admission.distances.share),
      bits: ratio(admission.distances.bits),
    },
    nearestShare: split.classes[admission.nearestClassIndex].id,
    nearestBits: split.classes[admission.nearestBitsClassIndex].id,
    meanLuminance: share.reduce((sum, n, bin) => sum + n * bin, 0),
    darkShare: share.slice(0, 64).reduce((a, b) => a + b, 0),
    brightShare: share.slice(192).reduce((a, b) => a + b, 0),
    histogram,
    share,
    linearQuantized: quantizeHistogram(histogram, 'max15'),
    selectedQuantized: quantizeHistogram(histogram, normalization),
  };
};
const allTest = split.test.map(inspect);
const sea = allTest.filter((row) => row.truth === 'sea').sort((a, b) => a.reviewId! - b.reviewId!);
const failures = sea.filter((row) => !row.correct),
  controls = sea.filter((row) => row.correct);
if (sea.length !== 50 || failures.length !== 36) {
  throw new Error('Unexpected Sea test membership/results.');
}
const metrics = (rows: typeof allTest) => {
  const matrix = manifest.classes.map(() => manifest.classes.map(() => 0));
  for (const row of rows) {
    matrix[manifest.classes.findIndex((label) => label.id === row.truth)][
      manifest.classes.findIndex((label) => label.id === row.predictions[0].id)
    ]++;
  }
  return metricsFromConfusion(matrix, manifest.classes);
};
if (JSON.stringify(metrics(allTest)) !== JSON.stringify(manifest.testMetrics)) {
  throw new Error('Test metrics do not reproduce.');
}
const colors = ['#207fb0', '#318844', '#c98527'];
async function sheet(rows: typeof sea, name: string, title: string) {
  const width = 1080,
    cellW = 360,
    cellH = 414,
    header = 55,
    height = header + Math.ceil(rows.length / 3) * cellH;
  const tiles = await Promise.all(
    rows.map(async (row, i) => ({
      input: await sharp(
        imageFile(
          audit,
          split.test.find((image) => image.path === row.path)!,
        ),
      )
        .rotate()
        .resize(330, 208, { fit: 'contain', background: '#eeeeea' })
        .jpeg()
        .toBuffer(),
      left: (i % 3) * cellW + 15,
      top: header + Math.floor(i / 3) * cellH,
    })),
  );
  const snippets = rows
    .map((row, i) => {
      const x = (i % 3) * cellW + 15,
        y = header + Math.floor(i / 3) * cellH;
      const series = [row.share, ...curation.centroids.share],
        max = Math.max(...series.flat());
      const path = (values: number[]) =>
        values
          .map((v, j) => `${j ? 'L' : 'M'}${x + (j * 330) / 255},${y + 302 - (v / max) * 62}`)
          .join(' ');
      return `<g><text x="${x}" y="${y + 225}" font-weight="bold">#${row.reviewId} Sea → ${row.predictions[0].id} ${(row.predictions[0].score * 100).toFixed(1)}%</text>${curation.centroids.share.map((v, k) => `<path d="${path(v)}" fill="none" stroke="${colors[k]}" stroke-width="1.4"/>`).join('')}<path d="${path(row.share)}" fill="none" stroke="#222" stroke-width="1.3"/><text x="${x}" y="${y + 320}">0 dark — H/N histogram — 255 light</text><text x="${x}" y="${y + 341}">Mean Y ${row.meanLuminance.toFixed(1)}; nearest H/N: ${row.nearestShare}</text><text x="${x}" y="${y + 362}">Sea / foreign distance: H ${row.ownToForeignRatio.share.toFixed(3)}, bits ${row.ownToForeignRatio.bits.toFixed(3)}</text><text x="${x}" y="${y + 383}">Training rule: ${row.strictOwnClassEligible ? 'PASS' : 'FAIL'} (both ratios ≤0.95)</text><text x="${x}" y="${y + 403}">${escapeXml(basename(row.path))}</text></g>`;
    })
    .join('');
  const svg = `<svg width="${width}" height="${height}"><g font-family="Arial" font-size="13" fill="#182e27"><text x="15" y="23" font-size="19">${escapeXml(title)}</text><text x="15" y="44">Black: image histogram. Training centroids: blue Sea / green Forest / orange Desert. No refitting.</text>${snippets}</g></svg>`;
  await sharp({ create: { width, height, channels: 3, background: '#fafaf7' } })
    .composite([...tiles, { input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .toFile(resolve(figures, name));
}
for (const [name, rows] of [
  ['failed-sea', failures],
  ['correct-sea-control', controls],
] as const) {
  for (let i = 0; i < rows.length; i += 6) {
    await sheet(
      rows.slice(i, i + 6),
      `${name}-${String(i / 6 + 1).padStart(2, '0')}.jpg`,
      `${name}: ${i + 1}–${Math.min(i + 6, rows.length)} / ${rows.length}`,
    );
  }
}
const summarize = (rows: typeof sea) => ({
  count: rows.length,
  correct: rows.filter((row) => row.correct).length,
  classIndependentAdmission: rows.filter((row) => row.admission.accepted).length,
  strictOwnClassEligible: rows.filter((row) => row.strictOwnClassEligible).length,
  nearestShare: Object.fromEntries(
    manifest.classes.map((label) => [
      label.id,
      rows.filter((row) => row.nearestShare === label.id).length,
    ]),
  ),
  nearestBits: Object.fromEntries(
    manifest.classes.map((label) => [
      label.id,
      rows.filter((row) => row.nearestBits === label.id).length,
    ]),
  ),
  shareMarginPass: rows.filter((row) => row.ownToForeignRatio.share <= 0.95).length,
  bitsMarginPass: rows.filter((row) => row.ownToForeignRatio.bits <= 0.95).length,
});
const report = {
  reviewedAt: new Date().toISOString(),
  scope:
    'Post-test diagnostic requested by user. No training, threshold changes, ledger edits, model replacement or changes to original evaluation. Same truth-conditioned training rule is evaluated descriptively; its conditional accuracy is not an independent general-scene benchmark.',
  modelSha256: manifest.modelSha256,
  frozenCurationSha256: sha256(curationBytes),
  failures: summarize(failures),
  correctControls: summarize(controls),
  sameTrainingRuleAcrossPaletteTest: metrics(allTest.filter((row) => row.strictOwnClassEligible)),
  sameTrainingRuleSea: summarize(sea.filter((row) => row.strictOwnClassEligible)),
  rows: sea,
};
await writeFile(resolve(output, 'histogram-analysis.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
