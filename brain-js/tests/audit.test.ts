import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageFormat } from '../src/image/format';
import { auditDataset, auditSummary, imageFile, loadOrCreateAudit } from '../src/dataset/audit';
import { discoverLayout } from '../src/dataset/layout';
import { DATASETS } from '../src/core/scenes';
import { jpeg, touch } from './fixtures';

let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'horizon-audit-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it.each([
  { bytes: [255, 216, 255, 0], expected: 'jpeg' },
  { bytes: [137, 80, 78, 71, 13, 10, 26, 10], expected: 'png' },
  { bytes: Array.from(Buffer.from('RIFFxxxxWEBP')), expected: 'webp' },
  { bytes: Array.from(Buffer.from('GIF89a')), expected: 'gif' },
  { bytes: [], expected: 'unknown' },
])('detects $expected by signature', ({ bytes, expected }) =>
  expect(imageFormat(new Uint8Array(bytes))).toBe(expected),
);

describe('dataset layout discovery', () => {
  it('recognizes GeoSceneNet16K flat class folders without inventing source train/test sections', async () => {
    for (const label of ['Sea or Ocean', 'Forest Area', 'Desert']) {
      await jpeg(join(directory, label, '1.jpg'), 100);
    }
    const layout = await discoverLayout(directory, DATASETS.geoscene);
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0]).toMatchObject({
      name: '.',
      role: 'pool',
      directory: '',
      labeled: true,
    });
    expect(layout.sections[0].classes.map((row) => row.label)).toEqual([
      'desert',
      'forest area',
      'sea or ocean',
    ]);
  });

  it('resolves the doubled seg_train/seg_train nesting used by the Intel archive', async () => {
    const root = join(directory, 'Dataset');
    for (const section of ['seg_train', 'seg_test']) {
      for (const label of ['sea', 'forest']) {
        await jpeg(join(root, section, section, label, '1.jpg'), 100);
      }
    }
    await jpeg(join(root, 'seg_pred', 'seg_pred', '9.jpg'), 100);
    const layout = await discoverLayout(root, DATASETS.intel);
    expect(
      layout.sections.map((section) => [section.name, section.directory, section.role]),
    ).toEqual([
      ['seg_train', 'seg_train/seg_train', 'pool'],
      ['seg_test', 'seg_test/seg_test', 'test'],
      ['seg_pred', 'seg_pred/seg_pred', 'unlabeled'],
    ]);
    expect(layout.sections[0].classes.map((item) => item.label)).toEqual(['forest', 'sea']);
  });

  it('finds the Landscape sections below wrapper folders, lower-cases class names and ignores system files', async () => {
    const root = join(directory, 'archive');
    await touch(join(root, '.DS_Store'));
    for (const section of ['Training Data', 'Validation Data', 'Testing Data']) {
      await jpeg(
        join(
          root,
          'Landscape Classification',
          'Landscape Classification',
          section,
          'Desert',
          `${section}.jpeg`,
        ),
        200,
      );
    }
    await touch(
      join(
        root,
        'Landscape Classification',
        'Landscape Classification',
        'TFrecords',
        'Train',
        'Desert_1.tfrecord',
      ),
    );
    const layout = await discoverLayout(root, DATASETS.landscape);
    expect(layout.sections.map((section) => [section.name, section.role])).toEqual([
      ['Training Data', 'pool'],
      ['Validation Data', 'pool'],
      ['Testing Data', 'test'],
    ]);
    expect(layout.sections[2].classes).toEqual([
      {
        label: 'desert',
        directory: 'Landscape Classification/Landscape Classification/Testing Data/Desert',
      },
    ]);
  });

  it('accepts a copy without the extra nesting level and never unwraps a lone class folder', async () => {
    for (const section of ['seg_train', 'seg_test']) {
      await jpeg(join(directory, 'wrapper', section, 'Sea', '1.jpg'), 100);
    }
    const layout = await discoverLayout(directory, DATASETS.intel);
    expect(layout.sections.map((section) => section.directory)).toEqual([
      'wrapper/seg_train',
      'wrapper/seg_test',
    ]);
    expect(layout.sections[1].classes).toEqual([
      { label: 'sea', directory: 'wrapper/seg_test/Sea' },
    ]);
  });

  it('explains a missing labelled test section instead of guessing', async () => {
    await jpeg(join(directory, 'seg_train', 'sea', '1.jpg'), 100);
    await expect(discoverLayout(directory, DATASETS.intel)).rejects.toThrow('no seg_test section');
  });
});

