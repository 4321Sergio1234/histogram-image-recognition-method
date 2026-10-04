import { describe, expect, it } from 'vitest';
import { SCENE_CATALOG } from '../src/core/scenes';
import { assignGroups } from '../src/dataset/grouping';
import { assertNoLeakage, classIndex, splitDataset } from '../src/dataset/split';
import { seededRandom, shuffled } from '../src/dataset/random';
import { auditOf, image } from './fixtures';

/** Two-source fixture shaped like the local data: Intel sea/forest/mountain + Landscape desert/forest. */
function scenesLike(perClass = 100, testPerClass = 20) {
  const images = ['sea', 'forest', 'mountain', 'glacier'].flatMap((label) => [
    ...Array.from({ length: perClass }, (_, i) =>
      image(`seg_train/seg_train/${label}/${i}.jpg`, 'seg_train', label),
    ),
    ...Array.from({ length: testPerClass }, (_, i) =>
      image(`seg_test/seg_test/${label}/${i}.jpg`, 'seg_test', label),
    ),
  ]);
  for (const label of ['desert', 'forest']) {
    images.push(
      ...Array.from({ length: perClass * 0.8 }, (_, i) =>
        image(`Training Data/${label}/${i}.jpeg`, 'Training Data', label),
      ),
    );
    images.push(
      ...Array.from({ length: perClass * 0.2 }, (_, i) =>
        image(`Validation Data/${label}/${i}.jpeg`, 'Validation Data', label),
      ),
    );
    images.push(
      ...Array.from({ length: testPerClass }, (_, i) =>
        image(`Testing Data/${label}/${i}.jpeg`, 'Testing Data', label),
      ),
    );
  }
  images.push(image('seg_pred/seg_pred/1.jpg', 'seg_pred', null));
  assignGroups(images);
  return images;
}

describe('pool / test split across sources', () => {
  it('is deterministic, stratified 85/15 inside the pool sections and uses every test-section image for the final test', () => {
    const audit = auditOf(scenesLike());
    const first = splitDataset(audit, SCENE_CATALOG, 123, 15);
    expect(first).toEqual(splitDataset(audit, SCENE_CATALOG, 123, 15));
    expect(first.counts).toEqual(
      Object.fromEntries(
        ['sea', 'forest', 'desert'].map((id) => [
          id,
          { available: 100, excluded: 0, train: 85, validation: 15, test: 20 },
        ]),
      ),
    );
    expect(first.train.every((item) => item.role === 'pool')).toBe(true);
    expect(first.validation.every((item) => item.role === 'pool')).toBe(true);
    expect(first.test.every((item) => item.role === 'test')).toBe(true);
    expect(
      new Set(first.train.filter((item) => item.label === 'desert').map((item) => item.section)),
    ).toEqual(new Set(['Training Data', 'Validation Data']));
    expect(
      first.test
        .filter((item) => item.label === 'desert')
        .every((item) => item.section === 'Testing Data'),
    ).toBe(true);
    expect(splitDataset(audit, SCENE_CATALOG, 124, 15).validation).not.toEqual(first.validation);
    expect(() => assertNoLeakage(first)).not.toThrow();
  });

  it('takes each class only from its own source and never exposes ignored classes or unlabeled images', () => {
    const split = splitDataset(auditOf(scenesLike()), SCENE_CATALOG, 1, 15);
    expect(split.classes.map((label) => label.id)).toEqual(['sea', 'forest', 'desert']);
    expect(split.ignoredClasses).toEqual({ intel: ['glacier', 'mountain'], landscape: ['forest'] });
    const used = [...split.train, ...split.validation, ...split.test];
    expect([...new Set(used.map((item) => `${item.source}/${item.label}`))].sort()).toEqual([
      'intel/forest',
      'intel/sea',
      'landscape/desert',
    ]);
  });

  it('keeps duplicate groups together and excludes seg_train copies of seg_test images and conflicting labels', () => {
    const images = scenesLike(40, 5);
    const find = (path: string) => images.find((item) => item.path === path)!;
    find('intel/seg_train/seg_train/sea/0.jpg').sha256 = 'shared-with-test';
    find('intel/seg_test/seg_test/mountain/0.jpg').sha256 = 'shared-with-test';
    find('intel/seg_train/seg_train/forest/1.jpg').pixelSha256 = 'glacier-copy';
    find('intel/seg_train/seg_train/glacier/1.jpg').pixelSha256 = 'glacier-copy';
    find('landscape/Training Data/desert/5.jpeg').sha256 = 'desert-leak';
    find('landscape/Testing Data/desert/4.jpeg').sha256 = 'desert-leak';
    for (const name of ['2', '3']) {
      find(`intel/seg_train/seg_train/forest/${name}.jpg`).sha256 = 'pair';
    }
    assignGroups(images);
    const split = splitDataset(auditOf(images), SCENE_CATALOG, 7, 15);
    expect(split.excluded).toEqual([
      {
        path: 'intel/seg_train/seg_train/forest/1.jpg',
        reason: 'Identical pixels carry conflicting dataset labels.',
      },
      {
        path: 'intel/seg_train/seg_train/sea/0.jpg',
        reason: 'Identical to a test-section image; excluded from training and validation.',
      },
      {
        path: 'landscape/Training Data/desert/5.jpeg',
        reason: 'Identical to a test-section image; excluded from training and validation.',
      },
    ]);
    expect(split.test.map((item) => item.path)).toContain('landscape/Testing Data/desert/4.jpeg');
    const pairPartitions = (['train', 'validation'] as const).filter((name) =>
      split[name].some((item) => item.sha256 === 'pair'),
    );
    expect(pairPartitions).toHaveLength(1);
    expect(split[pairPartitions[0]].filter((item) => item.sha256 === 'pair')).toHaveLength(2);
    expect(split.counts.sea).toMatchObject({ available: 40, excluded: 1 });
  });

  it('detects leakage and partitions drawn from the wrong source section', () => {
    const split = splitDataset(auditOf(scenesLike()), SCENE_CATALOG, 5, 15);
    expect(() => assertNoLeakage({ ...split, test: [...split.test, split.train[0]] })).toThrow(
      'test must come from a test section',
    );
    const copy = { ...split.test[0], role: 'pool' as const };
    expect(() => assertNoLeakage({ ...split, train: [...split.train, copy] })).toThrow('leakage');
  });

  it('rejects impossible validation fractions and maps labels to output positions', () => {
    const audit = auditOf(scenesLike());
    expect(() => splitDataset(audit, SCENE_CATALOG, 1, 0)).toThrow('validationPercent');
    expect(() => splitDataset(audit, SCENE_CATALOG, 1, 15.5)).toThrow('validationPercent');
    const split = splitDataset(audit, SCENE_CATALOG, 1, 15);
    expect(classIndex(split, image('x', 'Testing Data', 'desert'))).toBe(2);
    expect(() => classIndex(split, image('x', 'seg_test', 'mountain'))).toThrow(
      'outside the selected classes',
    );
    expect(() => classIndex(split, image('x', 'Testing Data', 'forest'))).toThrow(
      'outside the selected classes',
    );
  });

  it('uses reproducible permutation mechanics', () => {
    expect(shuffled([1, 2, 3, 4, 5], seededRandom(42))).toEqual(
      shuffled([1, 2, 3, 4, 5], seededRandom(42)),
    );
  });
});
