import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { SCENE_CATALOG, DATASETS, type DatasetId } from '../core/scenes';
import { brightnessHistogram, encodeFourBits, quantizeHistogram } from '../features/histogram';
import { decodeImage } from '../image/decode';
import { digest } from './clean';
import { imageFile, loadOrCreateAudit } from './audit';
import { seededRandom, shuffled } from './random';
import { assertNoLeakage } from './split';
import type { AuditedImage, DatasetSplit, FeatureSample, SplitName } from './types';
import type { OperationLog } from '../cli/progress';
import { workspaceRoot } from '../config/training';

export const CURATED_PROTOCOL = `# Curated scene data v2

Revision authorized 4 October 2026: inspect all dataset folders in docs, use more independent data, and relax filters where needed.
Only labeled Sea/Ocean/Coast, Forest and Desert originals are candidates. Unlabeled prediction images, TFRecords, source PDFs, model files, benchmark photos and report figures are not training data.
Combine GeoSceneNet16K, Intel and Landscape collections. Union existing near-copy groups and exact byte/pixel hashes across collections; conflicting-label groups are excluded. Each group contributes one unmodified original.
Preserve the prior GeoScene 70/15/15 group assignments. A prior validation/test group is never moved into training. Official test groups take test priority; official Landscape validation groups take validation priority. Split previously unassigned pool groups 70/15/15, seed 20261004, before inspecting their features. Existing experiments have seen some of these photos: this is not a fresh blind benchmark.
Preserve known manual wrong-palette/composition/artifact exclusions, including the already recorded conservative visual reinspection decisions and confirmed watermarks. A preparer audit found that the first v2 materialization omitted the separate reinspection ledger; that exploratory dataset/run is archived and these pre-existing exclusions are restored before this replacement run. No new-model test errors determine exclusions. Apply an additional identical numerical HSV palette screen in every split: >=12% blue/cyan saturated pixels for Sea, >=12% green for Forest, >=18% warm sand for Desert. The new-source screen is automatic, not an exhaustive new manual review. Palette color is used only for dataset curation, never as ANN input.
Fit class-average sqrt(H/N) brightness vectors ONLY on palette-eligible TRAIN groups. Admit a palette-eligible image iff its own-class Euclidean distance to that mean is strictly less than the nearest other-class distance (ratio <1). This is a Hellinger-type comparison of brightness distributions. Remove the old independent binary-bit centroid veto and 5% margin; do not filter on ANN predictions or test errors. Freeze centroids and this rule before applying them to validation/test. Apply precisely the same rule to all three splits.
Use ALL admitted training groups, no smallest-class downsampling or unused reserve. Keep counts, per-class metrics, coverage, exclusions and known source confounding visible. Class imbalance is not solved by pretending duplicated images are independent.
Materialize native originals as split/extension/resolution/class/hash-name. Resolution groups are small (long edge <=256), medium (<=1024), large (>1024); they describe dimensions, not measured perceptual quality. No upscaling or generated training pictures.
Training CLI may select one or multiple training folders. Subsets never change validation/test or centroids, cannot include holdouts, and must retain every output class. Freeze exact selected paths and hashes in each run. Choose epochs, LR, architecture and normalization on validation only; evaluate test after selection is frozen. Never delete failures.
`;

