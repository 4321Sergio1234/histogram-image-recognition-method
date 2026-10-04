import { isUncertain } from '../core/predictions';
import type { UncertaintyRule } from '../core/contracts';

export interface ReviewedPrediction {
  path: string;
  classId: string;
  predictions: { id: string; score: number }[];
}

/** Describes frozen predictions without fitting a threshold or changing the model. */
export function predictionDiagnostics(rows: ReviewedPrediction[], rule: UncertaintyRule) {
  if (!rows.length || rows.some((row) => !row.predictions.length)) {
    throw new Error('Non-empty predictions are required.');
  }
  const correct = (row: ReviewedPrediction) => row.predictions[0].id === row.classId;
  const summarize = (subset: ReviewedPrediction[]) => ({
    count: subset.length,
    correct: subset.filter(correct).length,
    accuracy: subset.length ? subset.filter(correct).length / subset.length : null,
    meanScore: subset.length
      ? subset.reduce((sum, row) => sum + row.predictions[0].score, 0) / subset.length
      : null,
  });
  const uncertain = (row: ReviewedPrediction) =>
    isUncertain(
      row.predictions.map((item) => ({
        label: { id: item.id, displayName: item.id, source: '', datasetLabel: item.id },
        score: item.score,
      })),
      rule,
    );
  const confident = rows.filter((row) => !uncertain(row));
  const bounds = [0, 0.25, 0.5, 0.65, 0.8, 0.9, 1];
  return {
    ...summarize(rows),
    correctPredictions: summarize(rows.filter(correct)),
    incorrectPredictions: summarize(rows.filter((row) => !correct(row))),
    top2Accuracy:
      rows.filter((row) =>
        row.predictions.slice(0, 2).some((prediction) => prediction.id === row.classId),
      ).length / rows.length,
    perClass: [...new Set(rows.map((row) => row.classId))].map((id) => ({
      id,
      ...summarize(rows.filter((row) => row.classId === id)),
    })),
    uncertainty: {
      rule,
      confident: summarize(confident),
      uncertain: summarize(rows.filter(uncertain)),
      coverage: confident.length / rows.length,
    },
    scoreBands: bounds.slice(0, -1).map((lower, index) => {
      const upper = bounds[index + 1];
      return {
        lower,
        upper,
        upperInclusive: upper === 1,
        ...summarize(
          rows.filter(
            (row) =>
              row.predictions[0].score >= lower &&
              (row.predictions[0].score < upper || (upper === 1 && row.predictions[0].score === 1)),
          ),
        ),
      };
    }),
  };
}

/** Off-diagonal confusion counts, largest first; symmetric pairs are also totalled. */
export function confusionPairs(matrix: number[][], ids: string[]) {
  const directed = matrix
    .flatMap((row, truth) =>
      row.map((count, predicted) => ({ truth: ids[truth], predicted: ids[predicted], count })),
    )
    .filter((item) => item.truth !== item.predicted && item.count > 0)
    .sort((a, b) => b.count - a.count);
  const pairs = ids
    .flatMap((a, i) =>
      ids.slice(i + 1).map((b, offset) => ({
        pair: [a, b] as [string, string],
        count: matrix[i][i + 1 + offset] + matrix[i + 1 + offset][i],
      })),
    )
    .sort((a, b) => b.count - a.count);
  return { directed, pairs };
}

/** Chance-corrected agreement, comparable across problems with different class counts. */
export function cohenKappa(matrix: number[][]): number {
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  if (!total) {
    return 0;
  }
  const observed = matrix.reduce((sum, row, index) => sum + row[index], 0) / total;
  const expected =
    matrix.reduce(
      (sum, row, index) =>
        sum +
        row.reduce((a, b) => a + b, 0) * matrix.reduce((column, other) => column + other[index], 0),
      0,
    ) /
    total ** 2;
  return expected === 1 ? 0 : (observed - expected) / (1 - expected);
}
