import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { SourceRoots } from '../dataset/audit';
export const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
export const workspaceRoot = resolve(packageRoot, '..');
export const trainingConfig = {
  modelVersion: '4.0.0',
  splitSeed: 20260928,
  initializationSeed: 20260928,
  validationPercent: 15,
  holdoutAnchor: resolve(
    workspaceRoot,
    '../docs/lab2/data/model-diagnostics/baseline-3.0.0/splits.json',
  ),
  candidates: [
    { id: 'A', hiddenLayers: [] },
    { id: 'B', hiddenLayers: [16] },
    { id: 'C', hiddenLayers: [32] },
    { id: 'D', hiddenLayers: [64] },
  ],
  maxIterations: 60,
  checkpointEvery: 2,
  learningRate: 0.1,
  momentum: 0.1,
  errorThresh: 0.002,
  /** Candidates within this validation-accuracy distance of the best are treated as equivalent; the simplest wins. */
  equivalenceMargin: 0.01,
  uncertainty: { minScore: 0.65, minMargin: 0.15 },
  artifactsDirectory: resolve(packageRoot, 'artifacts/geoscene-palette-v1'),
  exportDirectory: resolve(workspaceRoot, 'react-web-app/public/models/scene-recognition'),
  reportDataDirectory: resolve(workspaceRoot, '../docs/lab2/data/geoscene-palette'),
  reportFigureDirectory: resolve(workspaceRoot, '../docs/lab2/figures/geoscene-palette'),
};
function pathOption(flag: string, variable: string, fallback: string): string {
  const option = process.argv.indexOf(flag);
  return resolve(
    workspaceRoot,
    option >= 0
      ? process.argv[option + 1]
      : (process.env[variable] ?? resolve(workspaceRoot, fallback)),
  );
}
/** Source paths for the historical GeoScene audit; the current CLI uses the curated dataset. */
export function datasetPaths(): SourceRoots {
  return { geoscene: pathOption('--dataset', 'DATASET_PATH', '../docs/GeoSceneNet16K') };
}
export function numberOption(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
