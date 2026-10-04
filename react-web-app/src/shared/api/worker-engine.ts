import type { ModelManifest } from '@horizon/brain/core';
import {
  ModelLoadError,
  type EngineResult,
  type EngineProgress,
  type RecognitionEngine,
} from './model-engine';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

export class WorkerUnavailableError extends Error {
  override name = 'WorkerUnavailableError';
}

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: EngineProgress;
  timeout: ReturnType<typeof setTimeout>;
}

export class WorkerModelEngine implements RecognitionEngine {
  readonly execution = 'worker' as const;
  private readonly worker: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private manifestPromise?: Promise<ModelManifest>;
  private failure?: Error;

  constructor(private readonly baseUrl: string) {
    try {
      this.worker = new Worker(new URL('./recognition.worker.ts', import.meta.url), {
        type: 'module',
        name: 'horizon-recognition',
      });
    } catch {
      throw new WorkerUnavailableError('Background image processing is unavailable.');
    }
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      if (message.type === 'progress') {
        pending.onProgress?.(message.stage);
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.type === 'error') {
        pending.reject(new ModelLoadError(message.message));
      } else {
        pending.resolve(message);
      }
    };
    this.worker.onerror = () =>
      this.fail(new WorkerUnavailableError('Background image processing could not start.'));
    this.worker.onmessageerror = () =>
      this.fail(new WorkerUnavailableError('Background image processing lost its connection.'));
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    this.worker.terminate();
  }

  private request(
    message: WorkerRequest,
    onProgress?: EngineProgress,
    transfer: Transferable[] = [],
  ): Promise<WorkerResponse> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          this.fail(
            new WorkerUnavailableError(
              'Background image processing timed out. Try a smaller image.',
            ),
          ),
        45_000,
      );
      this.pending.set(message.id, { resolve, reject, onProgress, timeout });
      try {
        this.worker.postMessage(message, transfer);
      } catch {
        this.fail(
          new WorkerUnavailableError(
            'This browser could not transfer the image for background processing.',
          ),
        );
      }
    });
  }

  getModelInfo(): Promise<ModelManifest> {
    this.manifestPromise ??= this.request({
      id: ++this.sequence,
      type: 'initialize',
      baseUrl: this.baseUrl,
    })
      .then((message) => {
        if (message.type !== 'ready') {
          throw new WorkerUnavailableError('Unexpected response from image processing.');
        }
        return message.manifest;
      })
      .catch((error: unknown) => {
        this.manifestPromise = undefined;
        throw error;
      });
    return this.manifestPromise;
  }

  async analyze(pixels: Uint8ClampedArray, onProgress?: EngineProgress): Promise<EngineResult> {
    await this.getModelInfo();
    const message = await this.request(
      { id: ++this.sequence, type: 'analyze', pixels },
      onProgress,
      [pixels.buffer as ArrayBuffer],
    );
    if (message.type !== 'result') {
      throw new WorkerUnavailableError('Unexpected response from image processing.');
    }
    return message.result;
  }

  dispose(): void {
    this.fail(new WorkerUnavailableError('Image processing has stopped.'));
  }
}
