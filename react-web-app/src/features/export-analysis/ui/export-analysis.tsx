import { useId } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { Button } from '@/shared/ui';
import { EXPORT_COPY as COPY, EXPORT_FORMATS } from '../config/copy';
import { useExportAnalysis } from '../model/use-export-analysis';

export function ExportAnalysis({
  image,
  result,
}: {
  image: SelectedImage;
  result: RecognitionResult;
}) {
  const control = useExportAnalysis(image, result);
  const formatId = useId();
  return (
    <div>
      <div className="export-control">
        <label className="visually-hidden" htmlFor={formatId}>
          {COPY.format}
        </label>
        <select
          id={formatId}
          value={control.format}
          disabled={control.busy}
          onChange={(event) => control.setFormat(event.target.value as typeof control.format)}
        >
          {EXPORT_FORMATS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button
          onClick={() => void control.save()}
          disabled={control.busy}
          icon={control.busy ? <LoaderCircle size={18} className="spin" /> : <Download size={18} />}
        >
          {control.busy ? COPY.preparing : COPY.export}
        </Button>
      </div>
      <div className="separate-downloads">
        <Button variant="text" onClick={control.saveOriginal} disabled={control.busy}>
          {COPY.original}
        </Button>
        <Button variant="text" onClick={control.saveJson} disabled={control.busy}>
          {COPY.json}
        </Button>
      </div>
      {control.error && (
        <p className="inline-error" role="alert">
          {control.error}
        </p>
      )}
    </div>
  );
}
