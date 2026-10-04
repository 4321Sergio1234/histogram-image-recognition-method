import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { datasetPaths, trainingConfig } from '../config/training';
import { extractFeatures } from '../features/histogram';
import { decodeImage } from '../image/decode';
import { imageFile, loadOrCreateAudit } from '../dataset/audit';
import { classIndex } from '../dataset/split';
import { correctSplit } from '../dataset/correction';
import exclusions from '../config/reviewed-exclusions.json';
import { seededRandom, shuffled } from '../dataset/random';
import type { AuditedImage, DatasetSplit } from '../dataset/types';
import {
  normalizedHistogram,
  principalComponents,
  separability,
  type HistogramSample,
} from '../evaluation/separability';
import { createNetwork } from '../model/network';

/** Exploratory feature diagnostics on train/validation pool images only; test sections are never decoded here. */
const audit = await loadOrCreateAudit(datasetPaths(), trainingConfig.artifactsDirectory);
const split = correctSplit(
  audit,
  JSON.parse(await readFile(trainingConfig.holdoutAnchor, 'utf8')) as DatasetSplit,
  exclusions,
);
const images = [...split.train, ...split.validation];
const samples: HistogramSample[] = new Array(images.length);
let cursor = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < images.length) {
      const index = cursor++;
      const { histogram, quantized } = extractFeatures(
        (await decodeImage(imageFile(audit, images[index]))).rgba,
      );
      samples[index] = { classIndex: classIndex(split, images[index]), histogram, quantized };
    }
  }),
);
const ids = split.classes.map((label) => label.id);
const stats = separability(samples, ids);
const rows = samples.map((sample) => normalizedHistogram(sample.histogram));
const pca = principalComponents(rows, 2, trainingConfig.splitSeed);

const colors = ['#2a78d6', '#eb6834', '#1baf7a'];
const ink = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#fcfcfb',
};
const font = 'font-family="system-ui,-apple-system,Segoe UI,sans-serif"';
const names = split.classes.map((label) => label.displayName);
const legend = (x: number, y: number) =>
  names
    .map(
      (name, index) =>
        `<g transform="translate(${x + index * 150} ${y})"><line x1="0" x2="22" y1="-5" y2="-5" stroke="${colors[index]}" stroke-width="3" stroke-linecap="round"/><text x="30" y="0" fill="${ink.secondary}" font-size="14">${name} · n=${stats.perClass[index].count}</text></g>`,
    )
    .join('');

