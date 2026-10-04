import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ImagePlus,
  Info,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionProgress, RecognitionResult } from '@/entities/recognition-result';
import { UploadImage } from '@/features/upload-image';
import { CaptureImage } from '@/features/capture-image';

function SceneIllustration() {
  return (
    <svg
      className="scene-illustration"
      width="156"
      height="120"
      viewBox="0 0 156 120"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="112" cy="30" r="12" fill="#df9c68" />
      <path d="M8 88c18-26 44-34 70-18 18 11 38 6 70-14v32Z" fill="#e3c38f" />
      <path d="M40 88c16-14 34-17 52-8 14 7 30 5 56-8v16Z" fill="#cfa46c" />
      <path d="M22 88 28 70l6 18Zm12 0 7-24 7 24Z" fill="#537155" />
      <path d="M8 90h140v14c0 6-5 10-11 10H19c-6 0-11-4-11-10Z" fill="#8fb3c4" />
      <path
        d="M18 98c6-3 10 3 16 0s10 3 16 0 10 3 16 0m16 0c6-3 10 3 16 0s10 3 16 0 10 3 16 0M30 106c6-3 10 3 16 0s10 3 16 0m20 0c6-3 10 3 16 0s10 3 16 0"
        stroke="#f7f7eb"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m24 26 4-4m104 70 4 1M16 60l4 1"
        stroke="#c4c9b7"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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
}: {
  image: SelectedImage | null;
  result: RecognitionResult | null;
  progress: RecognitionProgress | null;
  selecting: boolean;
  analyzing: boolean;
  canAnalyze: boolean;
  error: string;
  onSelect: (file: File) => void;
  onCapture: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onInfo: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const busy = selecting || analyzing;
  return (
    <section className="workspace" aria-label="Recognition workspace" aria-busy={busy}>
      <div className="workspace-topline">
        <span className="section-label">{image ? 'YOUR PHOTO' : 'START WITH A PHOTO'}</span>
        <span className="private-label">
          <ShieldCheck size={14} />
          Private by design
        </span>
      </div>
      {!image ? (
        <div
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) {
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file && !busy) {
              onSelect(file);
            }
          }}
        >
          {selecting ? (
            <div className="empty-loading">
              <LoaderCircle className="spin" size={38} />
              <h2>Getting your photo ready</h2>
              <p>Checking the image, right here on your device.</p>
            </div>
          ) : (
            <>
              <SceneIllustration />
              <h2>Add a scene photo</h2>
              <p>Drop a photo here, or choose one to get started.</p>
              <div className="input-actions">
                <UploadImage onSelect={onSelect} disabled={busy} />
                <CaptureImage onCapture={onCapture} disabled={busy} />
              </div>
              <span className="format-note">JPG, PNG or WebP · up to 20 MB</span>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="image-preview">
            <img src={image.previewUrl} alt="Selected scene photo" />
            <span className="preview-tag">
              <ImagePlus size={13} />
              {image.metadata.width} × {image.metadata.height}
            </span>
            {result && (
              <span className={`analyzed-tag ${result.uncertain ? 'uncertain' : ''}`}>
                <Check size={13} />
                Analyzed locally
              </span>
            )}
            {selecting && (
              <div className="preview-overlay">
                <LoaderCircle size={30} className="spin" />
                <p>Preparing image…</p>
              </div>
            )}
          </div>
          <div className="image-caption">
            <div>
              <span className="file-name">{image.metadata.name}</span>
              <span className="file-source">
                {image.metadata.source === 'camera' ? 'Camera capture' : 'From your device'}
              </span>
            </div>
            <button
              className="icon-button info-button"
              onClick={onInfo}
              aria-label="Image information"
            >
              <Info size={19} />
            </button>
          </div>
          {analyzing ? (
            <div className="progress-panel" role="status" aria-live="polite">
              <div>
                <LoaderCircle size={18} className="spin" />
                <strong>{progress?.label ?? 'Preparing analysis'}</strong>
                {progress && (
                  <span>
                    {progress.step} / {progress.totalSteps}
                  </span>
                )}
              </div>
              <progress
                aria-label="Recognition progress"
                value={progress?.step ?? 0}
                max={progress?.totalSteps ?? 8}
              />
              <p>Working on your device. Your photo never leaves this page.</p>
            </div>
          ) : (
            <div className="workspace-actions">
              <button className="button button-text" onClick={onReset} disabled={busy}>
                <RotateCcw size={16} />
                {result ? 'Analyze another image' : 'Start over'}
              </button>
              {!result && (
                <button
                  className="button button-primary"
                  onClick={onAnalyze}
                  disabled={busy || !canAnalyze}
                >
                  <ScanLine size={18} />
                  Analyze image
                  <ArrowRight size={17} />
                </button>
              )}
              {result && (
                <UploadImage onSelect={onSelect} variant="secondary" label="Change image" />
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <div className="error-message" role="alert">
          <Info size={18} />
          <div>
            <strong>We couldn’t finish that</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {!image && (
        <div className="workspace-bottom">
          <span className="small-step">01</span>
          <p>A sea, a forest or a desert. The whole view, in natural light.</p>
        </div>
      )}
    </section>
  );
}