export interface CuratedFile {
  path: string;
  originalPath: string;
  source: string;
  classId: string;
  partition: SplitName;
  sha256: string;
  pixelSha256: string;
  group: string;
  width: number;
  height: number;
  extension: string;
  resolution: string;
  paletteShare: number;
  histogramRatio: number;
}
export interface CuratedManifest {
  schema: 'horizon-curated-dataset-v2';
  id: string;
  fingerprint: string;
  protocolSha256: string;
  seed: number;
  sources: { id: DatasetId; name: string; url: string; fingerprint: string; audited: number }[];
  centroids: number[][];
  centroidTrainingCounts: number[];
  files: CuratedFile[];
  counts: Record<SplitName, Record<string, number>>;
  populationCounts: Record<SplitName, Record<string, number>>;
  exclusions: { originalPath: string; reason: string }[];
  inventory: {
    auditedImages: number;
    labeledCandidates: number;
    independentGroups: number;
    copiedImages: number;
    unlabeledExcluded: number;
  };
  priorPopulationSha256: string;
}
const phases = ['train', 'validation', 'test'] as const;
const classes = SCENE_CATALOG.map((c) => c.id);
export function curatedFingerprint(manifest: CuratedManifest): string {
  const rest: Partial<CuratedManifest> = { ...manifest };
  delete rest.fingerprint;
  return digest(JSON.stringify(rest));
}
export function sourceClass(source: string, label: string | null): string | undefined {
  const mapping: Record<string, Record<string, string>> = {
    geoscene: { 'sea or ocean': 'sea', 'forest area': 'forest', desert: 'desert' },
    intel: { sea: 'sea', forest: 'forest' },
    landscape: { coast: 'sea', forest: 'forest', desert: 'desert' },
  };
  return label ? mapping[source]?.[label.toLowerCase()] : undefined;
}
export function resolutionGroup(width: number, height: number): string {
  return Math.max(width, height) <= 256
    ? 'small'
    : Math.max(width, height) <= 1024
      ? 'medium'
      : 'large';
}
export function paletteShare(rgba: Uint8Array, classId: string): number {
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255,
      g = rgba[i + 1] / 255,
      b = rgba[i + 2] / 255;
    const high = Math.max(r, g, b),
      low = Math.min(r, g, b),
      delta = high - low;
    const saturation = high ? delta / high : 0;
    if (saturation < 0.12 || high < 0.12 || !delta) {
      continue;
    }
    let hue =
      high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    if (
      (classId === 'sea' && hue >= 170 && hue <= 250) ||
      (classId === 'forest' && hue >= 65 && hue <= 165) ||
      (classId === 'desert' && hue >= 15 && hue <= 65)
    ) {
      count++;
    }
  }
  return count / (rgba.length / 4);
}
const threshold = (id: string) => (id === 'desert' ? 0.18 : 0.12);
export function brightnessVector(histogram: number[]): number[] {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (!total) {
    throw new Error('Empty histogram');
  }
  return histogram.map((n) => Math.sqrt(n / total));
}
export function brightnessRatio(vector: number[], own: number, centroids: number[][]): number {
  const distances = centroids.map((c) =>
    Math.sqrt(c.reduce((sum, value, i) => sum + (value - vector[i]) ** 2, 0)),
  );
  const other = Math.min(...distances.filter((_, i) => i !== own));
  return other > 0 ? distances[own] / other : Infinity;
}

/** Existing source-photo relations plus aliases across all audited collections. */
export function unifiedGroups(images: AuditedImage[]): Map<string, string> {
  const parents = images.map((_, i) => i),
    seen = new Map<string, number>();
  const find = (i: number): number => (parents[i] === i ? i : (parents[i] = find(parents[i])));
  images.forEach((image, i) => {
    for (const key of [
      `${image.source}:${image.group}`,
      `bytes:${image.sha256}`,
      `pixels:${image.pixelSha256}`,
    ]) {
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, i);
      } else {
        parents[find(i)] = find(previous);
      }
    }
  });
  const representatives = new Map<number, string>();
  images.forEach((image, i) => {
    const root = find(i),
      current = representatives.get(root);
    if (!current || image.sha256 < current) {
      representatives.set(root, image.sha256);
    }
  });
  return new Map(images.map((image, i) => [image.path, representatives.get(find(i))!]));
}

