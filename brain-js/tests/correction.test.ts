import { describe, expect, it } from 'vitest';
import { correctSplit } from '../src/dataset/correction';
import { splitDataset, assertNoLeakage } from '../src/dataset/split';
import { assignGroups } from '../src/dataset/grouping';
import { findNearDuplicates, transformSquare } from '../src/dataset/perceptual';
import { SCENE_CATALOG } from '../src/core/scenes';
import { image, auditOf } from './fixtures';

describe('copy-safe correction with a fixed holdout', () => {
  function fixture() {
    const images = SCENE_CATALOG.flatMap((label) => [
      ...Array.from({ length: 30 }, (_, index) =>
        image(
          `${label.id}/pool-${index}`,
          label.source === 'intel' ? 'seg_train' : 'Training Data',
          label.datasetLabel,
        ),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        image(
          `${label.id}/test-${index}`,
          label.source === 'intel' ? 'seg_test' : 'Testing Data',
          label.datasetLabel,
        ),
      ),
    ]);
    assignGroups(images);
    const audit = auditOf(images);
    const anchor = structuredClone(splitDataset(audit, SCENE_CATALOG, 17, 20));
    return { audit, anchor };
  }
  it('removes new test copies, gives validation priority and balances only training', () => {
    const { audit, anchor } = fixture();
    const a = audit.images.findIndex((image) => image.path === anchor.train[0].path);
    const b = audit.images.findIndex((image) => image.path === anchor.test[0].path);
    const c = audit.images.findIndex(
      (image) => image.path === anchor.train.find((image) => image.label === 'forest')!.path,
    );
    const d = audit.images.findIndex(
      (image) => image.path === anchor.validation.find((image) => image.label === 'forest')!.path,
    );
    assignGroups(audit.images, [
      { first: a, second: b },
      { first: c, second: d },
    ]);
    const corrected = correctSplit(audit, anchor, []);
    expect(corrected.test.map((image) => image.path)).toEqual(
      anchor.test.map((image) => image.path),
    );
    expect(
      corrected.train.some(
        (image) => image.path === audit.images[a].path || image.path === audit.images[c].path,
      ),
    ).toBe(false);
    expect(corrected.validation.some((image) => image.path === audit.images[d].path)).toBe(true);
    expect(new Set(Object.values(corrected.counts).map((count) => count.train)).size).toBe(1);
    expect(corrected.validation).toHaveLength(anchor.validation.length);
    expect(() => assertNoLeakage(corrected)).not.toThrow();
    expect(corrected).toEqual(correctSplit(audit, anchor, []));
  });
  it('requires a reviewed exclusion to match the original hash and refuses a changed test', () => {
    const { audit, anchor } = fixture();
    expect(() =>
      correctSplit(audit, anchor, [
        { path: anchor.train[0].path, sha256: 'wrong', reason: 'reviewed' },
      ]),
    ).toThrow('no longer matches');
    audit.images.find((image) => image.path === anchor.test[0].path)!.sha256 = 'changed';
    expect(() => correctSplit(audit, anchor, [])).toThrow('fixed test has changed');
  });
  it('detects flipped full-frame copies and does not group unrelated or uniform images', () => {
    const original = Uint8Array.from(
      { length: 32 * 32 * 3 },
      (_, i) => (i * 47 + Math.floor(i / 61) * 31) % 256,
    );
    const other = Uint8Array.from(original, (_, i) => (i * 113 + Math.floor(i / 93) * 7) % 256);
    const pairs = findNearDuplicates([
      original,
      transformSquare(original, 6),
      other,
      new Uint8Array(original.length),
    ]);
    expect(pairs.map((pair) => [pair.first, pair.second])).toEqual([[0, 1]]);
    expect(pairs[0].mae).toBe(0);
  });
});
