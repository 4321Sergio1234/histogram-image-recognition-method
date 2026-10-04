import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { extractFeatures, rankPredictions } from '../brain-js/src/core';
import { decodeImage } from '../brain-js/src/image/decode';
import { imageFile } from '../brain-js/src/dataset/audit';
import { classIndex } from '../brain-js/src/dataset/split';
import { seededRandom, shuffled } from '../brain-js/src/dataset/random';
import type { DatasetAudit, DatasetSplit } from '../brain-js/src/dataset/types';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import {
  contactSheet,
  perceptualHash,
  transformSquare,
  hamming,
  thumbnailSimilarity,
} from './lib/diagnostic-images';
const out = resolve('../docs/lab2/data/model-diagnostics'),
  figures = resolve('../docs/lab2/figures/model-diagnostics'),
  base = resolve(out, 'baseline-3.0.0');
await mkdir(figures, { recursive: true });
const audit = JSON.parse(await readFile(resolve(base, 'audit.json'), 'utf8')) as DatasetAudit;
const split = JSON.parse(await readFile(resolve(base, 'splits.json'), 'utf8')) as DatasetSplit;
const network = loadNetwork(
  JSON.parse(await readFile(resolve(base, 'model.json'), 'utf8')) as NetworkJSON,
);
const roles = new Map([
  ...split.train.map((x) => [x.path, 'train'] as const),
  ...split.validation.map((x) => [x.path, 'validation'] as const),
  ...split.test.map((x) => [x.path, 'test'] as const),
]);
const selected = audit.images.filter(
  (x) =>
    (x.source === 'intel' && ['sea', 'forest'].includes(x.label ?? '')) ||
    (x.source === 'landscape' && ['desert', 'forest', 'coast'].includes(x.label ?? '')),
);
const records: {
  path: string;
  source: string;
  label: string;
  split: string;
  format: string;
  width: number;
  height: number;
  aspect: number;
  bytes: number;
  icc: number;
  orientation: number;
  meanLuminance: number;
  contrast: number;
  sharpness: number;
  histogram: number[];
  quantized: number[];
  features: number[];
  scores: number[];
  top: string;
}[] = new Array(selected.length);
const thumbs: Uint8Array[] = new Array(selected.length);
let cursor = 0,
  complete = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < selected.length) {
      const i = cursor++,
        row = selected[i],
        file = imageFile(audit, row);
      const decoded = await decodeImage(file),
        f = extractFeatures(decoded.rgba),
        meta = await sharp(file).metadata();
      const n = decoded.width * decoded.height;
      const mean = f.histogram.reduce((s, x, b) => s + x * b, 0) / n;
      const contrast = Math.sqrt(f.histogram.reduce((s, x, b) => s + x * (b - mean) ** 2, 0) / n);
      const { data } = await sharp(file)
        .rotate()
        .resize(32, 32, { fit: 'fill' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      thumbs[i] = data;
      let energy = 0;
      for (let y = 1; y < 31; y++) {
        for (let x = 1; x < 31; x++) {
          const k = (y * 32 + x) * 3;
          for (let c = 0; c < 3; c++) {
            energy += Math.abs(
              4 * data[k + c] -
                data[k - 3 + c] -
                data[k + 3 + c] -
                data[k - 96 + c] -
                data[k + 96 + c],
            );
          }
        }
      }
      const scores = Array.from(network.run(f.features));
      records[i] = {
        path: row.path,
        source: row.source,
        label: row.label!,
        split: roles.get(row.path) ?? (row.role === 'test' ? 'unused-test' : 'unused-pool'),
        format: row.format,
        width: decoded.width,
        height: decoded.height,
        aspect: decoded.width / decoded.height,
        bytes: row.bytes,
        icc: meta.icc?.length ?? 0,
        orientation: meta.orientation ?? 1,
        meanLuminance: mean,
        contrast,
        sharpness: energy / 2700,
        histogram: f.histogram,
        quantized: f.quantized,
        features: f.features,
        scores,
        top: rankPredictions(scores, split.classes)[0].label.id,
      };
      if (++complete % 2000 === 0) {
        console.log(`Detailed audit ${complete}/${selected.length}`);
      }
    }
  }),
);
await writeFile(
  resolve(out, 'image-statistics.json'),
  JSON.stringify(
    records.map(({ histogram: _h, quantized: _q, features: _f, ...r }) => r),
    null,
    2,
  ),
);
await writeFile(
  resolve(out, 'histogram-cache.json'),
  JSON.stringify(records.map(({ path, histogram }) => ({ path, histogram }))),
);
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    median: sorted[Math.floor(sorted.length * 0.5)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
    max: sorted.at(-1),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
};
const count = (values: (string | number)[]) =>
  Object.fromEntries([...new Set(values)].map((x) => [x, values.filter((y) => x === y).length]));
