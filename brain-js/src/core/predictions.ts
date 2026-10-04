import type { Prediction, SceneClass, UncertaintyRule } from './contracts';

/** Maps raw sigmoid outputs to labels without presenting them as calibrated probabilities. */
export function rankPredictions(
  outputs: number[] | Float32Array,
  classes: SceneClass[],
): Prediction[] {
  if (outputs.length !== classes.length || !classes.length) {
    throw new Error('Model output does not match the class catalog.');
  }
  if (Array.from(outputs).some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new Error('Model returned an invalid score.');
  }
  return classes
    .map((label, index) => ({ label, score: outputs[index] }))
    .sort((a, b) => b.score - a.score);
}

/** Heuristic uncertainty: a low top score or a small lead over the runner-up. Not calibrated. */
export function isUncertain(ranked: readonly Prediction[], rule: UncertaintyRule): boolean {
  const [top, second] = ranked;
  if (!top) {
    return true;
  }
  return (
    top.score < rule.minScore || (second !== undefined && top.score - second.score < rule.minMargin)
  );
}
