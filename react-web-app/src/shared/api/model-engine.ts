import { NeuralNetwork } from 'brain.js/dist/browser.js';
import type { INeuralNetworkJSON } from 'brain.js/dist/neural-network';
import {
  brightnessHistogram,
  encodeFourBits,
  quantizeHistogram,
  validateManifest,
  rankPredictions,
  type ModelManifest,
  type Prediction,
} from '@horizon/brain/core';

export class ModelLoadError extends Error {
  override name = 'ModelLoadError';
}

export interface EngineResult {
  predictions: Prediction[];
  histogram: number[];
  quantized: number[];
  featuresMs: number;
  inferenceMs: number;
}

export type EngineStage = 'features' | 'encoding' | 'inference';
export type EngineProgress = (stage: EngineStage) => void;

export interface RecognitionEngine {
  readonly execution: 'worker' | 'main-thread';
  getModelInfo(): Promise<ModelManifest>;
  analyze(pixels: Uint8ClampedArray, onProgress?: EngineProgress): Promise<EngineResult>;
  dispose(): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Checks tensor sizes and numeric values before Brain.js allocates the inference network. */
export function validateNetwork(value: unknown, manifest: ModelManifest): INeuralNetworkJSON {
  if (
    !record(value) ||
    value.type !== 'NeuralNetwork' ||
    value.inputLookup !== null ||
    value.outputLookup !== null
  ) {
    throw new ModelLoadError('The local model is not a compatible Brain.js network.');
  }
  const expected = [
    manifest.featureLength,
    ...manifest.network.hiddenLayers,
    manifest.classes.length,
  ];
  if (
    !Array.isArray(value.sizes) ||
    value.sizes.length !== expected.length ||
    value.sizes.some((size, index) => size !== expected[index])
  ) {
    throw new ModelLoadError('The model dimensions do not match its manifest.');
  }
  if (
    !record(value.trainOpts) ||
    value.trainOpts.activation !== manifest.network.activation ||
    !Array.isArray(value.layers) ||
    value.layers.length !== expected.length
  ) {
    throw new ModelLoadError('The model layers or activation are incompatible.');
  }
  for (let layerIndex = 1; layerIndex < expected.length; layerIndex++) {
    const layer: unknown = value.layers[layerIndex];
    if (
      !record(layer) ||
      !Array.isArray(layer.biases) ||
      layer.biases.length !== expected[layerIndex] ||
      layer.biases.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
      !Array.isArray(layer.weights) ||
      layer.weights.length !== expected[layerIndex] ||
      layer.weights.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== expected[layerIndex - 1] ||
          row.some((v) => typeof v !== 'number' || !Number.isFinite(v)),
      )
    ) {
      throw new ModelLoadError('The model contains invalid weights.');
    }
  }
  return value as unknown as INeuralNetworkJSON;
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ModelLoadError(
      'Model verification requires a secure browser context. Open Horizon over HTTPS or localhost.',
    );
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchAsset(
  url: string,
  maxBytes: number,
  fetcher: typeof fetch,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetcher(url, { signal: controller.signal, credentials: 'same-origin' });
    if (!response.ok) {
      throw new ModelLoadError(
        'The local recognition model is unavailable. Connect once to download it, then retry.',
      );
    }
    const reportedLength = Number(response.headers.get('content-length'));
    if (reportedLength > maxBytes) {
      throw new ModelLoadError('The local model artifact exceeds its size limit.');
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new ModelLoadError('The local model artifact exceeds its size limit.');
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

export class LocalModelEngine implements RecognitionEngine {
  readonly execution = 'main-thread' as const;
  private modelPromise?: Promise<{
    manifest: ModelManifest;
    network: NeuralNetwork<number[], number[]>;
  }>;

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private load() {
    this.modelPromise ??= (async () => {
      try {
        const manifestBytes = await fetchAsset(
          `${this.baseUrl}/manifest.json`,
          1024 * 1024,
          this.fetcher,
        );
        const manifest = validateManifest(
          JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
        );
        const modelBytes = await fetchAsset(
          `${this.baseUrl}/model.json`,
          32 * 1024 * 1024,
          this.fetcher,
        );
        if ((await sha256(modelBytes)) !== manifest.modelSha256) {
          throw new ModelLoadError(
            'The local model did not pass its integrity check. Reconnect and reload Horizon to update it.',
          );
        }
        const json = validateNetwork(
          JSON.parse(new TextDecoder().decode(modelBytes)) as unknown,
          manifest,
        );
        const network = new NeuralNetwork<number[], number[]>();
        network.fromJSON(json);
        rankPredictions(network.run(new Array<number>(1024).fill(0)), manifest.classes);
        return { manifest, network };
      } catch (error) {
        this.modelPromise = undefined;
        if (error instanceof ModelLoadError) {
          throw error;
        }
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          throw new ModelLoadError(
            'The model took too long to load. Check your connection and retry.',
          );
        }
        throw new ModelLoadError(
          `The local recognition model could not be loaded. ${error instanceof Error ? error.message : 'Please retry.'}`,
        );
      }
    })();
    return this.modelPromise;
  }

  async getModelInfo(): Promise<ModelManifest> {
    return (await this.load()).manifest;
  }

  async analyze(pixels: Uint8ClampedArray, onProgress?: EngineProgress): Promise<EngineResult> {
    const { manifest, network } = await this.load();
    onProgress?.('features');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const featureStart = performance.now();
    const histogram = brightnessHistogram(pixels);
    onProgress?.('encoding');
    const quantized = quantizeHistogram(
      histogram,
      manifest.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2' ? 'sqrt-max15' : 'max15',
    );
    const features = encodeFourBits(quantized);
    const featuresMs = performance.now() - featureStart;
    onProgress?.('inference');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const inferenceStart = performance.now();
    const predictions = rankPredictions(network.run(features), manifest.classes);
    return {
      predictions,
      histogram,
      quantized,
      featuresMs,
      inferenceMs: performance.now() - inferenceStart,
    };
  }

  dispose(): void {
    this.modelPromise = undefined;
  }
}