export async function prepareCuratedDataset(docs: string, destination: string, log: OperationLog) {
  if (
    await lstat(resolve(destination, 'manifest.json'))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      })
  ) {
    const existing = await loadCuratedDataset(destination);
    log.event('existing-dataset-verified', { fingerprint: existing.manifest.fingerprint });
    return existing;
  }
  // These full-decode caches predate this revision. File bytes are checked again before use/copy.
  const packageRoot = workspaceRoot;
  const geo = await loadOrCreateAudit(
    { geoscene: resolve(docs, 'GeoSceneNet16K') },
    resolve(packageRoot, 'brain-js/artifacts/geoscene-palette-v1'),
  );
  const other = await loadOrCreateAudit(
    { intel: resolve(docs, 'Dataset'), landscape: resolve(docs, 'archive') },
    resolve(packageRoot, 'brain-js/artifacts'),
  );
  for (const audit of [geo, other]) {
    for (const source of audit.sources) {
      source.root =
        source.id === 'geoscene'
          ? resolve(docs, 'GeoSceneNet16K')
          : source.id === 'intel'
            ? resolve(docs, 'Dataset')
            : resolve(docs, 'archive');
    }
  }
  const images = [...geo.images, ...other.images];
  const candidates = images.filter((image) => sourceClass(image.source, image.label));
  const groups = unifiedGroups(images);
  const review = await lstat(resolve(docs, 'lab2/data/geoscene-palette'))
    .then(() => resolve(docs, 'lab2/data/geoscene-palette'))
    .catch(() =>
      resolve(workspaceRoot, 'brain-js/data/scenes-curated-v2/provenance/geoscene-palette'),
    );
  const populationBytes = await readFile(resolve(review, 'population-splits.json'));
  const prior = JSON.parse(populationBytes.toString()) as DatasetSplit;
  const anchors = new Map<string, SplitName>();
  for (const phase of phases) {
    for (const row of prior[phase]) {
      anchors.set(groups.get(row.path)!, phase);
    }
  }
  const rejected = new Map<string, string>();
  for (const id of classes) {
    const ledger = JSON.parse(
      await readFile(resolve(review, `manual-review/${id}-decisions.json`), 'utf8'),
    ) as {
      images?: { sha256: string; decision: string; reason: string }[];
      decisions?: { sha256: string; decision: string; reason: string }[];
    };
    for (const row of ledger.images ?? ledger.decisions ?? []) {
      if (row.decision === 'exclude') {
        rejected.set(row.sha256, row.reason);
      }
    }
  }
  const qa = JSON.parse(await readFile(resolve(review, 'post-freeze-qa.json'), 'utf8')) as {
    missedArtifacts: { path: string; finding: string }[];
  };
  for (const row of qa.missedArtifacts) {
    const image = images.find((image) => image.path === row.path);
    if (image) {
      rejected.set(image.sha256, row.finding);
    }
  }
  const reinspection = JSON.parse(
    await readFile(resolve(review, 'sea-test-error-review/manual-reinspection.json'), 'utf8'),
  ) as { rows: { sha256: string; visualFinding: string; visualReason: string }[] };
  for (const row of reinspection.rows) {
    if (row.visualFinding !== 'palette_acceptable') {
      rejected.set(row.sha256, `Prior visual reinspection: ${row.visualReason}`);
    }
  }
  const byGroup = new Map<string, AuditedImage[]>();
  for (const row of candidates) {
    const group = groups.get(row.path)!;
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  const exclusions: CuratedManifest['exclusions'] = [];
  const assigned: { image: AuditedImage; group: string; phase?: SplitName; classId: string }[] = [];
  for (const [group, members] of byGroup) {
    const labels = new Set(members.map((row) => sourceClass(row.source, row.label)!));
    if (labels.size > 1) {
      members.forEach((row) =>
        exclusions.push({
          originalPath: row.path,
          reason: 'Conflicting labels in duplicate group',
        }),
      );
      continue;
    }
    const bad = members.find((row) => rejected.has(row.sha256));
    if (bad) {
      members.forEach((row) =>
        exclusions.push({
          originalPath: row.path,
          reason: `Preserved manual exclusion: ${rejected.get(bad.sha256)}`,
        }),
      );
      continue;
    }
    const phase: SplitName | undefined =
      members.some((row) => row.role === 'test') || anchors.get(group) === 'test'
        ? 'test'
        : anchors.get(group) === 'validation' ||
            members.some((row) => row.source === 'landscape' && row.section === 'Validation Data')
          ? 'validation'
          : anchors.get(group);
    const image = members.sort((a, b) => a.path.localeCompare(b.path, 'en'))[0];
    members.slice(1).forEach((row) =>
      exclusions.push({
        originalPath: row.path,
        reason: `Duplicate/near-copy alias of ${image.path}`,
      }),
    );
    assigned.push({ image, group, phase, classId: [...labels][0] });
  }
  const random = seededRandom(20261004);
  for (const id of classes) {
    const pool = shuffled(
      assigned
        .filter((row) => row.classId === id && !row.phase)
        .sort((a, b) => a.group.localeCompare(b.group)),
      random,
    );
    pool.forEach((row, index) => {
      row.phase =
        index < Math.floor(pool.length * 0.15)
          ? 'test'
          : index < Math.floor(pool.length * 0.3)
            ? 'validation'
            : 'train';
    });
  }
  const counts = () =>
    Object.fromEntries(
      phases.map((phase) => [phase, Object.fromEntries(classes.map((id) => [id, 0]))]),
    ) as CuratedManifest['counts'];
  const populationCounts = counts();
  for (const row of assigned) {
    populationCounts[row.phase!][row.classId]++;
  }
  await mkdir(destination, { recursive: true });
  if (
    await lstat(resolve(destination, 'manifest.json'))
      .then(() => true)
      .catch(() => false)
  ) {
    throw new Error('Dataset already exists; choose a new destination or inspect it.');
  }
  await writeFile(resolve(destination, 'protocol.md'), CURATED_PROTOCOL);
  log.event('protocol-frozen', {
    sha256: digest(CURATED_PROTOCOL),
    groups: assigned.length,
    populationCounts,
  });
  const eligible: { row: (typeof assigned)[number]; vector: number[]; palette: number }[] = [];
  let complete = 0,
    cursor = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < assigned.length) {
        const row = assigned[cursor++];
        const audit = row.image.source === 'geoscene' ? geo : other;
        const path = imageFile(audit, row.image);
        if (digest(await readFile(path)) !== row.image.sha256) {
          throw new Error(`Source changed: ${row.image.path}`);
        }
        const decoded = await decodeImage(path),
          palette = paletteShare(decoded.rgba, row.classId);
        if (palette >= threshold(row.classId)) {
          eligible.push({
            row,
            vector: brightnessVector(brightnessHistogram(decoded.rgba)),
            palette,
          });
        } else {
          exclusions.push({
            originalPath: row.image.path,
            reason: `Canonical HSV palette share ${palette.toFixed(6)} < ${threshold(row.classId)}`,
          });
        }
        complete++;
        if (complete % 100 === 0 || complete === assigned.length) {
          log.progress('palette-images', complete, assigned.length);
        }
      }
    }),
  );
  eligible.sort((a, b) => a.row.image.path.localeCompare(b.row.image.path, 'en'));
  const train = eligible.filter((row) => row.row.phase === 'train');
  const centroidTrainingCounts = classes.map(
    (id) => train.filter((row) => row.row.classId === id).length,
  );
  if (centroidTrainingCounts.some((n) => !n)) {
    throw new Error('Palette filter emptied a training class');
  }
  const centroids = classes.map((id, k) =>
    Array.from(
      { length: 256 },
      (_, i) =>
        train.filter((row) => row.row.classId === id).reduce((sum, row) => sum + row.vector[i], 0) /
        centroidTrainingCounts[k],
    ),
  );
  await writeFile(
    resolve(destination, 'frozen-centroids.json'),
    JSON.stringify(
      { centroids, centroidTrainingCounts, trainingGroups: train.map((row) => row.row.group) },
      null,
      2,
    ),
  );
  log.event('centroids-frozen-training-only', { centroidTrainingCounts });
  const files: CuratedFile[] = [],
    finalCounts = counts();
  for (const { row, vector, palette } of eligible) {
    const ratio = brightnessRatio(vector, classes.indexOf(row.classId), centroids);
    if (ratio >= 1) {
      exclusions.push({
        originalPath: row.image.path,
        reason: `Own brightness centroid is not strictly nearest: ratio ${ratio}`,
      });
      continue;
    }
    const extension = extname(row.image.path).slice(1).toLowerCase(),
      resolution = resolutionGroup(row.image.width, row.image.height);
    const path = `${row.phase}/${extension}/${resolution}/${row.classId}/${row.image.sha256.slice(0, 16)}-${basename(row.image.path)}`;
    await mkdir(resolve(destination, path, '..'), { recursive: true });
    await copyFile(
      imageFile(row.image.source === 'geoscene' ? geo : other, row.image),
      resolve(destination, path),
    );
    files.push({
      path,
      originalPath: row.image.path,
      source: row.image.source,
      classId: row.classId,
      partition: row.phase!,
      sha256: row.image.sha256,
      pixelSha256: row.image.pixelSha256,
      group: row.group,
      width: row.image.width,
      height: row.image.height,
      extension,
      resolution,
      paletteShare: palette,
      histogramRatio: ratio,
    });
    finalCounts[row.phase!][row.classId]++;
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  exclusions.sort((a, b) => a.originalPath.localeCompare(b.originalPath, 'en'));
  const manifest: CuratedManifest = {
    schema: 'horizon-curated-dataset-v2',
    id: 'scenes-curated-v2',
    fingerprint: '',
    protocolSha256: digest(CURATED_PROTOCOL),
    seed: 20261004,
    sources: [...geo.sources, ...other.sources].map((s) => ({
      id: s.id as DatasetId,
      name: s.name,
      url: s.url,
      fingerprint: s.id === 'geoscene' ? geo.fingerprint : other.fingerprint,
      audited: images.filter((row) => row.source === s.id).length,
    })),
    centroids,
    centroidTrainingCounts,
    files,
    counts: finalCounts,
    populationCounts,
    exclusions,
    inventory: {
      auditedImages: images.length,
      labeledCandidates: candidates.length,
      independentGroups: byGroup.size,
      copiedImages: files.length,
      unlabeledExcluded: images.filter((row) => !row.label).length,
    },
    priorPopulationSha256: digest(populationBytes),
  };
  manifest.fingerprint = curatedFingerprint(manifest);
  await writeFile(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  await writeFile(
    resolve(destination, 'exclusions.csv'),
    'original_path,reason\n' +
      exclusions.map((row) => [row.originalPath, row.reason].map(quote).join(',')).join('\n') +
      '\n',
  );
  await writeFile(
    resolve(destination, 'README.md'),
    `# Curated scene dataset v2\n\nNative originals, one per source-photo group. See protocol.md for criteria and limitations.\n\n\`\`\`json\n${JSON.stringify(finalCounts, null, 2)}\n\`\`\`\n\nFolders: split / original extension / resolution / class. Select root or several training subfolders via the CLI. All admitted training images are used. Validation and test stay separate. No generated or upscaled images.\n\nSources and original paths are recorded in manifest.json. GeoScene aliases Intel/Landscape; deduplication prevents counting these aliases as independent data. Existing holdouts were inspected previously, so these are conditional, reused test results.\n`,
  );
  log.event('dataset-prepared', { fingerprint: manifest.fingerprint, counts: finalCounts });
  return loadCuratedDataset(destination);
}

export interface CuratedDataset {
  root: string;
  manifest: CuratedManifest;
  manifestSha256: string;
  split: DatasetSplit;
}
export async function loadCuratedDataset(root: string): Promise<CuratedDataset> {
  const bytes = await readFile(resolve(root, 'manifest.json')),
    manifest = JSON.parse(bytes.toString()) as CuratedManifest;
  if (
    manifest.schema !== 'horizon-curated-dataset-v2' ||
    curatedFingerprint(manifest) !== manifest.fingerprint ||
    digest(await readFile(resolve(root, 'protocol.md'))) !== manifest.protocolSha256
  ) {
    throw new Error('Curated manifest/protocol integrity failed');
  }
  const paths = new Set<string>(),
    groups = new Set<string>(),
    hashes = new Set<string>();
  const split: DatasetSplit = {
    seed: manifest.seed,
    validationPercent: 15,
    datasetFingerprint: manifest.fingerprint,
    classes: [...SCENE_CATALOG],
    ignoredClasses: {},
    train: [],
    validation: [],
    test: [],
    counts: {},
    excluded: manifest.exclusions.map((row) => ({ path: row.originalPath, reason: row.reason })),
  };
  for (const [index, row] of manifest.files.entries()) {
    if (
      !phases.includes(row.partition) ||
      !classes.includes(row.classId) ||
      row.path !==
        `${row.partition}/${row.extension}/${row.resolution}/${row.classId}/${basename(row.path)}` ||
      /[\\\0]/.test(row.path) ||
      row.path.split('/').some((p) => ['.', '..'].includes(p)) ||
      row.resolution !== resolutionGroup(row.width, row.height)
    ) {
      throw new Error('Unsafe/inconsistent dataset path');
    }
    if (
      paths.has(row.path) ||
      groups.has(row.group) ||
      hashes.has(row.sha256) ||
      hashes.has(row.pixelSha256)
    ) {
      throw new Error('Duplicate source-photo group/hash');
    }
    paths.add(row.path);
    groups.add(row.group);
    hashes.add(row.sha256);
    hashes.add(row.pixelSha256);
    if (
      !(await lstat(resolve(root, row.path))).isFile() ||
      digest(await readFile(resolve(root, row.path))) !== row.sha256
    ) {
      throw new Error(`Image integrity failed: ${row.path}`);
    }
    if (
      !Number.isFinite(row.histogramRatio) ||
      row.histogramRatio < 0 ||
      row.histogramRatio >= 1 ||
      row.paletteShare < threshold(row.classId)
    ) {
      throw new Error(`Unclean image: ${row.path}`);
    }
    const label = SCENE_CATALOG[classes.indexOf(row.classId)];
    split[row.partition].push({
      path: row.path,
      source: label.source,
      section: row.partition,
      role: row.partition === 'test' ? 'test' : 'pool',
      label: label.datasetLabel,
      bytes: 0,
      format: row.extension === 'jpg' ? 'jpeg' : row.extension,
      extension: row.extension,
      sha256: row.sha256,
      pixelSha256: row.pixelSha256,
      group: row.group,
      width: row.width,
      height: row.height,
      featureIndex: index,
    });
  }
  async function scan(directory: string): Promise<string[]> {
    if (!(await lstat(resolve(root, directory))).isDirectory()) {
      throw new Error('Dataset partitions must be physical directories');
    }
    const result: string[] = [];
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        result.push(...(await scan(path)));
      } else if (entry.isFile()) {
        result.push(path);
      } else {
        throw new Error('Symlinks are not dataset images');
      }
    }
    return result;
  }
  for (const phase of phases) {
    const found = await scan(phase);
    if (found.some((path) => !paths.has(path)) || found.length !== split[phase].length) {
      throw new Error('Unexpected/unlisted dataset image');
    }
    for (const id of classes) {
      if (
        manifest.counts[phase][id] !==
        manifest.files.filter((row) => row.partition === phase && row.classId === id).length
      ) {
        throw new Error('Manifest class count mismatch');
      }
    }
  }
  for (const id of classes) {
    const counts = {
      train: manifest.counts.train[id],
      validation: manifest.counts.validation[id],
      test: manifest.counts.test[id],
    };
    if (Object.values(counts).some((n) => n < 1)) {
      throw new Error('Empty dataset class');
    }
    split.counts[id] = {
      ...counts,
      available: Object.values(counts).reduce((a, b) => a + b, 0),
      excluded: 0,
    };
  }
  assertNoLeakage(split);
  return { root, manifest, manifestSha256: digest(bytes), split };
}

