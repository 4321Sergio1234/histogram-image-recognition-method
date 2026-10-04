import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  cleanFingerprint,
  cleanSamples,
  digest,
  loadCleanDataset,
  readCleanHistograms,
  strictEligibility,
  type CleanManifest,
  type CleanPartition,
} from '../src/dataset/clean';
import { fitPaletteCentroids } from '../src/dataset/palette';
import { brightnessHistogram, encodeFourBits, quantizeHistogram } from '../src/features/histogram';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'horizon-clean-test-'));
  temporary.push(root);
  const classes = ['sea', 'forest', 'desert'],
    phases: CleanPartition[] = ['train', 'validation', 'test', 'train-reserve'];
  const files: CleanManifest['files'] = [],
    vectors = [];
  for (const [label, id] of classes.entries()) {
    const gray = 30 + label * 80,
      h = new Array<number>(256).fill(0);
    h[gray] = 4;
    vectors.push({
      classIndex: label,
      vector: { share: h.map((n) => n / 4), bits: encodeFourBits(quantizeHistogram(h)) },
    });
    for (const [phaseIndex, phase] of phases.entries()) {
      await mkdir(resolve(root, phase, id), { recursive: true });
      if (phase === 'train-reserve' && id !== 'forest') {
        continue;
      }
      const rgba = Uint8Array.from(Array.from({ length: 4 }, () => [gray, gray, gray, 255]).flat());
      rgba[2] += phaseIndex;
      const bytes = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } })
        .removeAlpha()
        .png()
        .toBuffer();
      const path = `${phase}/${id}/image.png`;
      await writeFile(resolve(root, path), bytes);
      expect(brightnessHistogram(rgba)[gray]).toBe(4);
      files.push({
        path,
        originalPath: `geoscene/${id}/${phase}.png`,
        classId: id,
        partition: phase,
        sha256: digest(bytes),
        pixelSha256: digest(rgba),
        group: `${phase}-${id}`,
        width: 2,
        height: 2,
        histogramRatios: { share: 0, bits: 0 },
      });
    }
  }
  const protocol = 'Fixture protocol';
  const manifest: CleanManifest = {
    schema: 'horizon-clean-dataset-v1',
    id: 'geoscene-clean-v1',
    fingerprint: '',
    sourceFingerprint: 'source',
    sourcePopulationSha256: 'population',
    sourceCurationSha256: 'curation',
    seed: 42,
    marginRatio: 0.95,
    protocol,
    protocolSha256: digest(protocol),
    sourcePopulationCounts: { train: 3, validation: 3, test: 3 },
    counts: Object.fromEntries(
      phases.map((phase) => [
        phase,
        Object.fromEntries(
          classes.map((id) => [
            id,
            files.filter((row) => row.partition === phase && row.classId === id).length,
          ]),
        ),
      ]),
    ) as CleanManifest['counts'],
    files,
    exclusions: [],
    centroids: fitPaletteCentroids(vectors, 3),
    provenance: 'Unit-test fixture only; never training data.',
  };
  manifest.fingerprint = cleanFingerprint(manifest);
  await writeFile(resolve(root, 'protocol.md'), protocol);
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

describe('physical cleaned data', () => {
  it('decodes the copied partition, verifies the identical histogram criterion and excludes reserve from training', async () => {
    const { root, manifest } = await fixture();
    const dataset = await loadCleanDataset(root);
    for (const phase of ['train', 'validation', 'test'] as const) {
      const rows = await readCleanHistograms(dataset, phase);
      expect(rows).toHaveLength(3);
      expect(cleanSamples(rows, 'sqrt-max15').map((row) => row.output)).toEqual([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);
      expect(
        rows.every(
          (row) => strictEligibility(row.histogram, row.classIndex, manifest.centroids).eligible,
        ),
      ).toBe(true);
      expect(strictEligibility(rows[0].histogram, 1, manifest.centroids).eligible).toBe(false);
    }
    expect(dataset.split.train).toHaveLength(3);
    expect(manifest.files.filter((row) => row.partition === 'train-reserve')).toHaveLength(1);
  });
  it('refuses modified or unlisted physical images before training or evaluation', async () => {
    const { root } = await fixture();
    const file = resolve(root, 'test/sea/image.png'),
      original = await readFile(file);
    await writeFile(file, 'changed');
    await expect(loadCleanDataset(root)).rejects.toThrow('integrity');
    await writeFile(file, original);
    await writeFile(resolve(root, 'test/sea/extra.png'), original);
    await expect(loadCleanDataset(root)).rejects.toThrow('unlisted');
    await rm(resolve(root, 'test/sea/extra.png'));
    await rename(resolve(root, 'test'), resolve(root, 'test-storage'));
    await symlink('test-storage', resolve(root, 'test'), 'dir');
    await expect(loadCleanDataset(root)).rejects.toThrow('physical directories');
  });
  it('rejects leakage and manifest changes even if the path exists', async () => {
    const { root, manifest } = await fixture();
    manifest.files.find((row) => row.partition === 'test' && row.classId === 'sea')!.group =
      manifest.files[0].group;
    await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(loadCleanDataset(root)).rejects.toThrow('manifest integrity');
    manifest.fingerprint = cleanFingerprint(manifest);
    await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(loadCleanDataset(root)).rejects.toThrow('Duplicate image/group');
  });
});
