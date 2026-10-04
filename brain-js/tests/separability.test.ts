import { describe, expect, it } from 'vitest';
import {
  meanLuminance,
  normalizedHistogram,
  principalComponents,
  separability,
  type HistogramSample,
} from '../src/evaluation/separability';

function sample(classIndex: number, bins: Record<number, number>): HistogramSample {
  const histogram = new Array<number>(256).fill(0);
  for (const [bin, count] of Object.entries(bins)) {
    histogram[Number(bin)] = count;
  }
  return { classIndex, histogram, quantized: histogram.map((value) => Math.min(15, value)) };
}

describe('exploratory histogram separability', () => {
  it('normalizes by pixel count and computes mean brightness', () => {
    expect(normalizedHistogram([...new Array(254).fill(0), 1, 3]).slice(254)).toEqual([0.25, 0.75]);
    expect(() => normalizedHistogram(new Array(256).fill(0))).toThrow();
    expect(meanLuminance([2, ...new Array(254).fill(0), 2])).toBe(127.5);
  });
  it('reports class centroids, between-class distance and within-class spread', () => {
    const result = separability(
      [
        sample(0, { 10: 4 }),
        sample(0, { 10: 2, 12: 2 }),
        sample(1, { 200: 4 }),
        sample(1, { 200: 4 }),
      ],
      ['dark', 'light'],
    );
    expect(result.perClass[0].centroid[10]).toBe(0.75);
    expect(result.perClass[1].withinClassL1).toBe(0);
    expect(result.centroidDistances).toEqual([{ pair: ['dark', 'light'], l1: 2 }]);
    expect(result.inSampleNearestCentroidAgreement).toBe(1);
    expect(result.perClass[1].meanLuminance).toBe(200);
  });
  it('finds the dominant variance direction for offline visualization only', () => {
    const rows = Array.from({ length: 20 }, (_, index) => [
      index,
      index * 0.01 * (index % 2 ? 1 : -1),
      0,
    ]);
    const pca = principalComponents(rows, 1, 3);
    expect(Math.abs(pca.vectors[0][0])).toBeGreaterThan(0.99);
    expect(pca.explainedVarianceRatio[0]).toBeGreaterThan(0.99);
  });
});
