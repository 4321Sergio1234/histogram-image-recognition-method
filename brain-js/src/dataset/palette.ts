import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GEOSCENE_CATALOG, IGNORED_DATASET_LABELS } from '../core/scenes';
import { encodeFourBits, quantizeHistogram } from '../features/histogram';
import { seededRandom, shuffled } from './random';
import { assertNoLeakage, classIndex } from './split';
import type { AuditedImage, DatasetAudit, DatasetSplit, SplitName } from './types';

export interface ManualDecision {
  id: number;
  path: string;
  sha256: string;
  decision: 'include' | 'exclude';
  reason: string;
}
export interface PaletteVector {
  share: number[];
  bits: number[];
}
export interface PaletteCentroids {
  share: number[][];
  bits: number[][];
  trainingCounts: number[];
}
export const HISTOGRAM_MARGIN_RATIO = 0.95;
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const sortPaths = (a: AuditedImage, b: AuditedImage) => a.path.localeCompare(b.path, 'en');

/** Flat dataset: assign whole source-photo groups before applying any palette or feature eligibility. */
export function populationSplit(
  audit: DatasetAudit,
  seed: number,
  validationPercent = 15,
  testPercent = 15,
): DatasetSplit {
  if (audit.sources.length !== 1 || audit.sources[0].id !== 'geoscene') {
    throw new Error('This experiment accepts only GeoSceneNet16K.');
  }
  if (validationPercent <= 0 || testPercent <= 0 || validationPercent + testPercent >= 100) {
    throw new Error('Invalid holdout proportions.');
  }
  const groups = new Map<string, AuditedImage[]>();
  for (const image of audit.images) {
    groups.set(image.group, [...(groups.get(image.group) ?? []), image]);
  }
  const split: DatasetSplit = {
    seed,
    validationPercent,
    datasetFingerprint: audit.fingerprint,
    classes: [...GEOSCENE_CATALOG],
    ignoredClasses: { geoscene: [...IGNORED_DATASET_LABELS.geoscene] },
    train: [],
    validation: [],
    test: [],
    counts: {},
    excluded: [],
  };
  const random = seededRandom(seed);
  for (const label of split.classes) {
    const selected = audit.images.filter(
      (image) => image.source === label.source && image.label === label.datasetLabel,
    );
    const representatives: AuditedImage[] = [];
    for (const group of new Set(selected.map((image) => image.group))) {
      const members = groups.get(group)!;
      const own = members.filter((image) => image.label === label.datasetLabel).sort(sortPaths);
      if (new Set(members.map((image) => image.label)).size > 1) {
        split.excluded.push(
          ...own.map((image) => ({
            path: image.path,
            reason: 'Source-photo duplicate group has conflicting category labels.',
          })),
        );
      } else {
        representatives.push(own[0]);
        split.excluded.push(
          ...own.slice(1).map((image) => ({
            path: image.path,
            reason:
              'Additional exact/perceptual source-photo copy; one fixed representative per group.',
          })),
        );
      }
    }
    const rows = shuffled(representatives.sort(sortPaths), random);
    const testCount = Math.floor((rows.length * testPercent) / 100),
      validationCount = Math.floor((rows.length * validationPercent) / 100);
    split.test.push(
      ...rows.slice(0, testCount).map((image) => ({ ...image, role: 'test' as const })),
    );
    split.validation.push(...rows.slice(testCount, testCount + validationCount));
    split.train.push(...rows.slice(testCount + validationCount));
    split.counts[label.id] = {
      available: selected.length,
      excluded: selected.length - rows.length,
      train: rows.length - testCount - validationCount,
      validation: validationCount,
      test: testCount,
    };
  }
  assertNoLeakage(split);
  return split;
}

export function fitPaletteCentroids(
  rows: { classIndex: number; vector: PaletteVector }[],
  classes: number,
): PaletteCentroids {
  const result: PaletteCentroids = {
    share: Array.from({ length: classes }, () => new Array<number>(256).fill(0)),
    bits: Array.from({ length: classes }, () => new Array<number>(1024).fill(0)),
    trainingCounts: new Array<number>(classes).fill(0),
  };
  for (const { classIndex: label, vector } of rows) {
    result.trainingCounts[label]++;
    for (const key of ['share', 'bits'] as const) {
      vector[key].forEach((value, i) => {
        result[key][label][i] += value;
      });
    }
  }
  for (let label = 0; label < classes; label++) {
    if (!result.trainingCounts[label]) {
      throw new Error('Every palette class needs accepted training representatives.');
    }
    for (const key of ['share', 'bits'] as const) {
      result[key][label] = result[key][label].map((value) => value / result.trainingCounts[label]);
    }
  }
  return result;
}

