import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { SceneIllustration } from '@/entities/scene';
import { UploadImage } from '@/features/upload-image';
import { CaptureImage } from '@/features/capture-image';

const COPY = {
  preparingTitle: 'Getting your photo ready',
  preparingDescription: 'Checking the image, right here on your device.',
  title: 'Add a scene photo',
  description: 'Drop a photo here, or choose one to get started.',
  formats: 'JPG, PNG or WebP · up to 20 MB',
} as const;

export function ImageDropzone({
  selecting,
  disabled,
  onSelect,
  onCapture,
}: {
  selecting: boolean;
  disabled: boolean;
  onSelect: (file: File) => void;
  onCapture: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`dropzone ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !disabled) {
          onSelect(file);
        }
      }}
    >
      {selecting ? (
        <div className="empty-loading">
          <LoaderCircle className="spin" size={38} />
          <h2>{COPY.preparingTitle}</h2>
          <p>{COPY.preparingDescription}</p>
        </div>
      ) : (
        <>
          <SceneIllustration />
          <h2>{COPY.title}</h2>
          <p>{COPY.description}</p>
          <div className="input-actions">
            <UploadImage onSelect={onSelect} disabled={disabled} />
            <CaptureImage onCapture={onCapture} disabled={disabled} />
          </div>
          <span className="format-note">{COPY.formats}</span>
        </>
      )}
    </div>
  );
}