const groups = [...new Set(records.map((x) => `${x.source}/${x.label}`))].map((key) => {
  const rows = records.filter((x) => `${x.source}/${x.label}` === key);
  return {
    key,
    count: rows.length,
    sourceFolders: [...new Set(rows.map((x) => x.path.slice(0, x.path.lastIndexOf('/'))))],
    splits: count(rows.map((x) => x.split)),
    formats: count(rows.map((x) => x.format)),
    dimensions: count(rows.map((x) => `${x.width}x${x.height}`)),
    aspect: stats(rows.map((x) => x.aspect)),
    luminance: stats(rows.map((x) => x.meanLuminance)),
    contrast: stats(rows.map((x) => x.contrast)),
    sharpnessProxy: stats(rows.map((x) => x.sharpness)),
    profiled: rows.filter((x) => x.icc > 0).map((x) => x.path),
    suspiciousFilenames: rows
      .filter((x) => /copy|duplicate|flip|rotate|aug|screenshot|watermark/i.test(x.path))
      .map((x) => x.path),
  };
});
await writeFile(
  resolve(out, 'dataset-source-audit.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      scope:
        'All selected classes plus Landscape coast/forest for source-composition diagnosis. Original files unchanged. Sharpness is a 32px thumbnail Laplacian proxy; semantic sky/horizon/watermark labels require visual review.',
      groups,
      unreadable: audit.unreadable,
      exactDuplicates: audit.duplicates,
    },
    null,
    2,
  ),
);
const mean = (rows: number[][]) =>
  rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