/** Folder selection operates on train only, keeps exact hashes, and never changes holdouts. */
export function selectTrainingFiles(
  dataset: CuratedDataset,
  folders: string[] = [],
  limit?: number,
) {
  const prefixes = folders.map((folder) => {
    const absolute = resolve(dataset.root, folder),
      training = resolve(dataset.root, 'train');
    if (absolute === resolve(dataset.root)) {
      return 'train/';
    }
    if (absolute !== training && !absolute.startsWith(training + '/')) {
      throw new Error('Select the dataset root or training folders only; holdouts cannot train');
    }
    return absolute.slice(resolve(dataset.root).length + 1) + '/';
  });
  let files = dataset.manifest.files.filter(
    (row) =>
      row.partition === 'train' &&
      (!prefixes.length || prefixes.some((prefix) => row.path.startsWith(prefix))),
  );
  if (limit !== undefined && files.length > limit) {
    if (limit < classes.length) {
      throw new Error('Training limit must retain all classes');
    }
    const random = seededRandom(dataset.manifest.seed),
      byClass = classes.map((id) =>
        shuffled(
          files.filter((row) => row.classId === id),
          random,
        ),
      );
    const selected: CuratedFile[] = [];
    for (let index = 0; selected.length < limit; index++) {
      for (const own of byClass) {
        if (own[index] && selected.length < limit) {
          selected.push(own[index]);
        }
      }
    }
    files = selected.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  }
  if (classes.some((id) => !files.some((row) => row.classId === id))) {
    throw new Error('Selected training folders must include Sea, Forest and Desert');
  }
  return files;
}

