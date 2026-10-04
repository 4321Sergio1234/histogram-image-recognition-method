import { LoaderCircle } from 'lucide-react';
import type { RecognitionProgress as Progress } from '@/entities/recognition-result';

const COPY = {
  preparing: 'Preparing analysis',
  label: 'Recognition progress',
  privacy: 'Working on your device. Your photo never leaves this page.',
  stages: (step: number, total: number) => `${step} / ${total}`,
} as const;

export function RecognitionProgress({ progress }: { progress: Progress | null }) {
  return (
    <div className="progress-panel" role="status" aria-live="polite">
      <div>
        <LoaderCircle size={18} className="spin" />
        <strong>{progress?.label ?? COPY.preparing}</strong>
        {progress && <span>{COPY.stages(progress.step, progress.totalSteps)}</span>}
      </div>
      <progress
        aria-label={COPY.label}
        value={progress?.step ?? 0}
        max={progress?.totalSteps ?? 8}
      />
      <p>{COPY.privacy}</p>
    </div>
  );
}
