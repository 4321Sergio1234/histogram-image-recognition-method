import { ArrowRight, RotateCcw, ScanLine } from 'lucide-react';
import { UploadImage } from '@/features/upload-image';
import { Button } from '@/shared/ui';

const COPY = {
  again: 'Analyze another image',
  reset: 'Start over',
  analyze: 'Analyze image',
  change: 'Change image',
} as const;

export function WorkspaceActions({
  hasResult,
  busy,
  canAnalyze,
  onReset,
  onAnalyze,
  onSelect,
}: {
  hasResult: boolean;
  busy: boolean;
  canAnalyze: boolean;
  onReset: () => void;
  onAnalyze: () => void;
  onSelect: (file: File) => void;
}) {
  return (
    <div className="workspace-actions">
      <Button variant="text" onClick={onReset} disabled={busy} icon={<RotateCcw size={16} />}>
        {hasResult ? COPY.again : COPY.reset}
      </Button>
      {hasResult ? (
        <UploadImage onSelect={onSelect} variant="secondary" label={COPY.change} disabled={busy} />
      ) : (
        <Button
          onClick={onAnalyze}
          disabled={busy || !canAnalyze}
          icon={<ScanLine size={18} />}
          trailingIcon={<ArrowRight size={17} />}
        >
          {COPY.analyze}
        </Button>
      )}
    </div>
  );
}
