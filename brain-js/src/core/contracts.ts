export interface SceneClass {
  id: string;
  displayName: string;
  source: string;
  datasetLabel: string;
}
export interface ManifestDataset {
  id: string;
  name: string;
  url: string;
  selectedClasses: string[];
  ignoredClasses: string[];
}
export interface ClassMetrics {
  id: string;
  count: number;
  precision: number;
  recall: number;
  f1: number;
}
export interface EvaluationMetrics {
  accuracy: number;
  macroF1: number;
  total: number;
  confusionMatrix: number[][];
  perClass: ClassMetrics[];
}
export interface UncertaintyRule {
  minScore: number;
  minMargin: number;
}
export interface ModelManifest {
  version: string;
  createdAt: string;
  task: 'natural-scene-classification';
  algorithm: 'zawyalow-brightness-histogram-v1';
  preprocessingVersion: 'luma-round-max15-msb-v1' | 'luma-round-sqrtmax15-msb-v2';
  featureLength: 1024;
  datasets: ManifestDataset[];
  datasetFingerprint: string;
  classes: SceneClass[];
  split: {
    strategy: string;
    seed: number;
    validationPercent: number;
    trainSource: string;
    validationSource: string;
    testSource: string;
  };
  sampleCounts: { train: number; validation: number; test: number };
  initializationSeed: number;
  network: {
    architecture: string;
    hiddenLayers: number[];
    activation: 'sigmoid';
    iterations: number;
    learningRate: number;
    momentum: number;
  };
  trainMetrics: EvaluationMetrics;
  validationMetrics: EvaluationMetrics;
  testMetrics: EvaluationMetrics;
  uncertainty: UncertaintyRule;
  modelSha256: string;
  brainVersion: string;
  domain?: {
    id: 'geoscene-canonical-palette-v1' | 'geoscene-strict-histogram-v1' | 'curated-histogram-v2';
    description: string;
    palettes: { id: string; description: string }[];
    paletteTestCoverage: number;
    populationTestMetrics?: EvaluationMetrics;
    testPopulationCount?: number;
    cleanDatasetFingerprint?: string;
    sourceCaveat: string;
  };
  provenance?: {
    decoderPolicy?: string;
    groupingPolicy?: string;
    filterRulesSha256?: string;
    holdoutAnchorSha256?: string;
    trainingDurationMs: number;
    trainingError: number;
    alphaBackground: string;
    nativeResolution: boolean;
    selectionRule: string;
    uncertaintyMeaning: string;
  };
}
export interface FeatureResult {
  histogram: number[];
  quantized: number[];
  features: number[];
}
export interface Prediction {
  label: SceneClass;
  score: number;
}
