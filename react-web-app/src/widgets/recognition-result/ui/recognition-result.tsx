import { ArrowUpRight, CircleAlert, Clock3, ScanSearch } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import { ConfidenceMeter, type RecognitionResult as Result } from '@/entities/recognition-result';
import { SceneIcon, sceneList } from '@/entities/scene';
import { ExportAnalysis } from '@/features/export-analysis';
import { formatDuration } from '@/shared/lib/format';
import { Button } from '@/shared/ui';
import { ResultAlternatives } from './result-alternatives';

const COPY = {
  label: 'Recognition result',
  eyebrow: 'YOUR SCENE',
  uncertain: 'Uncertain result',
  predicted: 'Predicted scene',
  uncertainDescription: 'The model isn’t sure about this photo.',
  description: 'Based on the brightness pattern of the whole photo.',
  local: 'processed locally',
  details: 'Analysis details',
  uncertainty: (scenes: string) =>
    `The model recognizes only ${scenes} scenes. If this photo shows something else — a city, a room or a person — the result isn’t meaningful. Otherwise, try a wider shot in daylight.`,
  limitation: (scenes: string) =>
    `Horizon recognizes ${scenes} scenes only. Every photo receives one of these labels. Lighting and palette changes can lead to a wrong result.`,
} as const;

export function RecognitionResult({
  image,
  result,
  onDetails,
}: {
  image: SelectedImage;
  result: Result;
  onDetails: () => void;
}) {
  const { label, score } = result.prediction;
  const alternatives = result.predictions
    .filter((prediction) => prediction.label.id !== label.id)
    .slice(0, 2);
  const supported = sceneList(result.model.classes.map((scene) => scene.displayName));
  return (
    <section className="result-panel" data-testid="recognition-result" aria-label={COPY.label}>
      <div className="result-eyebrow">
        <span className="section-label">{COPY.eyebrow}</span>
        <SceneIcon id={label.id} size={18} />
      </div>
      <div className={`result-status ${result.uncertain ? 'is-uncertain' : ''}`}>
        {result.uncertain ? <CircleAlert size={15} /> : <ScanSearch size={15} />}
        {result.uncertain ? COPY.uncertain : COPY.predicted}
      </div>
      <h2>{label.displayName}</h2>
      <p className="result-subtitle">
        {result.uncertain ? COPY.uncertainDescription : COPY.description}
      </p>
      <ConfidenceMeter score={score} />
      <ResultAlternatives predictions={alternatives} />
      {result.uncertain && (
        <div className="uncertainty-note">
          <CircleAlert size={17} />
          <p>{COPY.uncertainty(supported)}</p>
        </div>
      )}
      <div className="result-timing">
        <Clock3 size={15} />
        <span>{formatDuration(result.timings.totalMs)}</span>
        <span className="muted">{COPY.local}</span>
      </div>
      <p className="result-limitation">{COPY.limitation(supported)}</p>
      {result.model.domain && (
        <p className="result-limitation">{result.model.domain.description}</p>
      )}
      <div className="result-actions">
        <ExportAnalysis image={image} result={result} />
        <Button
          variant="text"
          className="details-button"
          onClick={onDetails}
          trailingIcon={<ArrowUpRight size={16} />}
        >
          {COPY.details}
        </Button>
      </div>
    </section>
  );
}
