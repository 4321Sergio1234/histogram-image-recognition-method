import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeImage } from '../image/decode';
import { imageFormat, normalizedExtension } from '../image/format';
import { extractFeatures } from '../features/histogram';
import {
  DATASETS,
  GEOSCENE_CATALOG,
  IGNORED_DATASET_LABELS,
  SCENE_CATALOG,
  type DatasetId,
  type SectionRole,
} from '../core/scenes';
import { discoverLayout, isSystemFile } from './layout';
import { assignGroups } from './grouping';
import sharp from 'sharp';
import { findNearDuplicates, perceptualHash } from './perceptual';
import type { AuditedImage, AuditedSource, DatasetAudit, SkippedFile } from './types';

const UNLABELED = '(unlabeled)';
export type SourceRoots = Partial<Record<DatasetId, string>>;

async function filesBelow(root: string, ignored: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    const path = resolve(root, entry.name);
    if (isSystemFile(entry.name)) {
      ignored.push(path);
    } else if (entry.isDirectory()) {
      files.push(...(await filesBelow(path, ignored)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

/** Absolute file for an audited image; `path` carries the source id as its first segment. */
export function imageFile(
  audit: Pick<DatasetAudit, 'sources'>,
  image: Pick<AuditedImage, 'path' | 'source'>,
): string {
  const source = audit.sources.find((item) => item.id === image.source);
  if (!source) {
    throw new Error(`Unknown dataset source for ${image.path}`);
  }
  return resolve(source.root, image.path.slice(image.source.length + 1));
}

/** Fully decodes every image of every source, hashes originals and pixels, and caches canonical features. */
export async function auditDataset(roots: SourceRoots, output: string): Promise<DatasetAudit> {
  const files: {
    file: string;
    path: string;
    source: string;
    section: string;
    role: SectionRole;
    label: string | null;
  }[] = [];
  const systemFiles: string[] = [];
  const sources: AuditedSource[] = [];
  for (const [id, root] of Object.entries(roots) as [DatasetId, string][]) {
    const dataset = DATASETS[id];
    const layout = await discoverLayout(root, dataset);
    const all = await filesBelow(root, systemFiles);
    const inSections = new Set<string>();
    for (const section of layout.sections) {
      const folders = section.labeled
        ? section.classes
        : [{ label: null, directory: section.directory }];
      for (const folder of folders) {
        for (const file of await filesBelow(resolve(root, folder.directory), [])) {
          inSections.add(file);
          files.push({
            file,
            path: `${id}/${relative(root, file).split('\\').join('/')}`,
            source: id,
            section: section.name,
            role: section.role,
            label: folder.label,
          });
        }
      }
    }
    const outsideSections: Record<string, number> = {};
    for (const file of all.filter((item) => !inSections.has(item))) {
      const extension = extname(file).slice(1).toLowerCase() || '(none)';
      outsideSections[extension] = (outsideSections[extension] ?? 0) + 1;
    }
    sources.push({
      id,
      name: dataset.name,
      url: dataset.url,
      root,
      sections: layout.sections.map((section) => ({
        name: section.name,
        role: section.role,
        directory: section.directory,
        labeled: section.labeled,
        classes: section.classes.map((folder) => folder.label),
      })),
      counts: {},
      dimensions: {},
      outsideSections,
      selectedClasses: [...SCENE_CATALOG, ...GEOSCENE_CATALOG]
        .filter((scene) => scene.source === id)
        .map((scene) => scene.datasetLabel),
      ignoredClasses: [...IGNORED_DATASET_LABELS[id]],
    });
  }
  const featureBuffer = Buffer.alloc(files.length * 1024);
  const histogramBuffer = Buffer.alloc(files.length * 1024);
  const images: AuditedImage[] = [];
  const thumbnails = new Map<string, Uint8Array>();
  const unreadable: SkippedFile[] = [];
  const formats: Record<string, number> = {};
  const extensionCounts: Record<string, number> = {};
  const formatMismatches: DatasetAudit['formatMismatches'] = [];
  const bySource = new Map(sources.map((source) => [source.id, source]));
  let cursor = 0;
  let complete = 0;
  console.log(
    `Auditing ${files.length} files from ${sources.map((source) => source.name).join(' + ')} (full decode, checksum, feature cache)…`,
  );
  async function worker() {
    while (cursor < files.length) {
      const index = cursor++;
      const { file, path, source, section, role, label } = files[index];
      const summary = bySource.get(source)!;
      const key = label ?? UNLABELED;
      summary.counts[section] ??= {};
      summary.counts[section][key] ??= { discovered: 0, readable: 0 };
      summary.counts[section][key].discovered += 1;
      const extension = extname(file).slice(1).toLowerCase();
      extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
      try {
        const bytes = await readFile(file);
        const format = imageFormat(bytes);
        formats[format] = (formats[format] ?? 0) + 1;
        if (format !== normalizedExtension(extension)) {
          formatMismatches.push({ path, extension, format });
        }
        if (!['jpeg', 'png', 'webp', 'gif'].includes(format)) {
          throw new Error(`Unsupported image format: ${format}`);
        }
        const decoded = await decodeImage(file);
        const extracted = extractFeatures(decoded.rgba);
        Buffer.from(extracted.features).copy(featureBuffer, index * 1024);
        extracted.histogram.forEach((value, bin) =>
          histogramBuffer.writeUInt32LE(value, index * 1024 + bin * 4),
        );
        const thumbnail = await sharp(Buffer.from(decoded.rgba), {
          raw: { width: decoded.width, height: decoded.height, channels: 4 },
        })
          .resize(32, 32, { fit: 'fill' })
          .removeAlpha()
          .raw()
          .toBuffer();
        thumbnails.set(path, thumbnail);
        const size = `${decoded.width}x${decoded.height}`;
        summary.dimensions[size] = (summary.dimensions[size] ?? 0) + 1;
        images.push({
          perceptualHash: perceptualHash(thumbnail).toString(16),
          path,
          source,
          section,
          role,
          label,
          bytes: bytes.length,
          width: decoded.width,
          height: decoded.height,
          format,
          extension,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          pixelSha256: createHash('sha256')
            .update(`${decoded.width}x${decoded.height}:`)
            .update(decoded.rgba)
            .digest('hex'),
          group: '',
          featureIndex: index,
        });
        summary.counts[section][key].readable += 1;
      } catch (error) {
        unreadable.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
      complete += 1;
      if (complete % 5000 === 0) {
        console.log(`Decoded ${complete}/${files.length}; unreadable ${unreadable.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  images.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  console.log('Grouping exact, resized and flipped full-frame copies…');
  const nearPairs = findNearDuplicates(images.map((image) => thumbnails.get(image.path)!));
  const duplicates = assignGroups(images, nearPairs);
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, 'en');
  const audit: DatasetAudit = {
    auditVersion: 'scenes-v3',
    decoderPolicy: 'sharp-opaque-chromium-profile-alpha-v2',
    nearDuplicates: {
      method:
        '32x32 RGB pHash D4, Hamming <=4, MAE <=10, correlation >=0.985; full-frame copy heuristic, not exhaustive crop detection',
      pairs: nearPairs.map(({ first, second, ...scores }) => ({
        a: images[first].path,
        b: images[second].path,
        ...scores,
      })),
    },
    createdAt: new Date().toISOString(),
    sources,
    formats,
    extensionCounts,
    formatMismatches: formatMismatches.sort(byPath),
    unreadable: unreadable.sort(byPath),
    ignoredFiles: systemFiles
      .map((file) => ({ path: file, reason: 'Operating-system metadata, not an image.' }))
      .sort(byPath),
    duplicates,
    discovered: files.length,
    readable: images.length,
    images,
    fingerprint: createHash('sha256')
      .update(images.map((image) => `${image.path}:${image.sha256}`).join('\n'))
      .digest('hex'),
    preprocessingVersion: 'luma-round-max15-msb-v1',
  };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'features.bin'), featureBuffer);
  await writeFile(resolve(output, 'histograms.bin'), histogramBuffer);
  await writeFile(resolve(output, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(auditSummary(audit), null, 2));
  return audit;
}

/** Compact, report-ready audit without the per-image table or local absolute paths. */
export function auditSummary({ images: _images, ...summary }: DatasetAudit) {
  return {
    ...summary,
    sources: summary.sources.map(({ root: _root, ...source }) => source),
    ignoredFiles: summary.ignoredFiles.length,
    duplicates: {
      ...summary.duplicates,
      crossLabelGroups: summary.duplicates.crossLabelGroups.length,
      crossLabelExamples: summary.duplicates.crossLabelGroups.slice(0, 20),
    },
  };
}

/** Reuses a cached audit only when it belongs to the same sources, audit schema and preprocessing. */
export async function loadOrCreateAudit(roots: SourceRoots, output: string): Promise<DatasetAudit> {
  try {
    const audit = JSON.parse(await readFile(resolve(output, 'audit.json'), 'utf8')) as DatasetAudit;
    const same =
      audit.auditVersion === 'scenes-v3' &&
      audit.decoderPolicy === 'sharp-opaque-chromium-profile-alpha-v2' &&
      audit.preprocessingVersion === 'luma-round-max15-msb-v1' &&
      audit.sources.length === Object.keys(roots).length &&
      audit.sources.every((source) => roots[source.id as DatasetId] === source.root);
    if (same) {
      return audit;
    }
  } catch {
    /* no usable cache */
  }
  return auditDataset(roots, output);
}