/** No ground-truth label is consumed; can describe conditional holdout coverage without filtering by correctness. */
export function histogramAdmission(vector: PaletteVector, centroids: PaletteCentroids) {
  const distance = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));
  const distances = {
    share: centroids.share.map((c) => distance(vector.share, c)),
    bits: centroids.bits.map((c) => distance(vector.bits, c)),
  };
  const best = (values: number[]) =>
    values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value || a.index - b.index);
  const share = best(distances.share),
    bits = best(distances.bits);
  const accepted =
    share[0].index === bits[0].index &&
    share[1].value > 0 &&
    bits[1].value > 0 &&
    share[0].value <= HISTOGRAM_MARGIN_RATIO * share[1].value &&
    bits[0].value <= HISTOGRAM_MARGIN_RATIO * bits[1].value;
  return {
    accepted,
    nearestClassIndex: share[0].index,
    nearestBitsClassIndex: bits[0].index,
    distances,
  };
}

export function paletteSplit(
  population: DatasetSplit,
  decisions: Map<string, ManualDecision>,
  vector: (image: AuditedImage) => PaletteVector,
  minimumTrain = 30,
) {
  for (const image of [...population.train, ...population.validation, ...population.test]) {
    const decision = decisions.get(image.path);
    if (
      !decision ||
      decision.sha256 !== image.sha256 ||
      !decision.reason ||
      !['include', 'exclude'].includes(decision.decision)
    ) {
      throw new Error(`Missing or stale manual decision: ${image.path}`);
    }
  }
  const accepted = (image: AuditedImage) => decisions.get(image.path)!.decision === 'include';
  const paletteTrain = population.train.filter(accepted);
  const centroids = fitPaletteCentroids(
    paletteTrain.map((image) => ({
      classIndex: classIndex(population, image),
      vector: vector(image),
    })),
    population.classes.length,
  );
  const trainingDecisions = paletteTrain.map((image) => {
    const admission = histogramAdmission(vector(image), centroids);
    return {
      path: image.path,
      classId: population.classes[classIndex(population, image)].id,
      ...admission,
      eligible: admission.accepted && admission.nearestClassIndex === classIndex(population, image),
    };
  });
  const eligible = new Set(trainingDecisions.filter((row) => row.eligible).map((row) => row.path));
  const split: DatasetSplit = {
    ...population,
    train: paletteTrain.filter((image) => eligible.has(image.path)),
    validation: population.validation.filter(accepted),
    test: population.test.filter(accepted),
    excluded: [...population.excluded],
    counts: structuredClone(population.counts),
  };
  for (const name of ['train', 'validation', 'test'] as const) {
    split.excluded.push(
      ...population[name]
        .filter((image) => !accepted(image))
        .map((image) => ({
          path: image.path,
          reason: `Manual restricted-palette exclusion (${name}): ${decisions.get(image.path)!.reason}`,
        })),
    );
  }
  split.excluded.push(
    ...paletteTrain
      .filter((image) => !eligible.has(image.path))
      .map((image) => ({
        path: image.path,
        reason:
          'Training histogram ambiguity: own class is not nearest with a 5% Euclidean margin in BOTH H/N and canonical 1024-bit spaces.',
      })),
  );
  const counts = split.classes.map(
    (_, i) => split.train.filter((image) => classIndex(split, image) === i).length,
  );
  const minimum = Math.min(...counts);
  if (minimum < minimumTrain) {
    throw new Error(
      `Insufficient strict histogram separation: training counts ${counts.join('/')}; require ${minimumTrain}/class. Do not silently relax the frozen rule.`,
    );
  }
  const random = seededRandom(population.seed + 1),
    train: AuditedImage[] = [];
  split.classes.forEach((label, i) => {
    const rows = shuffled(
      split.train.filter((image) => classIndex(split, image) === i),
      random,
    );
    train.push(...rows.slice(0, minimum));
    split.excluded.push(
      ...rows.slice(minimum).map((image) => ({
        path: image.path,
        reason:
          'Deterministic training-only balance after manual and histogram filtering; no duplication.',
      })),
    );
    const validation = split.validation.filter((image) => classIndex(split, image) === i).length,
      test = split.test.filter((image) => classIndex(split, image) === i).length;
    if (!validation || !test) {
      throw new Error(`No palette-eligible holdout for ${label.id}`);
    }
    split.counts[label.id] = {
      available: population.counts[label.id].available,
      excluded: population.counts[label.id].available - minimum - validation - test,
      train: minimum,
      validation,
      test,
    };
  });
  split.train = shuffled(train, random);
  split.excluded.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assertNoLeakage(split);
  return {
    split,
    centroids,
    trainingDecisions,
    paletteTrainCounts: centroids.trainingCounts,
    histogramTrainCounts: counts,
  };
}

