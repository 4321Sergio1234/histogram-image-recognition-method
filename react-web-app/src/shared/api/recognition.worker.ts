import { LocalModelEngine } from './model-engine';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
let engine: LocalModelEngine | undefined;

scope.onmessage = (event) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === 'initialize') {
        engine?.dispose();
        engine = new LocalModelEngine(request.baseUrl);
        const manifest = await engine.getModelInfo();
        scope.postMessage({ id: request.id, type: 'ready', manifest });
      } else {
        if (!engine) {
          throw new Error('The recognition worker is not ready.');
        }
        const result = await engine.analyze(request.pixels, (stage) =>
          scope.postMessage({ id: request.id, type: 'progress', stage }),
        );
        scope.postMessage({ id: request.id, type: 'result', result });
      }
    } catch (error) {
      scope.postMessage({
        id: request.id,
        type: 'error',
        message: error instanceof Error ? error.message : 'Local image processing failed.',
      });
    }
  })();
};
