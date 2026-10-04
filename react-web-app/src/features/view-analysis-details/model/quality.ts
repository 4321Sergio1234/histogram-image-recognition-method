import type { ModelManifest } from '@horizon/brain/core';

const COHORT = {
  histogram: 'histogram-filtered',
  palette: 'palette-selected',
  dataset: 'dataset',
} as const;

export function isHistogramFiltered(model: ModelManifest) {
  return (
    model.domain?.id === 'geoscene-strict-histogram-v1' ||
    model.domain?.id === 'curated-histogram-v2'
  );
}

export function testCohort(model: ModelManifest) {
  return isHistogramFiltered(model)
    ? COHORT.histogram
    : model.domain
      ? COHORT.palette
      : COHORT.dataset;
}

/** Finds the pair with the most errors in both directions on the recorded test partition. */
export function mostConfused(model: ModelManifest) {
  const matrix = model.testMetrics.confusionMatrix;
  let best = { names: ['', ''], count: 0 };
  for (let a = 0; a < matrix.length; a++) {
    for (let b = a + 1; b < matrix.length; b++) {
      const count = matrix[a][b] + matrix[b][a];
      if (count > best.count) {
        best = { names: [model.classes[a].displayName, model.classes[b].displayName], count };
      }
    }
  }
  return best;
}