export async function preparePaletteExperiment(
  audit: DatasetAudit,
  directory: string,
  reportDirectory: string,
  seed: number,
  exploratorySmallSample = false,
) {
  await mkdir(directory, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  const population = populationSplit(audit, seed);
  const populationText = JSON.stringify(population, null, 2);
  const anchor = resolve(reportDirectory, 'population-splits.json');
  const existing = await readFile(anchor, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (existing && digest(existing) !== digest(populationText)) {
    throw new Error(
      'The frozen GeoScene population split changed. Start a separately versioned experiment.',
    );
  }
  if (!existing) {
    await writeFile(anchor, populationText);
  }
  const decisions = new Map<string, ManualDecision>();
  const ledgerHashes: Record<string, string> = {};
  for (const label of population.classes) {
    const text = await readFile(
      resolve(reportDirectory, 'manual-review', `${label.id}-decisions.json`),
      'utf8',
    );
    const ledger = JSON.parse(text) as {
      reviewedPages: number[];
      images?: ManualDecision[];
      decisions?: ManualDecision[];
    };
    const rows = ledger.images ?? ledger.decisions;
    const expected = audit.images.filter(
      (image) => image.source === label.source && image.label === label.datasetLabel,
    );
    if (
      !rows ||
      rows.length !== expected.length ||
      new Set(rows.map((row) => row.path)).size !== expected.length
    ) {
      throw new Error(`Manual review is incomplete for ${label.id}`);
    }
    const expectedPages = Math.ceil(expected.length / 48);
    if (
      !Array.isArray(ledger.reviewedPages) ||
      new Set(ledger.reviewedPages).size !== expectedPages ||
      Array.from({ length: expectedPages }, (_, i) => i + 1).some(
        (page) => !ledger.reviewedPages.includes(page),
      )
    ) {
      throw new Error(`Manual sheet coverage is incomplete for ${label.id}`);
    }
    for (const row of rows) {
      const image = expected.find((item) => item.path === row.path);
      if (
        !image ||
        image.sha256 !== row.sha256 ||
        !['include', 'exclude'].includes(row.decision) ||
        !row.reason
      ) {
        throw new Error(`Stale or invalid manual decision: ${row.path}`);
      }
      decisions.set(row.path, row);
    }
    ledgerHashes[label.id] = digest(text);
  }
  const cache = await readFile(resolve(directory, 'histograms.bin'));
  const vectors = new Map<string, PaletteVector>();
  const vector = (image: AuditedImage) => {
    let value = vectors.get(image.path);
    if (!value) {
      const offset = image.featureIndex * 1024;
      if (offset < 0 || offset + 1024 > cache.length) {
        throw new Error('Incomplete raw histogram cache.');
      }
      const h = Array.from({ length: 256 }, (_, bin) => cache.readUInt32LE(offset + bin * 4));
      const total = h.reduce((a, b) => a + b, 0);
      if (!total) {
        throw new Error(`Empty histogram: ${image.path}`);
      }
      value = { share: h.map((n) => n / total), bits: encodeFourBits(quantizeHistogram(h)) };
      vectors.set(image.path, value);
    }
    return value;
  };
  const prepared = paletteSplit(population, decisions, vector, exploratorySmallSample ? 1 : 30);
  const subset = (name: SplitName) =>
    population[name].map((image) => ({
      path: image.path,
      classId: population.classes[classIndex(population, image)].id,
      paletteEligible: decisions.get(image.path)!.decision === 'include',
      ...histogramAdmission(vector(image), prepared.centroids),
    }));
  const metadata = {
    exploratorySmallSample,
    minimumThirtyPerClassPassed: Math.min(...prepared.histogramTrainCounts) >= 30,
    amendmentSha256: exploratorySmallSample
      ? digest(await readFile(resolve(reportDirectory, 'small-sample-amendment.md')))
      : null,
    preparedAt: new Date().toISOString(),
    protocolSha256: digest(await readFile(resolve(reportDirectory, 'protocol.md'))),
    ledgerHashes,
    populationSplitSha256: digest(populationText),
    scope:
      'Manual blue/cyan sea, green forest, warm sandy desert; training ambiguity filter in H/N and max15 bits. Holdout metrics must show palette coverage and full-population quality.',
    histogramMarginRatio: HISTOGRAM_MARGIN_RATIO,
    paletteTrainCounts: prepared.paletteTrainCounts,
    histogramTrainCounts: prepared.histogramTrainCounts,
    balancedTrainCounts: prepared.split.classes.map(
      (label) => prepared.split.counts[label.id].train,
    ),
    counts: prepared.split.counts,
    centroids: prepared.centroids,
    trainingDecisions: prepared.trainingDecisions,
    validationAdmission: subset('validation'),
    testAdmission: subset('test'),
  };
  await writeFile(resolve(directory, 'splits.json'), JSON.stringify(prepared.split, null, 2));
  await writeFile(resolve(reportDirectory, 'curation.json'), JSON.stringify(metadata, null, 2));
  await writeFile(
    resolve(reportDirectory, 'curated-splits.json'),
    JSON.stringify(prepared.split, null, 2),
  );
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  await writeFile(
    resolve(reportDirectory, 'exclusions.csv'),
    [
      'path,reason',
      ...prepared.split.excluded.map((row) => `${quote(row.path)},${quote(row.reason)}`),
    ].join('\n') + '\n',
  );
  return prepared;
}
