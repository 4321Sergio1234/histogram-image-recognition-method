import type { ModelManifest } from '@horizon/brain/core';
import type { EngineResult, EngineStage } from './model-engine';

export type WorkerRequest =
  | { id: number; type: 'initialize'; baseUrl: string }
  | { id: number; type: 'analyze'; pixels: Uint8ClampedArray };
export type WorkerResponse =
  | { id: number; type: 'ready'; manifest: ModelManifest }
  | { id: number; type: 'result'; result: EngineResult }
  | { id: number; type: 'progress'; stage: EngineStage }
  | { id: number; type: 'error'; message: string };
