import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  encodeFourBits,
  quantizeHistogram,
  brightnessHistogram,
  rankPredictions,
  type ModelManifest,
} from '../brain-js/src/core';
import { loadNetwork, type NetworkJSON } from '../brain-js/src/model/network';
import { decodeImage } from '../brain-js/src/image/decode';
import { readSamples } from '../brain-js/src/dataset/split';
import type { DatasetAudit, DatasetSplit } from '../brain-js/src/dataset/types';
import { metricsFromConfusion } from '../brain-js/src/evaluation/metrics';
import { seededRandom } from '../brain-js/src/dataset/random';
import { sha256 } from '../brain-js/src/export/model';
import { contactSheet } from './lib/diagnostic-images';
const out = resolve('../docs/lab2/data/model-diagnostics'),
  base = resolve(out, 'baseline-3.0.0'),
  current = resolve('brain-js/artifacts'),
  sanity = resolve(out, 'external-sanity');
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const [oldManifest, newManifest, oldModel, newModel, split, anchor, audit, set] = await Promise.all(
  [
    json<ModelManifest>(resolve(base, 'manifest.json')),
    json<ModelManifest>(resolve(current, 'manifest.json')),
    json<NetworkJSON>(resolve(base, 'model.json')),
    json<NetworkJSON>(resolve(current, 'model.json')),
    json<DatasetSplit>(resolve(current, 'splits.json')),
    json<DatasetSplit>(resolve(base, 'splits.json')),
    json<DatasetAudit>(resolve(current, 'audit.json')),
    json<{
      frozenAt: string;
      images: { file: string; classId: string; title: string; sha256: string }[];
    }>(resolve(sanity, 'frozen-set.json')),
  ],
);
if (
  sha256(await readFile(resolve(sanity, 'frozen-set.json'))) !==
  (await readFile(resolve(sanity, 'frozen-set.sha256'), 'utf8')).trim()
) {
  throw new Error('External set changed after freeze.');
}
const before = loadNetwork(oldModel),
  after = loadNetwork(newModel),
  classes = newManifest.classes;
const normalization =
  newManifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15';