export async function readCuratedSamples(
  dataset: CuratedDataset,
  phase: SplitName,
  normalization: 'max15' | 'sqrt-max15',
  log: OperationLog,
  files = dataset.manifest.files.filter((row) => row.partition === phase),
): Promise<FeatureSample[]> {
  const result: FeatureSample[] = [];
  for (const [index, row] of files.entries()) {
    if (row.partition !== phase) {
      throw new Error('Requested phase differs from selected file');
    }
    const path = resolve(dataset.root, row.path);
    if (digest(await readFile(path)) !== row.sha256) {
      throw new Error('Image changed after integrity check');
    }
    const decoded = await decodeImage(path),
      histogram = brightnessHistogram(decoded.rgba),
      classIndex = classes.indexOf(row.classId);
    const ratio = brightnessRatio(
      brightnessVector(histogram),
      classIndex,
      dataset.manifest.centroids,
    );
    if (
      ratio >= 1 ||
      Math.abs(ratio - row.histogramRatio) > 1e-12 ||
      paletteShare(decoded.rgba, row.classId) < threshold(row.classId)
    ) {
      throw new Error('Copied image fails frozen curation rule');
    }
    result.push({
      input: encodeFourBits(quantizeHistogram(histogram, normalization)),
      output: classes.map((_, i) => Number(i === classIndex)),
      classIndex,
      path: row.path,
    });
    if ((index + 1) % 25 === 0 || index + 1 === files.length) {
      log.progress(`${phase}-images`, index + 1, files.length);
    }
  }
  return result;
}

export function curatedSources(manifest: CuratedManifest) {
  return manifest.sources.map((source) => ({
    id: source.id,
    name: DATASETS[source.id].name,
    url: source.url,
    selectedClasses: DATASETS[source.id].labels.filter((label) => sourceClass(source.id, label)),
    ignoredClasses: DATASETS[source.id].labels.filter((label) => !sourceClass(source.id, label)),
  }));
}
