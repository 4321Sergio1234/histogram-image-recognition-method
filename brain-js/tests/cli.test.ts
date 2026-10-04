import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli/main';
import {
  brightnessRatio,
  brightnessVector,
  paletteShare,
  resolutionGroup,
  selectTrainingFiles,
  unifiedGroups,
  type CuratedDataset,
  type CuratedFile,
} from '../src/dataset/curated';
import { image } from './fixtures';

describe('training CLI', () => {
  it('accepts runtime epochs/LR and multiple folders without source changes', () => {
    const options = parseCli([
      'train',
      '--epochs',
      '12',
      '--learning-rate',
      '0.03',
      '--folder',
      'train/jpg/small',
      '--folder',
      'train/jpeg/small',
    ]);
    expect(options).toMatchObject({
      epochs: 12,
      rates: [0.03],
      folders: ['train/jpg/small', 'train/jpeg/small'],
    });
    expect(parseCli(['--help'])).toBeNull();
  });
  it('refuses malformed values and unknown commands rather than silently using defaults', () => {
    for (const args of [
      ['train', '--epochs', '0'],
      ['train', '--epochs', 'NaN'],
      ['train', '--learning-rate', 'Infinity'],
      ['train', '--learning-rate', '-0.1'],
      ['train', '--rates', '.1', '--learning-rate', '.2'],
      ['train', '--unknown'],
      ['delete'],
    ]) {
      expect(() => parseCli(args)).toThrow();
    }
  });
});

describe('curated scene data rules', () => {
  it('unions byte/pixel aliases across sources and existing near-copy groups', () => {
    const a = image('a', 'train', 'sea', 'near', 'intel');
    a.sha256 = 'a';
    a.pixelSha256 = 'pa';
    const b = { ...a, path: 'geo/b', source: 'geoscene', group: 'other' };
    const c = { ...a, path: 'intel/c', sha256: 'c', pixelSha256: 'pc' };
    const groups = unifiedGroups([a, b, c]);
    expect(new Set(groups.values()).size).toBe(1);
  });
  it('uses brightness distributions with a strict nearest-own-class condition', () => {
    const h = new Array<number>(256).fill(0);
    h[20] = 4;
    const v = brightnessVector(h),
      other = v.map((_, i) => Number(i === 200));
    expect(brightnessRatio(v, 0, [v, other])).toBe(0);
    expect(brightnessRatio(v, 1, [v, other])).toBe(Infinity);
    expect(paletteShare(Uint8Array.from([0, 80, 180, 255]), 'sea')).toBe(1);
    expect(paletteShare(Uint8Array.from([0, 80, 180, 255]), 'forest')).toBe(0);
    expect(resolutionGroup(150, 150)).toBe('small');
    expect(resolutionGroup(640, 480)).toBe('medium');
    expect(resolutionGroup(3840, 2160)).toBe('large');
  });
  it('combines training folders without duplication and forbids holdout selection', () => {
    const files = ['sea', 'forest', 'desert'].map((classId) => ({
      classId,
      partition: 'train',
      path: `train/jpg/small/${classId}/file.jpg`,
    })) as CuratedFile[];
    const dataset = { root: '/dataset', manifest: { files, seed: 42 } } as CuratedDataset;
    expect(selectTrainingFiles(dataset, ['train', 'train/jpg/small'])).toHaveLength(3);
    expect(() => selectTrainingFiles(dataset, ['test'])).toThrow('holdouts');
    expect(() => selectTrainingFiles(dataset, ['train/jpg/small/sea'])).toThrow('include Sea');
    expect(() => selectTrainingFiles(dataset, ['../another/train'])).toThrow('training folders');
  });
});
