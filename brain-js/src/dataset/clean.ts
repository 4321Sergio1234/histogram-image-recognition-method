import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanTrainingConfig } from '../config/clean-training';
import { trainingConfig, datasetPaths } from '../config/training';
import { GEOSCENE_CATALOG, IGNORED_DATASET_LABELS } from '../core/scenes';
import { brightnessHistogram, encodeFourBits, quantizeHistogram } from '../features/histogram';
import { decodeImage } from '../image/decode';
import { imageFile, loadOrCreateAudit } from './audit';
import { histogramAdmission, type ManualDecision, type PaletteCentroids } from './palette';
import { assertNoLeakage, classIndex } from './split';
import { seededRandom, shuffled } from './random';
import type { DatasetSplit, FeatureSample, SplitName } from './types';

export type CleanPartition = SplitName | 'train-reserve';
export interface CleanFile {
  path: string;
  originalPath: string;
  classId: string;
  partition: CleanPartition;
  sha256: string;
  pixelSha256: string;
  group: string;
  width: number;
  height: number;
  histogramRatios: { share: number; bits: number };
}
export interface CleanManifest {
  schema: 'horizon-clean-dataset-v1';
  id: 'geoscene-clean-v1';
  fingerprint: string;
  sourceFingerprint: string;
  sourcePopulationSha256: string;
  sourceCurationSha256: string;
  seed: number;
  marginRatio: number;
  protocol: string;
  protocolSha256: string;
  sourcePopulationCounts: Record<SplitName, number>;
  counts: Record<CleanPartition, Record<string, number>>;
  files: CleanFile[];
  exclusions: { originalPath: string; partition: string; reason: string }[];
  centroids: PaletteCentroids;
  provenance: string;
}
export const digest = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const phases = ['train', 'validation', 'test', 'train-reserve'] as const;
export function cleanFingerprint(
  manifest: Omit<CleanManifest, 'fingerprint'> | CleanManifest,
): string {
  const data: Partial<CleanManifest> = { ...manifest };
  delete data.fingerprint;
  return digest(JSON.stringify(data));
}
const protocol = `# GeoScene clean dataset v1 — model revision 5.0.0

User explicitly requests physical cleaned train/validation/test folders under brain-js and training/evaluation from those files.
Preserve the existing source-photo group partition and all original files. Do not move known test examples into training.
Use the frozen manual palette ledgers, conservative visual reinspection exclusions (both wrong and correct controls), and the confirmed Desert1834 watermark exclusion.
Use the already frozen TRAIN-only centroids and unchanged 5% margin in BOTH H/N and canonical linear-max15 bits. Require the known own class nearest in both spaces, identically for train, validation and test. No ANN output selects membership.
Training is deterministically downsampled to the smallest class. Retain all other eligible train examples in train-reserve; they are not validation/test and are not used by the network.
The prior minimum30/class is not a blocker for this user-requested small-data revision; report every actual count and do not weaken histogram eligibility.
Copy originals byte-for-byte, with relative paths, hashes, groups and explicit exclusions. Train and evaluate by decoding these copied files, not by loading the old source feature cache. Fail on missing, modified, duplicate or unlisted images.
Compare the previously defined 8 candidates: max15/sqrt-max15 × []/[16]/[32]/[64], seed20260928, LR/momentum0.1, at most60 epochs, checkpoints every2, error threshold0.002. Highest validation accuracy per checkpoint, macro-F1 then earlier epoch; fewest parameters within1percentage point of best candidate. Freeze selection before test inference.
Primary validation/test have the SAME histogram eligibility as training. Report accuracy/F1 with per-class counts and coverage; no broad or unfiltered images are injected into primary evaluation.
These partitions and their images have already been inspected in previous experiments. This revision follows a post-test user decision and is not a new blind benchmark. The gate uses known labels and cannot detect out-of-domain user photos at runtime. Source/class confounding remains.
`;

