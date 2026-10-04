import { resolve } from 'node:path';
import { trainingConfig, workspaceRoot } from './training';

/** Separate revision: identical, frozen histogram eligibility in every materialized split. */
export const cleanTrainingConfig = {
  ...trainingConfig,
  modelVersion: '5.0.0',
  datasetDirectory: resolve(workspaceRoot, '../docs/archive-data/geoscene-clean-v1'),
  artifactsDirectory: resolve(workspaceRoot, '../docs/lab2/data/geoscene-clean-v1/run'),
  reportDataDirectory: resolve(workspaceRoot, '../docs/lab2/data/geoscene-clean-v1'),
  reportFigureDirectory: resolve(workspaceRoot, '../docs/lab2/figures/geoscene-clean-v1'),
};
