import { isUncertain, type ModelManifest } from '@horizon/brain/core';
import { LocalModelEngine, type RecognitionEngine } from '../../../shared/api/model-engine';
import { WorkerModelEngine, WorkerUnavailableError } from '../../../shared/api/worker-engine';
import {
  decodeImage,
  readImagePixels,
  validateImageFile,
  type SelectedImage,
} from '../../../shared/lib/image-input';
import type {
  SceneRecognitionService,
  RecognitionProgress,
  RecognitionResult,
} from '../model/types';

export interface LocalRecognitionOptions {
  preferWorker?: boolean;
  modelBaseUrl?: string;
}

const stages: ReadonlyArray<[RecognitionProgress['stage'], string]> = [
  ['loading-model', 'Preparing the local model'],
  ['decoding', 'Decoding image'],
  ['pixels', 'Reading image pixels'],
  ['features', 'Extracting brightness histogram'],
  ['encoding', 'Encoding 1,024 features'],
  ['inference', 'Running neural network'],
  ['result', 'Preparing result'],
  ['complete', 'Complete'],
];

/** Runs the shared histogram pipeline and a verified Brain.js model entirely on this device. */
export class LocalBrainSceneRecognitionService implements SceneRecognitionService {
  private enginePromise?: Promise<RecognitionEngine>;
  private activeEngine?: RecognitionEngine;
  private lifecycle = 0;
  private busy = false;
  private readonly baseUrl: string;

  constructor(private readonly options: LocalRecognitionOptions = {}) {
    const base = options.modelBaseUrl ?? `${import.meta.env.BASE_URL}models/scene-recognition`;
    this.baseUrl = typeof location === 'undefined' ? base : new URL(base, location.href).href;
  }

  private async engine(): Promise<RecognitionEngine> {
    if (this.enginePromise) {
      return this.enginePromise;
    }
    const lifecycle = this.lifecycle;
    const assertActive = () => {
      if (lifecycle !== this.lifecycle) {
        throw new Error('Image analysis was canceled.');
      }
    };
    const promise = (async () => {
      if (this.options.preferWorker !== false && typeof Worker === 'function') {
        let worker: WorkerModelEngine | undefined;
        try {
          worker = new WorkerModelEngine(this.baseUrl);
          this.activeEngine = worker;
          await worker.getModelInfo();
          assertActive();
          return worker;
        } catch (error) {
          worker?.dispose();
          assertActive();
          if (!(error instanceof WorkerUnavailableError)) {
            throw error;
          }
        }
      }
      const engine = new LocalModelEngine(this.baseUrl);
      this.activeEngine = engine;
      await engine.getModelInfo();
      assertActive();
      return engine;
    })().catch((error: unknown) => {
      if (this.enginePromise === promise) {
        this.enginePromise = undefined;
      }
      throw error;
    });
    this.enginePromise = promise;
    return this.enginePromise;
  }

  async getModelInfo(): Promise<ModelManifest> {
    const lifecycle = this.lifecycle;
    const engine = await this.engine();
    if (lifecycle !== this.lifecycle) {
      throw new Error('Model loading was canceled.');
    }
    const model = await engine.getModelInfo();
    if (lifecycle !== this.lifecycle) {
      throw new Error('Model loading was canceled.');
    }
    return model;
  }

  async recognize(
    image: SelectedImage,
    onProgress?: (progress: RecognitionProgress) => void,
  ): Promise<RecognitionResult> {
    if (this.busy) {
      throw new Error('An image is already being analyzed. Wait for the current result.');
    }
    this.busy = true;
    const lifecycle = this.lifecycle;
    const assertActive = () => {
      if (lifecycle !== this.lifecycle) {
        throw new Error('Image analysis was canceled.');
      }
    };
    const report = (stage: RecognitionProgress['stage']) => {
      const index = stages.findIndex(([key]) => key === stage);
      onProgress?.({ stage, label: stages[index][1], step: index + 1, totalSteps: stages.length });
    };
    try {
      await validateImageFile(image.file);
      assertActive();
      report('loading-model');
      let engine = await this.engine();
      assertActive();
      let model = await engine.getModelInfo();
      assertActive();
      const started = performance.now();
      report('decoding');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const decodeStart = performance.now();
      const decoded = await decodeImage(image.file);
      let decodeMs = performance.now() - decodeStart;
      let excludedModelMs = 0;
      let pixels: Uint8ClampedArray;
      let pixelsMs: number;
      try {
        assertActive();
        report('pixels');
        const pixelsStart = performance.now();
        pixels = readImagePixels(decoded);
        pixelsMs = performance.now() - pixelsStart;
      } finally {
        decoded.close();
      }
      let analysis;
      try {
        analysis = await engine.analyze(pixels, report);
      } catch (error) {
        assertActive();
        if (!(error instanceof WorkerUnavailableError)) {
          throw error;
        }
        engine.dispose();
        engine = new LocalModelEngine(this.baseUrl);
        this.activeEngine = engine;
        const reloadStarted = performance.now();
        model = await engine.getModelInfo();
        assertActive();
        excludedModelMs = performance.now() - reloadStarted;
        this.enginePromise = Promise.resolve(engine);
        const retryDecodeStarted = performance.now();
        const retryImage = await decodeImage(image.file);
        decodeMs += performance.now() - retryDecodeStarted;
        try {
          assertActive();
          const retryPixelsStarted = performance.now();
          pixels = readImagePixels(retryImage);
          pixelsMs += performance.now() - retryPixelsStarted;
          analysis = await engine.analyze(pixels, report);
        } finally {
          retryImage.close();
        }
      }
      assertActive();
      report('result');
      const prediction = analysis.predictions[0];
      if (!prediction) {
        throw new Error('The model returned no prediction. Try another image.');
      }
      const result: RecognitionResult = {
        prediction,
        predictions: analysis.predictions,
        uncertain: isUncertain(analysis.predictions, model.uncertainty),
        histogram: analysis.histogram,
        quantized: analysis.quantized,
        timings: {
          decodeMs,
          pixelsMs,
          featuresMs: analysis.featuresMs,
          inferenceMs: analysis.inferenceMs,
          totalMs: performance.now() - started - excludedModelMs,
        },
        model,
        completedAt: new Date().toISOString(),
        execution: engine.execution,
      };
      report('complete');
      return result;
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.lifecycle++;
    this.activeEngine?.dispose();
    this.activeEngine = undefined;
    this.enginePromise = undefined;
  }
}