/** Same own-class criterion for every phase; label and frozen train centroids only, never model outputs. */
export function strictEligibility(
  histogram: number[],
  ownIndex: number,
  centroids: PaletteCentroids,
) {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) {
    throw new Error('Empty histogram.');
  }
  const admission = histogramAdmission(
    {
      share: histogram.map((n) => n / total),
      bits: encodeFourBits(quantizeHistogram(histogram, 'max15')),
    },
    centroids,
  );
  const ratio = (values: number[]) =>
    values[ownIndex] / Math.min(...values.filter((_, i) => i !== ownIndex));
  return {
    eligible: admission.accepted && admission.nearestClassIndex === ownIndex,
    ratios: { share: ratio(admission.distances.share), bits: ratio(admission.distances.bits) },
  };
}

export async function prepareCleanDataset() {
  const source = trainingConfig;
  const audit = await loadOrCreateAudit(datasetPaths(), source.artifactsDirectory);
  const populationBytes = await readFile(
    resolve(source.reportDataDirectory, 'population-splits.json'),
  );
  const population = JSON.parse(populationBytes.toString()) as DatasetSplit;
  if (population.datasetFingerprint !== audit.fingerprint) {
    throw new Error('The frozen source population changed.');
  }
  assertNoLeakage(population);
  const curationBytes = await readFile(resolve(source.reportDataDirectory, 'curation.json'));
  const curation = JSON.parse(curationBytes.toString()) as {
    centroids: PaletteCentroids;
    ledgerHashes: Record<string, string>;
    populationSplitSha256: string;
  };
  if (digest(populationBytes) !== curation.populationSplitSha256) {
    throw new Error('Source population checksum changed.');
  }
  const decisions = new Map<string, ManualDecision>();
  for (const label of population.classes) {
    const bytes = await readFile(
      resolve(source.reportDataDirectory, 'manual-review', `${label.id}-decisions.json`),
    );
    if (digest(bytes) !== curation.ledgerHashes[label.id]) {
      throw new Error('Source manual review changed.');
    }
    const ledger = JSON.parse(bytes.toString()) as {
      images?: ManualDecision[];
      decisions?: ManualDecision[];
    };
    for (const row of ledger.images ?? ledger.decisions ?? []) {
      decisions.set(row.path, row);
    }
  }
  const reinspection = JSON.parse(
    await readFile(
      resolve(source.reportDataDirectory, 'sea-test-error-review/manual-reinspection.json'),
      'utf8',
    ),
  ) as { rows: { path: string; sha256: string; visualFinding: string; visualReason: string }[] };
  for (const row of reinspection.rows) {
    if (row.visualFinding !== 'palette_acceptable') {
      const original = decisions.get(row.path);
      if (!original || original.sha256 !== row.sha256) {
        throw new Error('Stale reinspection decision.');
      }
      decisions.set(row.path, {
        ...original,
        decision: 'exclude',
        reason: `Post-test visual reinspection: ${row.visualReason}`,
      });
    }
  }
  const postFreeze = JSON.parse(
    await readFile(resolve(source.reportDataDirectory, 'post-freeze-qa.json'), 'utf8'),
  ) as { missedArtifacts: { path: string; finding: string }[] };
  for (const row of postFreeze.missedArtifacts) {
    const original = decisions.get(row.path);
    if (!original) {
      throw new Error('Unknown post-freeze QA path.');
    }
    decisions.set(row.path, {
      ...original,
      decision: 'exclude',
      reason: `Confirmed artifact: ${row.finding}`,
    });
  }
  const cache = await readFile(resolve(source.artifactsDirectory, 'histograms.bin'));
  const files: CleanFile[] = [];
  const exclusions: CleanManifest['exclusions'] = population.excluded.map((row) => ({
    originalPath: row.path,
    partition: 'group-exclusion',
    reason: row.reason,
  }));
  for (const phase of ['train', 'validation', 'test'] as const) {
    for (const image of population[phase]) {
      const decision = decisions.get(image.path);
      if (!decision || decision.sha256 !== image.sha256) {
        throw new Error(`Missing or stale review: ${image.path}`);
      }
      if (decision.decision !== 'include') {
        exclusions.push({
          originalPath: image.path,
          partition: phase,
          reason: `Manual palette/composition exclusion: ${decision.reason}`,
        });
        continue;
      }
      const histogram = Array.from({ length: 256 }, (_, bin) =>
        cache.readUInt32LE(image.featureIndex * 1024 + bin * 4),
      );
      const gate = strictEligibility(histogram, classIndex(population, image), curation.centroids);
      if (!gate.eligible) {
        exclusions.push({
          originalPath: image.path,
          partition: phase,
          reason: `Strict own-class histogram rule failed in ${phase}; ratios H/N=${gate.ratios.share}, max15 bits=${gate.ratios.bits}; both must be <=0.95.`,
        });
        continue;
      }
      const classId = population.classes[classIndex(population, image)].id;
      files.push({
        path: `${phase}/${classId}/${basename(image.path)}`,
        originalPath: image.path,
        classId,
        partition: phase,
        sha256: image.sha256,
        pixelSha256: image.pixelSha256,
        group: image.group,
        width: image.width,
        height: image.height,
        histogramRatios: gate.ratios,
      });
    }
  }
  const smallest = Math.min(
    ...population.classes.map(
      (label) =>
        files.filter((row) => row.partition === 'train' && row.classId === label.id).length,
    ),
  );
  if (smallest < 1) {
    throw new Error('No strictly eligible training examples for one class.');
  }
  const random = seededRandom(population.seed + 1);
  for (const label of population.classes) {
    const own = shuffled(
      files.filter((row) => row.partition === 'train' && row.classId === label.id),
      random,
    );
    for (const row of own.slice(smallest)) {
      row.partition = 'train-reserve';
      row.path = `train-reserve/${row.classId}/${basename(row.originalPath)}`;
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  exclusions.sort((a, b) => a.originalPath.localeCompare(b.originalPath, 'en'));
  const counts = Object.fromEntries(
    phases.map((phase) => [
      phase,
      Object.fromEntries(
        population.classes.map((label) => [
          label.id,
          files.filter((row) => row.partition === phase && row.classId === label.id).length,
        ]),
      ),
    ]),
  ) as CleanManifest['counts'];
  for (const phase of ['train', 'validation', 'test'] as const) {
    if (Object.values(counts[phase]).some((n) => n < 1)) {
      throw new Error(`Empty ${phase} class after strict filtering.`);
    }
  }
  const data: Omit<CleanManifest, 'fingerprint'> = {
    schema: 'horizon-clean-dataset-v1',
    id: 'geoscene-clean-v1',
    sourceFingerprint: audit.fingerprint,
    sourcePopulationSha256: digest(populationBytes),
    sourceCurationSha256: digest(curationBytes),
    seed: population.seed,
    marginRatio: 0.95,
    protocol,
    protocolSha256: digest(protocol),
    sourcePopulationCounts: {
      train: population.train.length,
      validation: population.validation.length,
      test: population.test.length,
    },
    counts,
    files,
    exclusions,
    centroids: curation.centroids,
    provenance:
      'Only local GeoSceneNet16K originals. Sea/Forest byte-match prior Intel and Desert prior Landscape; source confounding persists. Same previously inspected group partition; post-test revised eligibility, not a fresh blind benchmark.',
  };
  const manifest: CleanManifest = { ...data, fingerprint: cleanFingerprint(data) };
  const destination = cleanTrainingConfig.datasetDirectory;
  const exists = await lstat(destination)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
  if (exists) {
    const current = await loadCleanDataset(destination);
    if (current.manifest.fingerprint !== manifest.fingerprint) {
      throw new Error(
        'Existing clean dataset differs; create a separately versioned dataset instead of overwriting it.',
      );
    }
    return current;
  }
  await mkdir(resolve(destination, '..'), { recursive: true });
  const temporary = await mkdtemp(`${destination}.building-`);
  try {
    for (const phase of phases) {
      for (const label of population.classes) {
        await mkdir(resolve(temporary, phase, label.id), { recursive: true });
      }
    }
    for (const row of files) {
      const image = audit.images.find((image) => image.path === row.originalPath)!;
      const sourceFile = imageFile(audit, image);
      if (digest(await readFile(sourceFile)) !== row.sha256) {
        throw new Error(`Source image changed: ${row.originalPath}`);
      }
      await copyFile(sourceFile, resolve(temporary, row.path));
    }
    await writeFile(resolve(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await writeFile(resolve(temporary, 'protocol.md'), protocol);
    const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
    await writeFile(
      resolve(temporary, 'exclusions.csv'),
      [
        'original_path,original_partition,reason',
        ...exclusions.map((row) =>
          [row.originalPath, row.partition, row.reason].map(quote).join(','),
        ),
      ].join('\n') + '\n',
    );
    await writeFile(
      resolve(temporary, 'README.md'),
      `# GeoScene clean dataset v1\n\nIdentical manual + histogram eligibility in train, validation and test. Original image bytes, no resizing.\n\n${phases.map((phase) => `- ${phase}: ${JSON.stringify(counts[phase])}`).join('\n')}\n\nOnly train/ is used for optimization. train-reserve/ contains eligible, unused training examples retained after balancing. No reserve image appears in a holdout.\n\nRun pnpm train and pnpm evaluate from repo/. Both read these copied files. manifest.json freezes paths, SHA-256, groups, ratios, counts and provenance; modifying images or membership is rejected.\n\nSmall Sea samples and reused test images limit the result. The model does not detect out-of-scope photos automatically. See protocol.md for the frozen rules.\n`,
    );
    await loadCleanDataset(temporary);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return loadCleanDataset(destination);
}

export interface CleanDataset {
  root: string;
  manifest: CleanManifest;
  manifestSha256: string;
  split: DatasetSplit;
}
export async function loadCleanDataset(
  root = cleanTrainingConfig.datasetDirectory,
): Promise<CleanDataset> {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  const manifest = JSON.parse(bytes.toString()) as CleanManifest;
  if (
    manifest.schema !== 'horizon-clean-dataset-v1' ||
    manifest.marginRatio !== 0.95 ||
    cleanFingerprint(manifest) !== manifest.fingerprint ||
    digest(manifest.protocol) !== manifest.protocolSha256 ||
    digest(await readFile(resolve(root, 'protocol.md'))) !== manifest.protocolSha256
  ) {
    throw new Error('Clean dataset manifest integrity failed.');
  }
  const paths = new Set<string>(),
    groups = new Set<string>(),
    hashes = new Set<string>();
  const split: DatasetSplit = {
    seed: manifest.seed,
    validationPercent: 15,
    datasetFingerprint: manifest.fingerprint,
    classes: [...GEOSCENE_CATALOG],
    ignoredClasses: { geoscene: [...IGNORED_DATASET_LABELS.geoscene] },
    train: [],
    validation: [],
    test: [],
    counts: {},
    excluded: manifest.exclusions.map((row) => ({ path: row.originalPath, reason: row.reason })),
  };
  for (const [index, row] of manifest.files.entries()) {
    const label = GEOSCENE_CATALOG.find((label) => label.id === row.classId);
    if (
      !label ||
      !phases.includes(row.partition) ||
      row.path !== `${row.partition}/${row.classId}/${basename(row.path)}` ||
      /[\\\0]/.test(row.path) ||
      ['.', '..'].includes(basename(row.path))
    ) {
      throw new Error('Unsafe or inconsistent clean dataset path.');
    }
    if (
      paths.has(row.path) ||
      groups.has(row.group) ||
      hashes.has(row.sha256) ||
      hashes.has(row.pixelSha256)
    ) {
      throw new Error('Duplicate image/group in clean dataset.');
    }
    paths.add(row.path);
    groups.add(row.group);
    hashes.add(row.sha256);
    hashes.add(row.pixelSha256);
    const file = resolve(root, row.path);
    if (!(await lstat(file)).isFile() || digest(await readFile(file)) !== row.sha256) {
      throw new Error(`Clean image integrity failed: ${row.path}`);
    }
    if (
      row.histogramRatios.share > 0.95 ||
      row.histogramRatios.bits > 0.95 ||
      !Number.isFinite(row.histogramRatios.share) ||
      !Number.isFinite(row.histogramRatios.bits)
    ) {
      throw new Error(`Unclean image admitted: ${row.path}`);
    }
    if (row.partition !== 'train-reserve') {
      split[row.partition].push({
        path: `geoscene/${row.path}`,
        source: 'geoscene',
        label: label.datasetLabel,
        section: row.partition,
        role: row.partition === 'test' ? 'test' : 'pool',
        sha256: row.sha256,
        pixelSha256: row.pixelSha256,
        group: row.group,
        width: row.width,
        height: row.height,
        bytes: 0,
        format: 'jpeg',
        extension: row.path.split('.').at(-1)!,
        featureIndex: index,
      });
    }
  }
  const scan = async (relative: string): Promise<string[]> => {
    const found: string[] = [];
    for (const row of await readdir(resolve(root, relative), { withFileTypes: true })) {
      const path = join(relative, row.name);
      if (row.isSymbolicLink()) {
        throw new Error('Symlinks are not accepted in clean image partitions.');
      }
      if (row.isDirectory()) {
        found.push(...(await scan(path)));
      } else if (row.name !== '.DS_Store') {
        found.push(path);
      }
    }
    return found;
  };
  for (const phase of phases) {
    const partition = await lstat(resolve(root, phase));
    if (!partition.isDirectory() || partition.isSymbolicLink()) {
      throw new Error('Clean partitions must be physical directories, not symlinks.');
    }
    const actual = await scan(phase);
    if (
      actual.some((path) => !paths.has(path)) ||
      actual.length !== manifest.files.filter((row) => row.partition === phase).length
    ) {
      throw new Error(`Unexpected/unlisted files in ${phase}.`);
    }
    for (const label of GEOSCENE_CATALOG) {
      if (
        manifest.counts[phase][label.id] !==
        manifest.files.filter((row) => row.partition === phase && row.classId === label.id).length
      ) {
        throw new Error('Clean class counts mismatch.');
      }
    }
  }
  for (const label of GEOSCENE_CATALOG) {
    const count = {
      train: manifest.counts.train[label.id],
      validation: manifest.counts.validation[label.id],
      test: manifest.counts.test[label.id],
    };
    if (Object.values(count).some((n) => n < 1)) {
      throw new Error('Empty clean split class.');
    }
    split.counts[label.id] = {
      ...count,
      available: manifest.files.filter((row) => row.classId === label.id).length,
      excluded: manifest.counts['train-reserve'][label.id],
    };
  }
  assertNoLeakage(split);
  return { root, manifest, manifestSha256: digest(bytes), split };
}

/** Decode exactly this physical partition and recheck eligibility; old source caches are never used. */
export async function readCleanHistograms(dataset: CleanDataset, phase: SplitName) {
  const rows = dataset.manifest.files.filter((row) => row.partition === phase);
  const result: { row: CleanFile; histogram: number[]; classIndex: number }[] = [];
  for (const row of rows) {
    const file = resolve(dataset.root, row.path);
    if (digest(await readFile(file)) !== row.sha256) {
      throw new Error(`Clean image changed: ${row.path}`);
    }
    const decoded = await decodeImage(file);
    const histogram = brightnessHistogram(decoded.rgba),
      ownIndex = GEOSCENE_CATALOG.findIndex((label) => label.id === row.classId);
    const gate = strictEligibility(histogram, ownIndex, dataset.manifest.centroids);
    if (
      !gate.eligible ||
      Math.abs(gate.ratios.share - row.histogramRatios.share) > 1e-12 ||
      Math.abs(gate.ratios.bits - row.histogramRatios.bits) > 1e-12
    ) {
      throw new Error(`Copied image fails its frozen histogram rule: ${row.path}`);
    }
    result.push({ row, histogram, classIndex: ownIndex });
  }
  return result;
}
export function cleanSamples(
  rows: Awaited<ReturnType<typeof readCleanHistograms>>,
  normalization: 'max15' | 'sqrt-max15',
): FeatureSample[] {
  return rows.map(({ row, histogram, classIndex: index }) => ({
    input: encodeFourBits(quantizeHistogram(histogram, normalization)),
    output: GEOSCENE_CATALOG.map((_, i) => Number(i === index)),
    classIndex: index,
    path: row.path,
  }));
}
