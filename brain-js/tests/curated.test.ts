import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { workspaceRoot } from '../src/config/training';
import { loadCuratedDataset } from '../src/dataset/curated';

it('ships the full independent dataset with useful holdouts and every previously recorded visual exclusion applied', async () => {
  const root = resolve(workspaceRoot, 'brain-js/data/scenes-curated-v2');
  const dataset = await loadCuratedDataset(root);
  for (const phase of ['train', 'validation', 'test'] as const) {
    expect(dataset.split[phase].length).toBeGreaterThan(250);
    for (const count of Object.values(dataset.manifest.counts[phase])) {
      expect(count).toBeGreaterThanOrEqual(30);
    }
  }
  expect(dataset.split.train.length).toBe(
    dataset.manifest.files.filter((row) => row.partition === 'train').length,
  );
  const rows = JSON.parse(
    await readFile(
      resolve(root, 'provenance/geoscene-palette/sea-test-error-review/manual-reinspection.json'),
      'utf8',
    ),
  ) as { rows: { sha256: string; visualFinding: string }[] };
  const excluded = new Set(
    rows.rows.filter((row) => row.visualFinding !== 'palette_acceptable').map((row) => row.sha256),
  );
  expect(dataset.manifest.files.some((row) => excluded.has(row.sha256))).toBe(false);
}, 30_000);
