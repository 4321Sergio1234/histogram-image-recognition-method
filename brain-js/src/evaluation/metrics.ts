import type { EvaluationMetrics, SceneClass } from '../core/contracts';
import type { FeatureSample } from '../dataset/types';
import type { Network } from '../model/network';

export function metricsFromConfusion(
  confusionMatrix: number[][],
  classes: SceneClass[],
): EvaluationMetrics {
  const total = confusionMatrix.flat().reduce((sum, count) => sum + count, 0);
  const correct = confusionMatrix.reduce((sum, row, index) => sum + row[index], 0);
  const perClass = classes.map((label, index) => {
    const count = confusionMatrix[index].reduce((sum, value) => sum + value, 0);
    const predicted = confusionMatrix.reduce((sum, row) => sum + row[index], 0);
    const precision = predicted ? confusionMatrix[index][index] / predicted : 0;
    const recall = count ? confusionMatrix[index][index] / count : 0;
    return {
      id: label.id,
      count,
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    };
  });
  return {
    total,
    accuracy: total ? correct / total : 0,
    macroF1: perClass.reduce((sum, row) => sum + row.f1, 0) / classes.length,
    confusionMatrix,
    perClass,
  };
}

export function evaluateNetwork(
  network: Network,
  samples: FeatureSample[],
  classes: SceneClass[],
): EvaluationMetrics {
  const matrix = classes.map(() => classes.map(() => 0));
  for (const sample of samples) {
    const output = network.run(sample.input);
    let predicted = 0;
    for (let index = 1; index < output.length; index += 1) {
      if (output[index] > output[predicted]) {
        predicted = index;
      }
    }
    matrix[sample.classIndex][predicted] += 1;
  }
  return metricsFromConfusion(matrix, classes);
}
