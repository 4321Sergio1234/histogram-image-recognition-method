import { describe, expect, it } from 'vitest';
import { GEOSCENE_CATALOG, type ModelManifest, validateManifest } from '../src/core';
import {
  populationSplit,
  paletteSplit,
  histogramAdmission,
  type ManualDecision,
  type PaletteVector,
} from '../src/dataset/palette';
import { assertNoLeakage } from '../src/dataset/split';
import { encodeFourBits, quantizeHistogram } from '../src/features/histogram';
import type { DatasetAudit } from '../src/dataset/types';
import { auditOf, image } from './fixtures';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function fixture() {
  const images = GEOSCENE_CATALOG.flatMap((label, classIndex) =>
    Array.from({ length: 30 }, (_, index) => ({
      ...image(
        `${label.id}/${index}.jpg`,
        '.',
        label.datasetLabel,
        `${classIndex}-${index}`,
        'geoscene',
      ),
      role: 'pool' as const,
      featureIndex: classIndex * 30 + index,
    })),
  );
  const audit = { ...auditOf(images), sources: [{ id: 'geoscene' }] } as DatasetAudit;
  const decisions = new Map(
    images.map((row, i) => [
      row.path,
      {
        id: i + 1,
        path: row.path,
        sha256: row.sha256,
        decision: 'include',
        reason: 'Manually reviewed canonical palette.',
      } satisfies ManualDecision,
    ]),
  );
  const vectors = new Map(
    images.map((row) => {
      const h = new Array<number>(256).fill(0);
      h[[45, 125, 195][Math.floor(row.featureIndex / 30)]] = 100;
      return [
        row.path,
        {
          share: h.map((n) => n / 100),
          bits: encodeFourBits(quantizeHistogram(h)),
        } satisfies PaletteVector,
      ];
    }),
  );
  return { audit, decisions, vectors };
}

describe('restricted palette experiment', () => {
  it('freezes deterministic group splits before curation, removes conflicting/copy groups and separates test', () => {
    const { audit } = fixture();
    audit.images.push({ ...audit.images[0], path: 'geoscene/sea/copy.jpg' });
    const first = populationSplit(audit, 42),
      second = populationSplit(audit, 42);
    expect(first).toEqual(second);
    expect(first.test).toHaveLength(12);
    expect(first.validation).toHaveLength(12);
    expect(first.excluded).toContainEqual(
      expect.objectContaining({
        path: 'geoscene/sea/copy.jpg',
        reason: expect.stringContaining('copy'),
      }),
    );
    expect(() => assertNoLeakage(first)).not.toThrow();
    const copy = { ...audit.images[1], path: 'geoscene/forest/conflict.jpg', label: 'forest area' };
    audit.images.push(copy);
    expect(
      populationSplit(audit, 42).excluded.filter((row) => row.reason.includes('conflicting')),
    ).toHaveLength(2);
  });

  it('fits histogram eligibility on training only; a conflicting holdout histogram remains in primary test', () => {
    const { audit, decisions, vectors } = fixture();
    const population = populationSplit(audit, 42);
    const vector = (row: { path: string }) => vectors.get(row.path)!;
    const before = paletteSplit(population, decisions, vector, 1);
    const seaTest = population.test.find((row) => row.label === 'sea or ocean')!;
    const forestTrain = population.train.find((row) => row.label === 'forest area')!;
    vectors.set(seaTest.path, vector(forestTrain));
    const after = paletteSplit(population, decisions, vector, 1);
    expect(after.centroids).toEqual(before.centroids);
    expect(after.split.train).toEqual(before.split.train);
    expect(after.split.test.some((row) => row.path === seaTest.path)).toBe(true);
    expect(histogramAdmission(vector(seaTest), after.centroids).nearestClassIndex).toBe(1);
  });

  it('excludes training histogram conflicts, balances only training and refuses stale reviews or insufficient separation', () => {
    const { audit, decisions, vectors } = fixture();
    const population = populationSplit(audit, 42);
    const vector = (row: { path: string }) => vectors.get(row.path)!;
    const seaTrain = population.train.find((row) => row.label === 'sea or ocean')!;
    const forestTrain = population.train.find((row) => row.label === 'forest area')!;
    vectors.set(seaTrain.path, vector(forestTrain));
    const prepared = paletteSplit(population, decisions, vector, 1);
    expect(prepared.split.train.some((row) => row.path === seaTrain.path)).toBe(false);
    expect(new Set(Object.values(prepared.split.counts).map((count) => count.train)).size).toBe(1);
    expect(prepared.split.validation).toEqual(population.validation);
    expect(prepared.split.test).toEqual(population.test);
    expect(() => paletteSplit(population, decisions, vector, 100)).toThrow(
      'Insufficient strict histogram separation',
    );
    decisions.get(population.test[0].path)!.sha256 = 'changed';
    expect(() => paletteSplit(population, decisions, vector, 1)).toThrow('stale manual decision');
  });

  it('requires a GeoScene model to declare its palette scope and broader test coverage', () => {
    const path = fileURLToPath(
      new URL('../../react-web-app/public/models/scene-recognition/manifest.json', import.meta.url),
    );
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as ModelManifest;
    manifest.classes = [...GEOSCENE_CATALOG];
    manifest.datasets = [
      {
        id: 'geoscene',
        name: 'GeoSceneNet16K',
        url: 'https://example.test/geoscene',
        selectedClasses: GEOSCENE_CATALOG.map((label) => label.datasetLabel),
        ignoredClasses: ['hill or mountain'],
      },
    ];
    delete manifest.domain;
    expect(() => validateManifest(manifest)).toThrow('restricted-palette');
    manifest.domain = {
      id: 'geoscene-canonical-palette-v1',
      description: 'Restricted palette',
      palettes: GEOSCENE_CATALOG.map((label) => ({
        id: label.id,
        description: `${label.id} palette`,
      })),
      paletteTestCoverage: 0.2,
      populationTestMetrics: manifest.testMetrics,
      sourceCaveat: 'Source differences remain.',
    };
    expect(validateManifest(manifest).classes).toEqual(GEOSCENE_CATALOG);
    manifest.domain = {
      ...manifest.domain,
      id: 'geoscene-strict-histogram-v1',
      testPopulationCount: 958,
      cleanDatasetFingerprint: manifest.datasetFingerprint,
    };
    delete manifest.domain.populationTestMetrics;
    expect(validateManifest(manifest).domain?.id).toBe('geoscene-strict-histogram-v1');
    manifest.domain.cleanDatasetFingerprint = 'wrong';
    expect(() => validateManifest(manifest)).toThrow('restricted-palette');
    manifest.domain.cleanDatasetFingerprint = manifest.datasetFingerprint;
    manifest.classes[0] = { ...manifest.classes[0], datasetLabel: 'desert' };
    expect(() => validateManifest(manifest)).toThrow('catalog');
  });
});
