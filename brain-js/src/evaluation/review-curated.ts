import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  brightnessHistogram,
  encodeFourBits,
  quantizeHistogram,
  rankPredictions,
  validateManifest,
} from '../core';
import { decodeImage } from '../image/decode';
import { loadNetwork, type NetworkJSON } from '../model/network';
import { sha256 } from '../export/model';
import { readCuratedSamples, type CuratedDataset } from '../dataset/curated';
import { metricsFromConfusion } from './metrics';
import type { OperationLog } from '../cli/progress';

/** Post-selection diagnostics: never changes weights, membership or hyperparameters. */
export async function reviewCuratedModel(
  dataset: CuratedDataset,
  run: string,
  docs: string,
  log: OperationLog,
) {
  const manifest = validateManifest(
    JSON.parse(await readFile(resolve(run, 'manifest.json'), 'utf8')),
  );
  const bytes = await readFile(resolve(run, 'model.json'));
  if (
    sha256(bytes) !== manifest.modelSha256 ||
    manifest.datasetFingerprint !== dataset.manifest.fingerprint
  ) {
    throw new Error('Reviewed model/dataset integrity mismatch');
  }
  const network = loadNetwork(JSON.parse(bytes.toString()) as NetworkJSON);
  const normalization =
    manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15';
  const directory = resolve(docs, 'lab2/data/curated-v2');
  await mkdir(directory, { recursive: true });
  const errors: {
    phase: string;
    path: string;
    actual: string;
    predicted: string;
    score: number;
  }[] = [];
  for (const phase of ['validation', 'test'] as const) {
    const samples = await readCuratedSamples(dataset, phase, normalization, log);
    for (const sample of samples) {
      const top = rankPredictions(network.run(sample.input), manifest.classes)[0],
        actual = manifest.classes[sample.classIndex].id;
      if (top.label.id !== actual) {
        errors.push({
          phase,
          path: sample.path,
          actual,
          predicted: top.label.id,
          score: top.score,
        });
      }
    }
  }
  await writeFile(resolve(directory, 'errors.json'), JSON.stringify(errors, null, 2));
  const sanity = resolve(docs, 'lab2/data/model-diagnostics/external-sanity');
  const frozen = await readFile(resolve(sanity, 'frozen-set.json')).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    },
  );
  let external: unknown = {
    status: 'unavailable',
    note: 'External report inputs are intentionally outside Git',
  };
  if (frozen) {
    if (sha256(frozen) !== (await readFile(resolve(sanity, 'frozen-set.sha256'), 'utf8')).trim()) {
      throw new Error('External diagnostic set changed');
    }
    const set = JSON.parse(frozen.toString()) as {
      images: { file: string; classId: string; sha256: string }[];
    };
    const rows = [];
    const matrix = manifest.classes.map(() => manifest.classes.map(() => 0));
    for (const row of set.images) {
      const file = resolve(sanity, row.file),
        input = await readFile(file);
      if (
        sha256(input) !== row.sha256 ||
        dataset.manifest.files.some((file) => file.sha256 === row.sha256)
      ) {
        throw new Error('External input changed or overlaps with materialized data');
      }
      const histogram = brightnessHistogram((await decodeImage(file)).rgba);
      const scores = rankPredictions(
        network.run(encodeFourBits(quantizeHistogram(histogram, normalization))),
        manifest.classes,
      ).map((item) => ({ id: item.label.id, score: item.score }));
      rows.push({ ...row, scores });
      matrix[manifest.classes.findIndex((c) => c.id === row.classId)][
        manifest.classes.findIndex((c) => c.id === scores[0].id)
      ]++;
    }
    external = {
      scope:
        'Reused external sanity set, unfiltered and never used for this selection. Not a blind benchmark; all failures retained.',
      metrics: metricsFromConfusion(matrix, manifest.classes),
      sahara: rows.find((row) => row.file === 'sahara-user.jpg'),
      images: rows,
    };
    await writeFile(
      resolve(directory, 'external-sanity-results.json'),
      JSON.stringify(external, null, 2),
    );
  }
  const sourceCounts = Object.fromEntries(
    ['train', 'validation', 'test'].map((phase) => [
      phase,
      Object.fromEntries(
        manifest.classes.map((label) => [
          label.id,
          Object.fromEntries(
            dataset.manifest.sources.map((source) => [
              source.id,
              dataset.manifest.files.filter(
                (row) =>
                  row.partition === phase && row.classId === label.id && row.source === source.id,
              ).length,
            ]),
          ),
        ]),
      ),
    ]),
  );
  const review = {
    reviewedAt: new Date().toISOString(),
    modelVersion: manifest.version,
    modelSha256: manifest.modelSha256,
    counts: dataset.manifest.counts,
    sourceCounts,
    train: manifest.trainMetrics,
    validation: manifest.validationMetrics,
    test: manifest.testMetrics,
    errors: errors.length,
    external,
    limitations: [
      'Conditional label-aware histogram eligibility makes the nearest-centroid gate classify admitted photos correctly by construction; ANN accuracy measures fidelity within that restricted domain.',
      'Desert has only108 training groups and85 test groups; imbalance and Desert/Sea confusion remain.',
      'Previously inspected source photos; cross-source near-copy heuristic is not an exhaustive crop detector.',
      'GeoScene Sea/Forest alias Intel and Desert aliases Landscape. Desert source confounding persists.',
      'Automatic palette filtering for added sources is not an exhaustive manual review.',
      'No test failures were removed or used for parameter selection.',
    ],
  };
  await writeFile(resolve(directory, 'model-review.json'), JSON.stringify(review, null, 2));
  log.event('model-reviewed', {
    modelVersion: manifest.version,
    test: manifest.testMetrics,
    external,
  });
  return review;
}
