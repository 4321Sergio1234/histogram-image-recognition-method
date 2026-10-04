import { useState } from 'react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { downloadBlob, exportAnalysis } from '@/shared/lib/export-analysis';
import { useSessionLog } from '@/shared/lib/session-log';
import { useToast } from '@/shared/ui';
import { EXPORT_COPY as COPY } from '../config/copy';

export function useExportAnalysis(image: SelectedImage, result: RecognitionResult) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'bmp'>('png');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const { record } = useSessionLog();
  function saveOriginal() {
    downloadBlob(image.file, image.metadata.name || 'horizon-photo.jpg');
    record({ operation: COPY.originalOperation, status: 'success' });
  }
  function saveJson() {
    const data = {
      completedAt: result.completedAt,
      image: image.metadata,
      predictions: result.predictions,
      uncertain: result.uncertain,
      timings: result.timings,
      execution: result.execution,
      model: { version: result.model.version, sha256: result.model.modelSha256 },
      histogram: result.histogram,
      quantized: result.quantized,
    };
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      'horizon-result.json',
    );
    record({ operation: COPY.jsonOperation, status: 'success' });
  }
  async function save() {
    const start = performance.now();
    record({ operation: COPY.imageOperation, status: 'started', details: format });
    setBusy(true);
    setError('');
    try {
      const exported = await exportAnalysis(image, result, format);
      downloadBlob(exported.blob, exported.filename);
      notify(COPY.downloaded(format));
      record({
        operation: COPY.imageOperation,
        status: 'success',
        durationMs: performance.now() - start,
        details: format,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : COPY.failed;
      setError(message);
      record({
        operation: COPY.imageOperation,
        status: 'error',
        durationMs: performance.now() - start,
        details: message,
      });
    } finally {
      setBusy(false);
    }
  }
  return { format, setFormat, busy, error, saveOriginal, saveJson, save };
}
