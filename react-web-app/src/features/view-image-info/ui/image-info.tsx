import type { SelectedImage } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { formatBytes, formatDimensions, formatDuration } from '@/shared/lib/format';
import { DefinitionList, Dialog } from '@/shared/ui';

const COPY = {
  title: 'Image information',
  description: 'The details of your selected photo.',
  filename: 'Filename',
  format: 'Format',
  size: 'File size',
  dimensions: 'Dimensions',
  pixels: 'Pixels',
  source: 'Source',
  camera: 'Camera',
  file: 'File or gallery',
  timing: 'Processing time',
  privacy: 'Held in memory for this analysis. The photo is never uploaded or saved by Horizon.',
} as const;

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
  const items = [
    { label: COPY.filename, value: metadata.name },
    { label: COPY.format, value: metadata.mimeType },
    { label: COPY.size, value: formatBytes(metadata.sizeBytes) },
    { label: COPY.dimensions, value: formatDimensions(metadata.width, metadata.height) },
    { label: COPY.pixels, value: metadata.pixelCount.toLocaleString() },
    { label: COPY.source, value: metadata.source === 'camera' ? COPY.camera : COPY.file },
    ...(result ? [{ label: COPY.timing, value: formatDuration(result.timings.totalMs) }] : []),
  ];
  return (
    <Dialog open={open} onClose={onClose} title={COPY.title} description={COPY.description}>
      <DefinitionList items={items} />
      <p className="fine-print">{COPY.privacy}</p>
    </Dialog>
  );
}
