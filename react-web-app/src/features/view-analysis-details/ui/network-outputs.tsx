import type { RecognitionResult } from '@/entities/recognition-result';
import { SceneIcon } from '@/entities/scene';
import { formatPercent } from '@/shared/lib/format';
import { DetailsSection, ValueTrack } from '@/shared/ui';

const COPY = {
  title: 'Neural network outputs',
  explanation: (minScore: number, minMargin: number) =>
    `One sigmoid output per supported scene, in model order. These are independent model scores, not calibrated probabilities, and do not need to add up to 100%. A result is marked uncertain when the top score is below ${formatPercent(minScore, 0)} or leads the runner-up by less than ${(minMargin * 100).toFixed(0)} points.`,
} as const;

export function NetworkOutputs({ result }: { result: RecognitionResult }) {
  const outputs = result.model.classes.map((label) => ({
    label,
    score: result.predictions.find((item) => item.label.id === label.id)?.score ?? 0,
  }));
  return (
    <DetailsSection title={COPY.title}>
      <ol className="prediction-list scene-outputs">
        {outputs.map(({ label, score }) => (
          <li key={label.id} className={label.id === result.prediction.label.id ? 'is-top' : ''}>
            <span>
              <SceneIcon id={label.id} size={15} />
              {label.displayName}
            </span>
            <ValueTrack value={score} className="output-track" />
            <strong>{formatPercent(score)}</strong>
          </li>
        ))}
      </ol>
      <p className="fine-print">
        {COPY.explanation(result.model.uncertainty.minScore, result.model.uncertainty.minMargin)}
      </p>
    </DetailsSection>
  );
}
