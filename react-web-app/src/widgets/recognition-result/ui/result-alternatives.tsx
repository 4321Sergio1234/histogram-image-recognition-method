import type { Prediction } from '@/entities/recognition-result';
import { formatPercent } from '@/shared/lib/format';

const COPY = {
  label: 'Other possible scenes',
  title: 'Also considered',
  confidence: ' model confidence',
} as const;

export function ResultAlternatives({ predictions }: { predictions: readonly Prediction[] }) {
  if (!predictions.length) {
    return null;
  }
  return (
    <section className="result-alternatives" aria-label={COPY.label}>
      <h3>{COPY.title}</h3>
      <ul>
        {predictions.map(({ label, score }) => (
          <li key={label.id}>
            <span>{label.displayName}</span>
            <span>
              {formatPercent(score)}
              <span className="visually-hidden">{COPY.confidence}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