describe('multi-source scene dataset audit', () => {
  it('counts every source, section and class and records dimensions, unreadable files, files outside sections and duplicates', async () => {
    const intel = join(directory, 'Dataset');
    const train = join(intel, 'seg_train', 'seg_train');
    const test = join(intel, 'seg_test', 'seg_test');
    await jpeg(join(train, 'sea', '1.jpg'), 180);
    await jpeg(join(train, 'sea', '2.jpg'), 170, 4, 3);
    await jpeg(join(train, 'forest', '3.jpg'), 40);
    await jpeg(join(train, 'glacier', '4.jpg'), 230);
    await copyFile(join(train, 'glacier', '4.jpg'), join(train, 'forest', '5.jpg'));
    await jpeg(join(test, 'sea', '6.jpg'), 150);
    await copyFile(join(test, 'sea', '6.jpg'), join(train, 'sea', '7.jpg'));
    await jpeg(join(test, 'forest', '8.jpg'), 30);
    await mkdir(join(test, 'mountain'), { recursive: true });
    await writeFile(join(test, 'mountain', 'broken.jpg'), 'not an image');
    await jpeg(join(intel, 'seg_pred', 'seg_pred', '9.jpg'), 90);
    await touch(join(train, '.DS_Store'));
    const landscape = join(directory, 'archive');
    const sections = join(landscape, 'Landscape Classification');
    await jpeg(join(sections, 'Training Data', 'Desert', 'a.jpeg'), 210, 6, 4);
    await jpeg(join(sections, 'Validation Data', 'Desert', 'b.jpeg'), 200, 6, 4);
    await jpeg(join(sections, 'Testing Data', 'Desert', 'c.jpeg'), 190, 6, 4);
    await copyFile(
      join(sections, 'Testing Data', 'Desert', 'c.jpeg'),
      join(sections, 'Training Data', 'Desert', 'copy.jpeg'),
    );
    await touch(join(landscape, 'model.h5'));
    const audit = await auditDataset({ intel, landscape }, join(directory, 'output'));
    expect(audit.discovered).toBe(14);
    expect(audit.readable).toBe(13);
    const [intelSource, landscapeSource] = audit.sources;
    expect(intelSource.counts.seg_train).toEqual({
      sea: { discovered: 3, readable: 3 },
      forest: { discovered: 2, readable: 2 },
      glacier: { discovered: 1, readable: 1 },
    });
    expect(intelSource.counts.seg_test.mountain).toEqual({ discovered: 1, readable: 0 });
    expect(intelSource.counts.seg_pred).toEqual({ '(unlabeled)': { discovered: 1, readable: 1 } });
    expect(landscapeSource.counts['Training Data'].desert).toEqual({ discovered: 2, readable: 2 });
    expect(landscapeSource.outsideSections).toEqual({ h5: 1 });
    expect(intelSource.dimensions).toEqual({ '4x4': 8, '4x3': 1 });
    expect(landscapeSource.dimensions).toEqual({ '6x4': 4 });
    expect(intelSource.selectedClasses).toEqual(['sea', 'forest']);
    expect(intelSource.ignoredClasses).toEqual(['buildings', 'glacier', 'mountain', 'street']);
    expect(landscapeSource.selectedClasses).toEqual(['desert']);
    expect(audit.unreadable).toEqual([
      {
        path: 'intel/seg_test/seg_test/mountain/broken.jpg',
        reason: 'Unsupported image format: unknown',
      },
    ]);
    expect(audit.ignoredFiles).toHaveLength(1);
    expect(audit.duplicates.poolTestImages).toEqual(
      [
        'intel/seg_test/seg_test/sea/6.jpg',
        'intel/seg_train/seg_train/sea/7.jpg',
        'landscape/Landscape Classification/Testing Data/Desert/c.jpeg',
        'landscape/Landscape Classification/Training Data/Desert/copy.jpeg',
      ].sort((a, b) => a.localeCompare(b, 'en')),
    );
    expect(audit.duplicates.crossLabelGroups).toEqual([
      {
        labels: ['forest', 'glacier'],
        paths: [
          'intel/seg_train/seg_train/forest/5.jpg',
          'intel/seg_train/seg_train/glacier/4.jpg',
        ],
      },
    ]);
    expect(
      imageFile(
        audit,
        audit.images.find((item) => item.label === 'desert')!,
      ),
    ).toContain(join('archive', 'Landscape Classification'));
    const summary = auditSummary(audit);
    expect(summary).not.toHaveProperty('images');
    expect(JSON.stringify(summary)).not.toContain(directory);
    expect(JSON.stringify(audit)).not.toMatch(/fresh|rotten|food/i);
    expect(
      (await loadOrCreateAudit({ intel, landscape }, join(directory, 'output'))).createdAt,
    ).toBe(audit.createdAt);
  });
});