const [oldSamples, newSamples] = await Promise.all([
  readSamples(split, 'validation', current),
  readSamples(split, 'validation', current, normalization),
]);
const currentGroups = new Map(audit.images.map((x) => [x.path, x.group]));
const oldTrainGroups = new Set(anchor.train.map((x) => currentGroups.get(x.path)));
const validation = newSamples.map((sample, index) => ({
  path: sample.path,
  truth: sample.classIndex,
  before: rankPredictions(before.run(oldSamples[index].input), classes)[0].label.id,
  after: rankPredictions(after.run(sample.input), classes)[0].label.id,
  unseenByBaseline: !oldTrainGroups.has(currentGroups.get(sample.path)),
}));
function compare(rows: typeof validation) {
  const matrix = (key: 'before' | 'after') => {
    const cm = classes.map(() => classes.map(() => 0));
    for (const row of rows) {
      cm[row.truth][classes.findIndex((label) => label.id === row[key])]++;
    }
    return metricsFromConfusion(cm, classes);
  };
  const diffs = rows.map(
    (row) =>
      Number(row.after === classes[row.truth].id) - Number(row.before === classes[row.truth].id),
  );
  const random = seededRandom(20260928);
  const bootstrap = [];
  for (let b = 0; b < 5000; b++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) {
      sum += diffs[Math.floor(random() * diffs.length)];
    }
    bootstrap.push(sum / diffs.length);
  }
  bootstrap.sort((a, b) => a - b);
  const wins = diffs.filter((x) => x === 1).length,
    losses = diffs.filter((x) => x === -1).length,
    n = wins + losses;
  let term = 2 ** -n,
    cdf = term;
  for (let k = 1; k <= Math.min(wins, losses); k++) {
    term *= (n - k + 1) / k;
    cdf += term;
  }
  return {
    count: rows.length,
    before: matrix('before'),
    after: matrix('after'),
    paired: {
      improved: wins,
      worsened: losses,
      accuracyDelta: (wins - losses) / rows.length,
      bootstrap95: [bootstrap[125], bootstrap[4875]],
      exactMcNemarP: Math.min(1, 2 * cdf),
      note: 'Paired image resampling; diagnostic interval, not independent test confirmation. One development image per detected source-photo group.',
    },
  };
}
const external: ((typeof set.images)[number] & {
  before: { id: string; score: number }[];
  after: { id: string; score: number }[];
  width: number;
  height: number;
})[] = [];
for (const row of set.images) {
  if (sha256(await readFile(resolve(sanity, row.file))) !== row.sha256) {
    throw new Error(`External input changed: ${row.file}`);
  }
  const decoded = await decodeImage(resolve(sanity, row.file));
  const histogram = brightnessHistogram(decoded.rgba);
  const first = rankPredictions(before.run(encodeFourBits(quantizeHistogram(histogram))), classes);
  const second = rankPredictions(
    after.run(encodeFourBits(quantizeHistogram(histogram, normalization))),
    classes,
  );
  external.push({
    ...row,
    before: first.map((x) => ({ id: x.label.id, score: x.score })),
    after: second.map((x) => ({ id: x.label.id, score: x.score })),
    width: decoded.width,
    height: decoded.height,
  });
}
const externalSummary = (rows: typeof external) => {
  const cm = (key: 'before' | 'after') => {
    const matrix = classes.map(() => classes.map(() => 0));
    for (const row of rows) {
      matrix[classes.findIndex((x) => x.id === row.classId)][
        classes.findIndex((x) => x.id === row[key][0].id)
      ]++;
    }
    return metricsFromConfusion(matrix, classes);
  };
  return { count: rows.length, before: cm('before'), after: cm('after') };
};
const report = {
  evaluatedAt: new Date().toISOString(),
  selectionFrozenAt: (await json<{ createdAt: string }>(resolve(out, 'frozen-selection.json')))
    .createdAt,
  externalSetFrozenAt: set.frozenAt,
  baseline: {
    version: oldManifest.version,
    hash: oldManifest.modelSha256,
    counts: oldManifest.sampleCounts,
    train: oldManifest.trainMetrics,
    validation: oldManifest.validationMetrics,
    test: oldManifest.testMetrics,
  },
  candidate: {
    version: newManifest.version,
    hash: newManifest.modelSha256,
    counts: newManifest.sampleCounts,
    architecture: newManifest.network,
    preprocessing: newManifest.preprocessingVersion,
    train: newManifest.trainMetrics,
    validation: newManifest.validationMetrics,
    test: newManifest.testMetrics,
  },
  sameCorrectedValidation: compare(validation),
  commonValidationWithoutBaselineTrainingCopies: compare(
    validation.filter((x) => x.unseenByBaseline),
  ),
  externalNewPhotos: externalSummary(external.filter((x) => x.file !== 'sahara-user.jpg')),
  externalIncludingKnownSahara: externalSummary(external),
  sahara: external.find((x) => x.file === 'sahara-user.jpg'),
  perClassSplitCounts: split.counts,
  exclusions: split.excluded,
  limitations:
    'Old model saw source-photo copies now excluded from development. Formal test was previously inspected; external set is small, purposive and source-dependent. Changes combine leakage correction, balancing and normalization/architecture; no isolated causal attribution. No further model selection follows these final evaluations.',
};
await writeFile(resolve(out, 'before-after.json'), JSON.stringify(report, null, 2));
await writeFile(resolve(out, 'external-sanity-results.json'), JSON.stringify(external, null, 2));
const quote = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
await writeFile(
  resolve(out, 'external-sanity-results.csv'),
  [
    'file,true_class,before_class,before_score,after_class,after_score',
    ...external.map((x) =>
      [x.file, x.classId, x.before[0].id, x.before[0].score, x.after[0].id, x.after[0].score]
        .map(quote)
        .join(','),
    ),
  ].join('\n') + '\n',
);
for (const label of classes) {
  const rows = external.filter((x) => x.classId === label.id);
  await contactSheet(
    rows.map((x) => ({
      file: resolve(sanity, x.file),
      caption: `old ${x.before[0].id} ${(100 * x.before[0].score).toFixed(0)} / new ${x.after[0].id} ${(100 * x.after[0].score).toFixed(0)}`,
    })),
    resolve(`../docs/lab2/figures/model-diagnostics/external-results-${label.id}.jpg`),
    `External ${label.displayName}: old / new raw score (%)`,
    4,
  );
}
console.log(
  JSON.stringify(
    {
      sameValidation: report.sameCorrectedValidation,
      commonUnseenValidation: report.commonValidationWithoutBaselineTrainingCopies,
      external: report.externalNewPhotos,
      sahara: report.sahara,
    },
    null,
    2,
  ),
);
