import { performance } from 'node:perf_hooks';
import { createNetwork, type NetworkJSON } from './network';
import { seededRandom } from '../dataset/random';
import type { SceneClass, EvaluationMetrics } from '../core/contracts';
import type { FeatureSample } from '../dataset/types';
import { evaluateNetwork } from '../evaluation/metrics';

export interface CandidateConfig {
  normalization?: 'max15' | 'sqrt-max15';
  selectionMetric?: 'macroF1';
  id: string;
  hiddenLayers: number[];
  maxIterations: number;
  checkpointEvery: number;
  learningRate: number;
  momentum: number;
  errorThresh: number;
}
export interface Checkpoint {
  iterations: number;
  trainError: number;
  trainAccuracy: number;
  trainMacroF1: number;
  validationAccuracy: number;
  validationMacroF1: number;
}
export interface TrainingRun {
  config: CandidateConfig;
  architecture: string;
  parameters: number;
  iterations: number;
  error: number;
  durationMs: number;
  trainMetrics: EvaluationMetrics;
  validationMetrics: EvaluationMetrics;
  checkpoints: Checkpoint[];
  model: NetworkJSON;
}

export function architecture(hiddenLayers: readonly number[], outputs: number): string {
  return [1024, ...hiddenLayers, outputs].join(' → ');
}
export function parameterCount(hiddenLayers: readonly number[], outputs: number): number {
  const sizes = [1024, ...hiddenLayers, outputs];
  return sizes.slice(1).reduce((sum, size, index) => sum + size * sizes[index] + size, 0);
}

/** Trains one candidate and keeps the checkpoint with the best validation accuracy (macro-F1, then fewer epochs, break ties). */
export function trainCandidate(
  train: FeatureSample[],
  validation: FeatureSample[],
  classes: SceneClass[],
  config: CandidateConfig,
  seed: number,
  progress?: (checkpoint: Checkpoint) => void,
): TrainingRun {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  const start = performance.now();
  const network = createNetwork(config.hiddenLayers);
  let best:
    | {
        model: NetworkJSON;
        train: EvaluationMetrics;
        validation: EvaluationMetrics;
        iterations: number;
        error: number;
      }
    | undefined;
  const checkpoints: Checkpoint[] = [];
  const name = architecture(config.hiddenLayers, classes.length);
  try {
    for (let epoch = 0; epoch < config.maxIterations; epoch += config.checkpointEvery) {
      const block = Math.min(config.checkpointEvery, config.maxIterations - epoch);
      const status = network.train(train, {
        activation: 'sigmoid',
        iterations: block,
        errorThresh: config.errorThresh,
        learningRate: config.learningRate,
        momentum: config.momentum,
        log: false,
      });
      const completed = epoch + status.iterations;
      const trainMetrics = evaluateNetwork(network, train, classes);
      const validationMetrics = evaluateNetwork(network, validation, classes);
      checkpoints.push({
        iterations: completed,
        trainError: status.error,
        trainAccuracy: trainMetrics.accuracy,
        trainMacroF1: trainMetrics.macroF1,
        validationAccuracy: validationMetrics.accuracy,
        validationMacroF1: validationMetrics.macroF1,
      });
      if (progress) {
        progress(checkpoints.at(-1)!);
      } else {
        console.log(
          `  ${config.id} ${name} epoch ${completed}: train ${(100 * trainMetrics.accuracy).toFixed(1)}%, validation ${(100 * validationMetrics.accuracy).toFixed(1)}%, macro-F1 ${validationMetrics.macroF1.toFixed(3)}, error ${status.error.toFixed(5)}`,
        );
      }
      if (
        !best ||
        (config.selectionMetric === 'macroF1'
          ? validationMetrics.macroF1 > best.validation.macroF1 ||
            (validationMetrics.macroF1 === best.validation.macroF1 &&
              validationMetrics.accuracy > best.validation.accuracy)
          : betterValidation(validationMetrics, best.validation))
      ) {
        best = {
          model: network.toJSON(),
          train: trainMetrics,
          validation: validationMetrics,
          iterations: completed,
          error: status.error,
        };
      }
      if (status.iterations < block) {
        break;
      }
    }
  } finally {
    Math.random = originalRandom;
  }
  if (!best) {
    throw new Error('Training produced no checkpoints.');
  }
  return {
    config,
    architecture: name,
    parameters: parameterCount(config.hiddenLayers, classes.length),
    iterations: best.iterations,
    error: best.error,
    durationMs: performance.now() - start,
    trainMetrics: best.train,
    validationMetrics: best.validation,
    checkpoints,
    model: best.model,
  };
}

export function betterValidation(
  candidate: EvaluationMetrics,
  current: EvaluationMetrics,
): boolean {
  return (
    candidate.accuracy > current.accuracy ||
    (candidate.accuracy === current.accuracy && candidate.macroF1 > current.macroF1)
  );
}

/** Validation-only selection: candidates within `margin` of the best accuracy are equivalent, and the one with fewest parameters wins. */
export function selectCandidate<T extends Pick<TrainingRun, 'parameters' | 'validationMetrics'>>(
  runs: readonly T[],
  margin: number,
): T {
  if (!runs.length) {
    throw new Error('No candidates to select from.');
  }
  const bestAccuracy = Math.max(...runs.map((run) => run.validationMetrics.accuracy));
  return runs
    .filter((run) => run.validationMetrics.accuracy >= bestAccuracy - margin - 1e-12)
    .reduce((chosen, run) =>
      run.parameters < chosen.parameters ||
      (run.parameters === chosen.parameters &&
        betterValidation(run.validationMetrics, chosen.validationMetrics))
        ? run
        : chosen,
    );
}
