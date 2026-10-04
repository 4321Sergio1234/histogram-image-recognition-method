import type { ModelManifest, Prediction } from '@horizon/brain/core';
import type { SelectedImage } from '../../../shared/lib/image-input';

export type { ModelManifest, Prediction } from '@horizon/brain/core';

export interface RecognitionTimings {
  decodeMs: number;
  pixelsMs: number;
  featuresMs: number;
  inferenceMs: number;
  totalMs: number;
}

export interface RecognitionResult {
  prediction: Prediction;
  predictions: Prediction[];
  uncertain: boolean;
  histogram: number[];
  quantized: number[];
  timings: RecognitionTimings;
  model: ModelManifest;
  completedAt: string;
  execution: 'worker' | 'main-thread';
}

export interface RecognitionProgress {
  stage:
    | 'loading-model'
    | 'decoding'
    | 'pixels'
    | 'features'
    | 'encoding'
    | 'inference'
    | 'result'
    | 'complete';
  label: string;
  step: number;
  totalSteps: number;
}

/** What the UI needs from any scene recognizer; the local Brain.js service is the current implementation. */
export interface SceneRecognitionService {
  recognize(
    image: SelectedImage,
    onProgress?: (progress: RecognitionProgress) => void,
  ): Promise<RecognitionResult>;
  getModelInfo(): Promise<ModelManifest>;
  dispose?(): void;
}
