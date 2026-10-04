import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { Dialog } from '@/shared/ui';
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
export function ImageInfo({
  image,
  result,
  open,
  onClose,
}: {
  image: SelectedImage;
  result: RecognitionResult | null;
  open: boolean;
  onClose: () => void;
}) {
  const metadata = image.metadata;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Image information"
      description="The details of your selected photo."
    >
      <dl className="definition-list">
        <div>
          <dt>Filename</dt>
          <dd>{metadata.name}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{metadata.mimeType}</dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>{formatBytes(metadata.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>
            {metadata.width.toLocaleString()} × {metadata.height.toLocaleString()} px
          </dd>
        </div>
        <div>
          <dt>Pixels</dt>
          <dd>{metadata.pixelCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{metadata.source === 'camera' ? 'Camera' : 'File or gallery'}</dd>
        </div>
        {result && (
          <div>
            <dt>Processing time</dt>
            <dd>{result.timings.totalMs.toFixed(1)} ms</dd>
          </div>
        )}
      </dl>
      <p className="fine-print">
        Held in memory for this analysis. The photo is never uploaded or saved by Horizon.
      </p>
    </Dialog>
  );
}