const centroids = split.classes.map((label) => {
  const rows = records.filter(
    (x) => x.split === 'train' && x.source === label.source && x.label === label.datasetLabel,
  );
  const raw = rows.map((x) => x.histogram),
    shares = raw.map((h) => h.map((v) => v / h.reduce((a, b) => a + b, 0))),
    q = rows.map((x) => x.quantized),
    bits = rows.map((x) => x.features);
  const average = mean(shares);
  return {
    id: label.id,
    count: rows.length,
    meanRaw: mean(raw),
    meanShare: average,
    stdShare: mean(shares.map((h) => h.map((v, i) => (v - average[i]) ** 2))).map(Math.sqrt),
    meanQuantized: mean(q),
    bitCentroid: mean(bits),
  };
});
const distance = (a: number[], b: number[]) => ({
  euclidean: Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)),
  cosineSimilarity: a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b)),
  l1: a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0),
});
const sahara = extractFeatures(
  (await decodeImage('/Users/admin/Downloads/desertSachara.jpg')).rgba,
);
const shares = sahara.histogram.map((x) => x / sahara.histogram.reduce((a, b) => a + b, 0));
const distances = centroids.flatMap((a, i) =>
  centroids.slice(i + 1).map((b) => ({
    pair: [a.id, b.id],
    histogram: distance(a.meanShare, b.meanShare),
    bits: distance(a.bitCentroid, b.bitCentroid),
  })),
);
await writeFile(
  resolve(out, 'histogram-centroids.json'),
  JSON.stringify(
    {
      scope:
        'Baseline training images only; centroids and distances are diagnostics, never classifier inputs.',
      centroids,
      distances,
      sahara: {
        ...sahara,
        scores: Array.from(network.run(sahara.features)),
        distances: centroids.map((c) => ({
          id: c.id,
          histogram: distance(shares, c.meanShare),
          quantized: distance(sahara.quantized, c.meanQuantized),
          bits: distance(sahara.features, c.bitCentroid),
        })),
      },
    },
    null,
    2,
  ),
);
const sampleMap: Record<string, string[]> = {};
for (const group of groups) {
  const rows = shuffled(
    records.filter(
      (x) =>
        `${x.source}/${x.label}` === group.key && x.split !== 'test' && x.split !== 'unused-test',
    ),
    seededRandom(20260928),
  ).slice(0, 30);
  sampleMap[group.key] = rows.map((x) => x.path);
  await contactSheet(
    rows.map((x) => ({
      file: imageFile(
        audit,
        selected.find((r) => r.path === x.path)!,
      ),
      caption: `${x.source}/${x.label} | Y ${x.meanLuminance.toFixed(0)}`,
    })),
    resolve(figures, `random-${group.key.replace('/', '-')}.jpg`),
    `Seeded random pool images: ${group.key} (30)`,
  );
}
const validation = records.filter((x) => x.split === 'validation');
const errorGroups = [
  ['desert-correct', 'desert', 'desert'],
  ['desert-to-sea', 'desert', 'sea'],
  ['sea-correct', 'sea', 'sea'],
  ['sea-to-desert', 'sea', 'desert'],
  ['forest-errors', 'forest', 'other'],
];
for (const [name, truth, pred] of errorGroups) {
  const rows = validation
    .filter(
      (x) =>
        split.classes[
          classIndex(
            split,
            selected.find((y) => y.path === x.path)!,
          )
        ].id === truth && (pred === 'other' ? x.top !== truth : x.top === pred),
    )
    .sort((a, b) => Math.max(...b.scores) - Math.max(...a.scores))
    .slice(0, 20);
  sampleMap[name] = rows.map((x) => x.path);
  await contactSheet(
    rows.map((x) => ({
      file: imageFile(
        audit,
        selected.find((y) => y.path === x.path)!,
      ),
      caption: `${truth} > ${x.top} ${(100 * Math.max(...x.scores)).toFixed(1)}%`,
    })),
    resolve(figures, `${name}.jpg`),
    `Validation: ${name}, highest scores`,
  );
}
await writeFile(resolve(out, 'contact-sheet-index.json'), JSON.stringify(sampleMap, null, 2));
const scoreStats = errorGroups.map(([name, truth, pred]) => {
  const rows = validation.filter(
    (x) =>
      split.classes[
        classIndex(
          split,
          selected.find((y) => y.path === x.path)!,
        )
      ].id === truth && (pred === 'other' ? x.top !== truth : x.top === pred),
  );
  return { name, count: rows.length, topScores: stats(rows.map((x) => Math.max(...x.scores))) };
});
await writeFile(resolve(out, 'score-distributions.json'), JSON.stringify(scoreStats, null, 2));
console.log('Contact sheets and histogram diagnostics written. Searching perceptual duplicates…');
const hashes = thumbs.map(perceptualHash);
const buckets = new Map<string, number[]>();
hashes.forEach((hash, i) => {
  for (let b = 0; b < 8; b++) {
    const key = `${b}:${Number((hash >> BigInt(b * 8)) & 255n)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), i]);
  }
});
const pairs: {
  a: string;
  b: string;
  bits: number;
  mode: number;
  mae: number;
  correlation: number;
  oldSplits: string[];
  exact: boolean;
}[] = [];
for (let i = 0; i < selected.length; i++) {
  const accepted = new Set<number>();
  for (let mode = 0; mode < 8; mode++) {
    const thumb = mode ? transformSquare(thumbs[i], mode) : thumbs[i],
      hash = mode ? perceptualHash(thumb) : hashes[i],
      votes = new Map<number, number>();
    for (let band = 0; band < 8; band++) {
      const bucket = buckets.get(`${band}:${Number((hash >> BigInt(band * 8)) & 255n)}`) ?? [];
      for (const j of bucket) {
        if (j < i && !accepted.has(j)) {
          votes.set(j, (votes.get(j) ?? 0) + 1);
        }
      }
    }
    for (const [j, v] of votes) {
      if (v < 4) {
        continue;
      }
      const bits = hamming(hash, hashes[j]);
      if (bits > 4) {
        continue;
      }
      const sim = thumbnailSimilarity(thumb, thumbs[j]);
      if (sim.mae > 10 || sim.correlation < 0.985) {
        continue;
      }
      accepted.add(j);
      pairs.push({
        a: selected[j].path,
        b: selected[i].path,
        bits,
        mode,
        ...sim,
        oldSplits: [records[j].split, records[i].split],
        exact: selected[j].group === selected[i].group,
      });
    }
  }
  if (i % 2000 === 0) {
    console.log(`Near-duplicate scan ${i}/${selected.length}, ${pairs.length} pairs`);
  }
}
await writeFile(
  resolve(out, 'near-duplicates.json'),
  JSON.stringify(
    {
      method:
        '32x32 RGB DCT pHash; all 8 flip/transpose orientations; Hamming ≤4, RGB thumbnail MAE ≤10 and correlation ≥0.985. Conservative candidate detector, not proof of exhaustive crop detection. Diagnostics only until visually reviewed.',
      pairs,
    },
    null,
    2,
  ),
);
const cross = pairs.filter(
  (x) =>
    !x.exact &&
    x.oldSplits[0] !== x.oldSplits[1] &&
    !x.oldSplits.every((s) => s.startsWith('unused')),
);
for (let start = 0; start < Math.min(cross.length, 100); start += 20) {
  const rows = cross.slice(start, start + 20).flatMap((pair) =>
    [pair.a, pair.b].map((p, i) => ({
      file: imageFile(
        audit,
        selected.find((x) => x.path === p)!,
      ),
      caption: `pair ${start + cross.slice(start, start + 20).indexOf(pair) + 1} ${pair.oldSplits[i]}`,
    })),
  );
  await contactSheet(
    rows,
    resolve(figures, `near-duplicate-cross-split-${start / 20 + 1}.jpg`),
    'Perceptual matches across old splits',
    4,
  );
}
console.log(
  JSON.stringify(
    {
      groups: groups.map((x) => ({
        key: x.key,
        count: x.count,
        luminance: x.luminance.mean,
        aspect: x.aspect.median,
      })),
      nearPairs: pairs.length,
      newCrossSplitPairs: cross.length,
      distances,
      saharaDistances: centroids.map((c) => ({ id: c.id, ...distance(shares, c.meanShare) })),
    },
    null,
    2,
  ),
);