function panel(
  top: number,
  height: number,
  series: number[][],
  maxY: number,
  yTicks: number[],
  yLabel: (value: number) => string,
  title: string,
) {
  const left = 70;
  const width = 840;
  const x = (bin: number) => left + (bin / 255) * width;
  const y = (value: number) => top + height - (value / maxY) * height;
  const grid = yTicks
    .map(
      (value) =>
        `<line x1="${left}" x2="${left + width}" y1="${y(value)}" y2="${y(value)}" stroke="${value ? ink.grid : ink.axis}" stroke-width="1"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="${ink.muted}" font-size="12">${yLabel(value)}</text>`,
    )
    .join('');
  const xTicks = [0, 32, 64, 96, 128, 160, 192, 224, 255]
    .map(
      (bin) =>
        `<text x="${x(bin)}" y="${top + height + 20}" text-anchor="middle" fill="${ink.muted}" font-size="12">${bin}</text>`,
    )
    .join('');
  const lines = series
    .map(
      (values, index) =>
        `<polyline fill="none" stroke="${colors[index]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${values.map((value, bin) => `${x(bin).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}"/>`,
    )
    .join('');
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const peaks = series
    .map((values, index) => {
      const bin = values.indexOf(Math.max(...values));
      const label = `${names[index]}: пік ${bin}`;
      const width = label.length * 7.2;
      const anchorEnd = bin > 200;
      const left = anchorEnd ? x(bin) - 8 - width : x(bin) + 8;
      // Try above the point first, then progressively lower, so labels of nearby peaks never overlap.
      let baseline = y(values[bin]) - 8;
      for (const offset of [0, 26, 44, 62, 80]) {
        baseline = y(values[bin]) + (offset ? offset - 8 : -8);
        const box = { left, right: left + width, top: baseline - 13, bottom: baseline + 3 };
        if (
          !placed.some(
            (other) =>
              box.left < other.right &&
              box.right > other.left &&
              box.top < other.bottom &&
              box.bottom > other.top,
          )
        ) {
          placed.push(box);
          break;
        }
      }
      return `<circle cx="${x(bin)}" cy="${y(values[bin])}" r="4" fill="${colors[index]}" stroke="${ink.surface}" stroke-width="2"/><text x="${anchorEnd ? x(bin) - 8 : x(bin) + 8}" y="${baseline}" text-anchor="${anchorEnd ? 'end' : 'start'}" fill="${ink.primary}" font-size="13">${label}</text>`;
    })
    .join('');
  return `<text x="${left}" y="${top - 14}" fill="${ink.primary}" font-size="15" font-weight="600">${title}</text>${grid}${xTicks}${lines}${peaks}`;
}
const shares = stats.perClass.map((item) => item.centroid.map((value) => value * 100));
const maxShare = Math.ceil(Math.max(...shares.flat()) * 2) / 2;
const shareTicks = Array.from({ length: 5 }, (_, index) => (maxShare * index) / 4);
const histogramSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" role="img" aria-label="Середні гістограми яскравості класів Sea, Forest і Desert"><rect width="960" height="720" fill="${ink.surface}"/><g ${font}>
<text x="70" y="36" fill="${ink.primary}" font-size="20" font-weight="600">Середні гістограми яскравості за класами</text>
<text x="70" y="60" fill="${ink.secondary}" font-size="14">Лише train + validation (${samples.length} зображень); тестові розділи не використано. Ознаки для ANN не змінюються.</text>
${legend(70, 92)}
${panel(140, 220, shares, maxShare, shareTicks, (value) => `${value.toFixed(1)}%`, 'а) Частка пікселів у комірці Y′ (усереднена нормована гістограма H / N)')}
${panel(
  440,
  220,
  stats.perClass.map((item) => item.meanQuantized),
  15,
  [0, 5, 10, 15],
  (value) => String(value),
  'б) Середнє квантоване значення Q (0–15), яке кодується 4 бітами',
)}
<text x="490" y="706" text-anchor="middle" fill="${ink.secondary}" font-size="13">Яскравість Y′ = 0.299R + 0.587G + 0.114B (комірка 0–255)</text></g></svg>`;

const random = seededRandom(trainingConfig.splitSeed);
const plotted = ids.flatMap((_, index) =>
  shuffled(
    samples.flatMap((sample, position) => (sample.classIndex === index ? [position] : [])),
    random,
  ).slice(0, 400),
);
const points = plotted.map((position) => ({
  classIndex: samples[position].classIndex,
  xy: pca.project(rows[position]),
}));
const [minX, maxX] = [
  Math.min(...points.map((point) => point.xy[0])),
  Math.max(...points.map((point) => point.xy[0])),
];
const [minY, maxY] = [
  Math.min(...points.map((point) => point.xy[1])),
  Math.max(...points.map((point) => point.xy[1])),
];
const px = (value: number) => 80 + ((value - minX) / (maxX - minX)) * 800;
const py = (value: number) => 620 - ((value - minY) / (maxY - minY)) * 480;
const pcaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="700" viewBox="0 0 960 700" role="img" aria-label="PCA-проєкція нормованих гістограм"><rect width="960" height="700" fill="${ink.surface}"/><g ${font}>
<text x="80" y="36" fill="${ink.primary}" font-size="20" font-weight="600">PCA-проєкція нормованих гістограм яскравості (лише візуалізація)</text>
<text x="80" y="60" fill="${ink.secondary}" font-size="14">По 400 випадкових зображень класу з train + validation. PCA не є ознакою класифікатора; осі в умовних одиницях.</text>
${legend(80, 96)}
<rect x="80" y="140" width="800" height="480" fill="none" stroke="${ink.axis}"/>
${[...points.keys()]
  .sort((a, b) => ((a * 7919) % points.length) - ((b * 7919) % points.length))
  .map((index) => {
    const point = points[index];
    return `<circle cx="${px(point.xy[0]).toFixed(1)}" cy="${py(point.xy[1]).toFixed(1)}" r="3.5" fill="${colors[point.classIndex]}" fill-opacity="0.6"/>`;
  })
  .join('')}
<text x="480" y="660" text-anchor="middle" fill="${ink.secondary}" font-size="14">PC1 (${(pca.explainedVarianceRatio[0] * 100).toFixed(1)}% дисперсії)</text>
<text transform="translate(40 380) rotate(-90)" text-anchor="middle" fill="${ink.secondary}" font-size="14">PC2 (${(pca.explainedVarianceRatio[1] * 100).toFixed(1)}% дисперсії)</text></g></svg>`;

/**
 * Source-identity probe: can the same 1024-bit features tell which dataset a photo of the same kind of scene came from?
 * Balanced pool images only, seeded 85/15 split, linear Brain.js network. High accuracy means dataset origin is learnable,
 * so a class drawn from a single source (Desert) may be recognised partly by its source rather than by its content.
 */
