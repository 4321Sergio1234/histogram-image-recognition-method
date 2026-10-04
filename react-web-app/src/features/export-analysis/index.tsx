import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { downloadBlob, exportAnalysis } from '@/shared/lib/export-analysis';
import { useToast, useSessionLog } from '@/shared/ui';
export function ExportAnalysis({
  image,
  result,
}: {
  image: SelectedImage;
  result: RecognitionResult;
}) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'bmp'>('png');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const { record } = useSessionLog();
  function saveOriginal() {
    downloadBlob(image.file, image.metadata.name || 'horizon-photo.jpg');
    record({ operation: 'Download original photo', status: 'success' });
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
    record({ operation: 'Download JSON result', status: 'success' });
  }
  async function save() {
    const start = performance.now();
    record({ operation: 'Export analysis image', status: 'started', details: format });
    setBusy(true);
    setError('');
    try {
      const exported = await exportAnalysis(image, result, format);
      downloadBlob(exported.blob, exported.filename);
      notify(`${format.toUpperCase()} analysis image downloaded.`);
      record({
        operation: 'Export analysis image',
        status: 'success',
        durationMs: performance.now() - start,
        details: format,
      });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'The image could not be exported. Try again.';
      setError(message);
      record({
        operation: 'Export analysis image',
        status: 'error',
        durationMs: performance.now() - start,
        details: message,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="export-control">
        <label className="visually-hidden" htmlFor="export-format">
          Export format
        </label>
        <select
          id="export-format"
          value={format}
          disabled={busy}
          onChange={(event) => setFormat(event.target.value as typeof format)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="bmp">BMP</option>
        </select>
        <button className="button button-primary" onClick={() => void save()} disabled={busy}>
          {busy ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
          {busy ? 'Preparing…' : 'Export result'}
        </button>
      </div>
      <div className="separate-downloads">
        <button className="button button-text" onClick={saveOriginal} disabled={busy}>
          Save original photo
        </button>
        <button className="button button-text" onClick={saveJson} disabled={busy}>
          Save result JSON
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
