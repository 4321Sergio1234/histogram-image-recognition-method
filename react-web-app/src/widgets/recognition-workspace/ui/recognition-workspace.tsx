import { Info, ShieldCheck } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type {
  RecognitionProgress as Progress,
  RecognitionResult,
} from '@/entities/recognition-result';
import { ImageDropzone } from './image-dropzone';
import { SelectedPhoto } from './selected-photo';
import { RecognitionProgress } from './recognition-progress';
import { WorkspaceActions } from './workspace-actions';

const COPY = {
  label: 'Recognition workspace',
  selected: 'YOUR PHOTO',
  empty: 'START WITH A PHOTO',
  privacy: 'Private by design',
  error: 'We couldn’t finish that',
  step: '01',
  guidance: 'A sea, a forest or a desert. The whole view, in natural light.',
} as const;

interface RecognitionWorkspaceProps {
  image: SelectedImage | null;
  result: RecognitionResult | null;
  progress: Progress | null;
  selecting: boolean;
  analyzing: boolean;
  canAnalyze: boolean;
  error: string;
  onSelect: (file: File) => void;
  onCapture: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onInfo: () => void;
}

export function RecognitionWorkspace({
  image,
  result,
  progress,
  selecting,
  analyzing,
  canAnalyze,
  error,
  onSelect,
  onCapture,
  onAnalyze,
  onReset,
  onInfo,
}: RecognitionWorkspaceProps) {
  const busy = selecting || analyzing;
  return (
    <section className="workspace" aria-label={COPY.label} aria-busy={busy}>
      <div className="workspace-topline">
        <span className="section-label">{image ? COPY.selected : COPY.empty}</span>
        <span className="private-label">
          <ShieldCheck size={14} />
          {COPY.privacy}
        </span>
      </div>
      {!image ? (
        <ImageDropzone
          selecting={selecting}
          disabled={busy}
          onSelect={onSelect}
          onCapture={onCapture}
        />
      ) : (
        <>
          <SelectedPhoto image={image} result={result} selecting={selecting} onInfo={onInfo} />
          {analyzing ? (
            <RecognitionProgress progress={progress} />
          ) : (
            <WorkspaceActions
              hasResult={!!result}
              busy={busy}
              canAnalyze={canAnalyze}
              onReset={onReset}
              onAnalyze={onAnalyze}
              onSelect={onSelect}
            />
          )}
        </>
      )}
      {error && (
        <div className="error-message" role="alert">
          <Info size={18} />
          <div>
            <strong>{COPY.error}</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {!image && (
        <div className="workspace-bottom">
          <span className="small-step">{COPY.step}</span>
          <p>{COPY.guidance}</p>
        </div>
      )}
    </section>
  );
}
