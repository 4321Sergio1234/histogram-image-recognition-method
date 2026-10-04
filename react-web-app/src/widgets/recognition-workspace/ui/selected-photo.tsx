import { Check, ImagePlus, Info, LoaderCircle } from 'lucide-react';
import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { IconButton } from '@/shared/ui';

const COPY = {
  photo: 'Selected scene photo',
  analyzed: 'Analyzed locally',
  preparing: 'Preparing image…',
  camera: 'Camera capture',
  file: 'From your device',
  info: 'Image information',
  dimensions: (width: number, height: number) => `${width} × ${height}`,
} as const;

export function SelectedPhoto({
  image,
  result,
  selecting,
  onInfo,
}: {
  image: SelectedImage;
  result: RecognitionResult | null;
  selecting: boolean;
  onInfo: () => void;
}) {
  return (
    <>
      <div className="image-preview">
        <img src={image.previewUrl} alt={COPY.photo} />
        <span className="preview-tag">
          <ImagePlus size={13} />
          {COPY.dimensions(image.metadata.width, image.metadata.height)}
        </span>
        {result && (
          <span className={`analyzed-tag ${result.uncertain ? 'uncertain' : ''}`}>
            <Check size={13} />
            {COPY.analyzed}
          </span>
        )}
        {selecting && (
          <div className="preview-overlay">
            <LoaderCircle size={30} className="spin" />
            <p>{COPY.preparing}</p>
          </div>
        )}
      </div>
      <div className="image-caption">
        <div>
          <span className="file-name">{image.metadata.name}</span>
          <span className="file-source">
            {image.metadata.source === 'camera' ? COPY.camera : COPY.file}
          </span>
        </div>
        <IconButton className="info-button" onClick={onInfo} label={COPY.info}>
          <Info size={19} />
        </IconButton>
      </div>
    </>
  );
}
