import { seededRandom } from '../dataset/random';

export interface HistogramSample {
  classIndex: number;
  histogram: number[];
  quantized: number[];
}

const l1 = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
const mean = (rows: readonly (readonly number[])[]) =>
  rows[0].map((_, index) => rows.reduce((sum, row) => sum + row[index], 0) / rows.length);

/** Share of pixels in each brightness bin, so images of different sizes are comparable. */
export function normalizedHistogram(histogram: readonly number[]): number[] {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (!total) {
    throw new Error('A histogram must count at least one pixel.');
  }
  return histogram.map((value) => value / total);
}

export function meanLuminance(histogram: readonly number[]): number {
  return (
    histogram.reduce((sum, value, index) => sum + value * index, 0) /
    histogram.reduce((sum, value) => sum + value, 0)
  );
}

/**
 * Exploratory statistics only. Centroids, distances and projections are never classifier inputs;
 * the ANN still receives the canonical 1024-bit encoding.
 */
export function separability(samples: readonly HistogramSample[], ids: readonly string[]) {
  const normalized = samples.map((sample) => normalizedHistogram(sample.histogram));
  const perClass = ids.map((id, classIndex) => {
    const indices = samples.flatMap((sample, index) =>
      sample.classIndex === classIndex ? [index] : [],
    );
    if (!indices.length) {
      throw new Error(`No exploratory samples for ${id}.`);
    }
    const rows = indices.map((index) => normalized[index]);
    const centroid = mean(rows);
    const luminance = indices.map((index) => meanLuminance(samples[index].histogram));
    const luminanceMean = luminance.reduce((a, b) => a + b, 0) / luminance.length;
    return {
      id,
      count: indices.length,
      centroid,
      meanQuantized: mean(indices.map((index) => samples[index].quantized)),
      meanLuminance: luminanceMean,
      luminanceStd: Math.sqrt(
        luminance.reduce((sum, value) => sum + (value - luminanceMean) ** 2, 0) / luminance.length,
      ),
      withinClassL1: rows.reduce((sum, row) => sum + l1(row, centroid), 0) / rows.length,
    };
  });
  const centroidDistances = perClass.flatMap((a, i) =>
    perClass.slice(i + 1).map((b) => ({ pair: [a.id, b.id], l1: l1(a.centroid, b.centroid) })),
  );
  const meanWithin = perClass.reduce((sum, item) => sum + item.withinClassL1, 0) / perClass.length;
  const nearestCentroid =
    samples.reduce((hits, sample, index) => {
      const distances = perClass.map((item) => l1(normalized[index], item.centroid));
      return hits + (distances.indexOf(Math.min(...distances)) === sample.classIndex ? 1 : 0);
    }, 0) / samples.length;
  return {
    perClass,
    centroidDistances,
    meanWithinClassL1: meanWithin,
    betweenToWithinRatio: centroidDistances.map((item) => ({
      pair: item.pair,
      ratio: item.l1 / meanWithin,
    })),
    inSampleNearestCentroidAgreement: nearestCentroid,
  };
}

/** Top principal directions of normalized histograms by seeded power iteration with deflation (offline visualization only). */
export function principalComponents(
  rows: readonly (readonly number[])[],
  components = 2,
  seed = 1,
) {
  const centre = mean(rows);
  const centred = rows.map((row) => row.map((value, index) => value - centre[index]));
  const dimension = centre.length;
  const covariance = Array.from({ length: dimension }, () => new Float64Array(dimension));
  for (const row of centred) {
    for (let i = 0; i < dimension; i++) {
      if (!row[i]) {
        continue;
      }
      for (let j = i; j < dimension; j++) {
        covariance[i][j] += row[i] * row[j];
      }
    }
  }
  for (let i = 0; i < dimension; i++) {
    for (let j = i; j < dimension; j++) {
      covariance[i][j] /= rows.length - 1;
      covariance[j][i] = covariance[i][j];
    }
  }
  const totalVariance = covariance.reduce((sum, row, index) => sum + row[index], 0);
  const random = seededRandom(seed);
  const vectors: number[][] = [];
  const variances: number[] = [];
  for (let component = 0; component < components; component++) {
    let vector = Array.from({ length: dimension }, () => random() - 0.5);
    let eigenvalue = 0;
    for (let iteration = 0; iteration < 500; iteration++) {
      const next = covariance.map((row) =>
        row.reduce((sum, value, index) => sum + value * vector[index], 0),
      );
      for (const previous of vectors) {
        const dot = next.reduce((sum, value, index) => sum + value * previous[index], 0);
        for (let i = 0; i < dimension; i++) {
          next[i] -= dot * previous[i];
        }
      }
      const norm = Math.hypot(...next);
      if (!norm) {
        break;
      }
      const normalizedNext = next.map((value) => value / norm);
      const change = l1(normalizedNext, vector);
      vector = normalizedNext;
      eigenvalue = norm;
      if (change < 1e-10) {
        break;
      }
    }
    vectors.push(vector);
    variances.push(eigenvalue);
  }
  return {
    centre,
    vectors,
    explainedVarianceRatio: variances.map((value) => value / totalVariance),
    project: (row: readonly number[]) =>
      vectors.map((vector) =>
        vector.reduce((sum, value, index) => sum + value * (row[index] - centre[index]), 0),
      ),
  };
}
