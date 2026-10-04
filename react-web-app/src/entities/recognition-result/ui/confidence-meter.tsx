import { ValueTrack } from '@/shared/ui';

const COPY = {
  label: 'Model confidence',
  unit: '%',
  explanation: 'An uncalibrated model score, not a probability of being right.',
} as const;

export function ConfidenceMeter({ score }: { score: number }) {
  return (
    <div className="score-block">
      <div>
        <span>{COPY.label}</span>
        <strong>
          {(score * 100).toFixed(1)}
          <small>{COPY.unit}</small>
        </strong>
      </div>
      <ValueTrack value={score} className="score-track" as="div" />
      <p>{COPY.explanation}</p>
    </div>
  );
}
