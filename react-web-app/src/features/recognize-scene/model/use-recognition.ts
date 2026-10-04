import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelManifest } from '@horizon/brain/core';
import { prepareImage, type SelectedImage } from '@/entities/image-analysis';
import {
  useRecognitionService,
  type RecognitionProgress,
  type RecognitionResult,
} from '@/entities/recognition-result';
import { useToast } from '@/shared/ui';
import { useSessionLog } from '@/shared/lib/session-log';
import { RECOGNITION_COPY as COPY } from '../config/copy';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : COPY.failed);

/** Owns the in-memory image lifecycle and guards against stale asynchronous results. */
export function useRecognition() {
  const service = useRecognitionService();
  const notify = useToast();
  const { record } = useSessionLog();
  const [image, setImage] = useState<SelectedImage | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [progress, setProgress] = useState<RecognitionProgress | null>(null);
  const [error, setError] = useState('');
  const [model, setModel] = useState<ModelManifest | null>(null);
  const [modelError, setModelError] = useState('');
  const [loadingModel, setLoadingModel] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const imageRef = useRef<SelectedImage | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const loadModel = useCallback(async () => {
    const start = performance.now();
    record({ operation: COPY.loadModel, status: 'started' });
    setLoadingModel(true);
    setModelError('');
    try {
      const manifest = await service.getModelInfo();
      if (mounted.current) {
        setModel(manifest);
        record({
          operation: COPY.loadModel,
          status: 'success',
          durationMs: performance.now() - start,
          details: COPY.version(manifest.version),
        });
      }
    } catch (reason) {
      if (mounted.current) {
        setModelError(errorMessage(reason));
        record({
          operation: COPY.loadModel,
          status: 'error',
          durationMs: performance.now() - start,
          details: errorMessage(reason),
        });
      }
    } finally {
      if (mounted.current) {
        setLoadingModel(false);
      }
    }
  }, [service, record]);
  useEffect(() => {
    mounted.current = true;
    void loadModel();
    return () => {
      mounted.current = false;
      generation.current++;
      imageRef.current?.dispose();
    };
  }, [loadModel]);

  const selectImage = useCallback(
    async (file: File, source: 'file' | 'camera' = 'file') => {
      const start = performance.now();
      record({
        operation: source === 'camera' ? COPY.prepareCamera : COPY.prepareImage,
        status: 'started',
      });
      const current = ++generation.current;
      setSelecting(true);
      setError('');
      setResult(null);
      setProgress(null);
      setAnalyzing(false);
      try {
        const selected = await prepareImage(file, source);
        if (!mounted.current || current !== generation.current) {
          selected.dispose();
          return;
        }
        imageRef.current?.dispose();
        imageRef.current = selected;
        setImage(selected);
        notify(source === 'camera' ? COPY.cameraReady : COPY.imageReady);
        record({
          operation: COPY.prepareImage,
          status: 'success',
          durationMs: performance.now() - start,
          details: `${selected.metadata.width} × ${selected.metadata.height}`,
        });
      } catch (reason) {
        if (mounted.current && current === generation.current) {
          setError(errorMessage(reason));
          record({
            operation: COPY.prepareImage,
            status: 'error',
            durationMs: performance.now() - start,
            details: errorMessage(reason),
          });
        }
      } finally {
        if (mounted.current && current === generation.current) {
          setSelecting(false);
        }
      }
    },
    [notify, record],
  );

  const analyze = useCallback(async () => {
    if (!image) {
      setError(COPY.noImage);
      return;
    }
    const current = ++generation.current;
    const start = performance.now();
    record({ operation: COPY.analyze, status: 'started' });
    setAnalyzing(true);
    setError('');
    setResult(null);
    setProgress(null);
    try {
      const recognized = await service.recognize(image, (status) => {
        if (mounted.current && current === generation.current) {
          setProgress(status);
        }
      });
      if (mounted.current && current === generation.current) {
        setResult(recognized);
        setModel(recognized.model);
        notify(COPY.complete);
        record({
          operation: COPY.analyze,
          status: 'success',
          durationMs: recognized.timings.totalMs,
          details: `${recognized.prediction.label.displayName} · ${recognized.execution}`,
        });
      }
    } catch (reason) {
      if (mounted.current && current === generation.current) {
        setError(errorMessage(reason));
        record({
          operation: COPY.analyze,
          status: 'error',
          durationMs: performance.now() - start,
          details: errorMessage(reason),
        });
      }
    } finally {
      if (mounted.current && current === generation.current) {
        setAnalyzing(false);
      }
    }
  }, [image, notify, service, record]);

  const reset = useCallback(() => {
    generation.current++;
    imageRef.current?.dispose();
    imageRef.current = null;
    setImage(null);
    setResult(null);
    setProgress(null);
    setError('');
    setSelecting(false);
    setAnalyzing(false);
    record({ operation: COPY.reset, status: 'success' });
  }, [record]);
  return {
    image,
    result,
    progress,
    error,
    model,
    modelError,
    loadingModel,
    selecting,
    analyzing,
    selectImage,
    analyze,
    reset,
    retryModel: loadModel,
  };
}
