import { describe, expect, it } from 'vitest';
import {
  cohenKappa,
  confusionPairs,
  predictionDiagnostics,
  type ReviewedPrediction,
} from '../src/evaluation/diagnostics';

const rule = { minScore: 0.65, minMargin: 0.15 };
function row(classId: string, ids: string[], scores: number[]): ReviewedPrediction {
  return {
    path: `${classId}/${ids.join()}`,
    classId,
    predictions: ids.map((id, index) => ({ id, score: scores[index] })),
  };
}

describe('frozen-model diagnostics', () => {
  it('counts top-1 separately from top-2 and applies the fixed uncertainty rule', () => {
    const result = predictionDiagnostics(
      [
        row('sea', ['sea', 'mountain', 'forest'], [0.9, 0.2, 0.1]),
        row('sea', ['mountain', 'sea', 'forest'], [0.7, 0.6, 0.1]),
        row('forest', ['sea', 'mountain', 'forest'], [0.5, 0.2, 0.1]),
      ],
      rule,
    );
    expect(result.correct).toBe(1);
    expect(result.top2Accuracy).toBe(2 / 3);
    expect(result.uncertainty.coverage).toBe(1 / 3);
    expect(result.uncertainty.confident.accuracy).toBe(1);
    expect(result.uncertainty.uncertain.count).toBe(2);
    expect(result.perClass.find((item) => item.id === 'sea')).toMatchObject({
      count: 2,
      correct: 1,
    });
  });
  it('counts each score boundary once and does not invent accuracy for an empty bucket', () => {
    const result = predictionDiagnostics(
      [0, 0.25, 0.5, 0.65, 0.8, 0.9, 1].map((score) => row('sea', ['sea', 'forest'], [score, 0])),
      rule,
    );
    expect(result.scoreBands.map((band) => band.count)).toEqual([1, 1, 1, 1, 1, 2]);
    expect(
      predictionDiagnostics([row('sea', ['sea', 'forest'], [0.1, 0])], rule).uncertainty.confident
        .accuracy,
    ).toBeNull();
  });
  it('rejects empty predictions', () =>
    expect(() => predictionDiagnostics([], rule)).toThrow('Non-empty'));
  it('orders directed and symmetric confusions', () => {
    const { directed, pairs } = confusionPairs(
      [
        [8, 1, 3],
        [0, 9, 1],
        [4, 2, 7],
      ],
      ['sea', 'forest', 'mountain'],
    );
    expect(directed[0]).toEqual({ truth: 'mountain', predicted: 'sea', count: 4 });
    expect(pairs[0]).toEqual({ pair: ['sea', 'mountain'], count: 7 });
    expect(pairs.map((item) => item.count)).toEqual([7, 3, 1]);
  });
  it('corrects accuracy for chance agreement', () => {
    expect(
      cohenKappa([
        [5, 0],
        [0, 5],
      ]),
    ).toBe(1);
    expect(
      cohenKappa([
        [25, 25],
        [25, 25],
      ]),
    ).toBe(0);
    expect(
      cohenKappa([
        [20, 5],
        [10, 15],
      ]),
    ).toBeCloseTo(0.4);
  });
});