const cache = await readFile(resolve(trainingConfig.artifactsDirectory, 'features.bin'));
function probe(a: { source: string; label: string }, b: { source: string; label: string }) {
  const random = seededRandom(trainingConfig.splitSeed);
  const forbiddenGroups = new Set(
    audit.images.filter((image) => image.role === 'test').map((image) => image.group),
  );
  const sourceGroups = new Map<string, Set<string>>();
  for (const image of audit.images) {
    const sources = sourceGroups.get(image.group) ?? new Set<string>();
    sources.add(image.source);
    sourceGroups.set(image.group, sources);
  }
  const pick = (spec: { source: string; label: string }) => [
    ...new Map(
      audit.images
        .filter(
          (image) =>
            image.role === 'pool' &&
            image.source === spec.source &&
            image.label === spec.label &&
            !forbiddenGroups.has(image.group) &&
            sourceGroups.get(image.group)!.size === 1,
        )
        .map((image) => [image.group, image]),
    ).values(),
  ];
  const [first, second] = [pick(a), pick(b)];
  const count = Math.min(first.length, second.length);
  const rows = [first, second].flatMap((group, target) =>
    shuffled(group, random)
      .slice(0, count)
      .map((image: AuditedImage, position) => ({
        held: position >= Math.floor((count * 85) / 100),
        sample: {
          input: Array.from(
            cache.subarray(image.featureIndex * 1024, image.featureIndex * 1024 + 1024),
          ),
          output: target ? [0, 1] : [1, 0],
        },
      })),
  );
  const saved = Math.random;
  Math.random = seededRandom(trainingConfig.initializationSeed);
  try {
    const network = createNetwork([]);
    network.train(
      shuffled(
        rows.filter((row) => !row.held).map((row) => row.sample),
        random,
      ),
      { iterations: 20, learningRate: 0.1, momentum: 0.1, errorThresh: 0.002, log: false },
    );
    const held = rows.filter((row) => row.held);
    const correct = held.filter((row) => {
      const output = network.run(row.sample.input);
      return (output[1] > output[0] ? 1 : 0) === row.sample.output[1];
    }).length;
    return {
      pair: [`${a.source}/${a.label}`, `${b.source}/${b.label}`],
      perSource: count,
      heldOut: held.length,
      accuracy: correct / held.length,
      chance: 0.5,
    };
  } finally {
    Math.random = saved;
  }
}
const sourceProbes = [
  probe({ source: 'intel', label: 'forest' }, { source: 'landscape', label: 'forest' }),
  probe({ source: 'intel', label: 'sea' }, { source: 'landscape', label: 'coast' }),
];

await mkdir(trainingConfig.reportDataDirectory, { recursive: true });
await mkdir(trainingConfig.reportFigureDirectory, { recursive: true });
const report = {
  createdAt: new Date().toISOString(),
  scope:
    'train + validation partitions only (Intel seg_train, Landscape Training/Validation Data); test sections excluded',
  splitSeed: split.seed,
  samples: samples.length,
  note: 'Exploratory diagnostics. Centroids, L1 distances, nearest-centroid agreement and PCA are never classifier inputs; the ANN receives only the canonical 1024-bit histogram encoding. Nearest-centroid agreement is measured in-sample and is not an accuracy estimate.',
  perClass: stats.perClass.map((item) => ({
    id: item.id,
    count: item.count,
    meanLuminance: item.meanLuminance,
    luminanceStd: item.luminanceStd,
    withinClassL1: item.withinClassL1,
    peakBin: item.centroid.indexOf(Math.max(...item.centroid)),
    meanHistogramShare: item.centroid,
    meanQuantized: item.meanQuantized,
  })),
  centroidDistances: stats.centroidDistances,
  meanWithinClassL1: stats.meanWithinClassL1,
  betweenToWithinRatio: stats.betweenToWithinRatio,
  inSampleNearestCentroidAgreement: stats.inSampleNearestCentroidAgreement,
  pca: { explainedVarianceRatio: pca.explainedVarianceRatio, plottedPerClass: 400 },
  sourceProbes,
  sourceProbeNote:
    'Linear 1024 → 2 Brain.js probe: one image per exact/perceptual group, test-linked and cross-source groups excluded, seeded 85/15 partition of balanced source groups. No test evaluation. Accuracy well above 0.5 means dataset origin is recognisable from the histogram features.',
};
await writeFile(
  resolve(trainingConfig.reportDataDirectory, 'feature-separability.json'),
  JSON.stringify(report, null, 2),
);
await writeFile(
  resolve(trainingConfig.reportFigureDirectory, 'class-histograms.svg'),
  histogramSvg,
);
await writeFile(resolve(trainingConfig.reportFigureDirectory, 'histogram-pca.svg'), pcaSvg);
console.log(
  JSON.stringify(
    {
      samples: samples.length,
      perClass: report.perClass.map(
        ({ meanHistogramShare: _share, meanQuantized: _quantized, ...rest }) => rest,
      ),
      centroidDistances: stats.centroidDistances,
      meanWithinClassL1: stats.meanWithinClassL1,
      nearestCentroid: stats.inSampleNearestCentroidAgreement,
      pca: pca.explainedVarianceRatio,
      sourceProbes,
    },
    null,
    2,
  ),
);
