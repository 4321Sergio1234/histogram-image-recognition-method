import { ArrowUpRight, CircleAlert, Clock3, ScanSearch } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult as Result } from '@/entities/recognition-result';
import { SceneIcon, sceneList } from '@/entities/scene';
import { ExportAnalysis } from '@/features/export-analysis';
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
    <section
      className="result-panel"
      data-testid="recognition-result"
      aria-label="Recognition result"
    >
      <div className="result-eyebrow">
        <span className="section-label">YOUR SCENE</span>
        <SceneIcon id={label.id} size={18} />
      </div>
      <div className={`result-status ${result.uncertain ? 'is-uncertain' : ''}`}>
        {result.uncertain ? <CircleAlert size={15} /> : <ScanSearch size={15} />}
        {result.uncertain ? 'Uncertain result' : 'Predicted scene'}
      </div>
      <h2>{label.displayName}</h2>
      <p className="result-subtitle">
        {result.uncertain
          ? 'The model isn’t sure about this photo.'
          : 'Based on the brightness pattern of the whole photo.'}
      </p>
      <div className="score-block">
        <div>
          <span>Model confidence</span>
          <strong>
            {(score * 100).toFixed(1)}
            <small>%</small>
          </strong>
        </div>
        <div className="score-track">
          <span style={{ width: `${Math.max(0, Math.min(100, score * 100))}%` }} />
        </div>
        <p>An uncalibrated model score, not a probability of being right.</p>
      </div>
      {alternatives.length > 0 && (
        <section className="result-alternatives" aria-label="Other possible scenes">
          <h3>Also considered</h3>
          <ul>
            {alternatives.map((prediction) => (
              <li key={prediction.label.id}>
                <span>{prediction.label.displayName}</span>
                <span>
                  {(prediction.score * 100).toFixed(1)}%
                  <span className="visually-hidden"> model confidence</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.uncertain && (
        <div className="uncertainty-note">
          <CircleAlert size={17} />
          <p>
            The model recognizes only {supported} scenes. If this photo shows something else — a
            city, a room or a person — the result isn’t meaningful. Otherwise, try a wider shot in
            daylight.
          </p>
        </div>
      )}
      <div className="result-timing">
        <Clock3 size={15} />
        <span>{result.timings.totalMs.toFixed(1)} ms</span>
        <span className="muted">processed locally</span>
      </div>
      <p className="result-limitation">
        Horizon recognizes {supported} scenes only. Every photo receives one of these labels.
        Lighting and palette changes can lead to a wrong result.
      </p>
      {result.model.domain && (
        <p className="result-limitation">{result.model.domain.description}</p>
      )}
      <div className="result-actions">
        <ExportAnalysis image={image} result={result} />
        <button className="button button-text details-button" onClick={onDetails}>
          Analysis details
          <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}
