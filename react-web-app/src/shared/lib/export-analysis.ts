import { encodeBmp } from './bmp';
import { decodeImage, type SelectedImage } from './image-input';

export type ExportFormat = 'png' | 'jpeg' | 'bmp';

const COPY = {
  brand: 'HORIZON',
  description: 'Natural scene recognition, on your device.',
  palette: 'Palette scope: blue/cyan sea, green forest, warm sandy desert.',
  limitation: 'Lighting and palette changes can lead to a wrong result.',
  unsupported: 'Your browser could not create the export. Try another browser.',
  failed: 'The image could not be exported. Please retry.',
  prediction: (uncertain: boolean, score: number) =>
    `${uncertain ? 'Uncertain result' : 'Predicted scene'} · Model confidence ${(score * 100).toFixed(1)}%`,
  scope: (scenes: string) =>
    `Recognizes only ${scenes} scenes. Confidence is an uncalibrated model score.`,
  model: (version: string) => `Processed locally · Model ${version}`,
  unsupportedFormat: (format: string) =>
    `This browser does not support ${format.toUpperCase()} export.`,
} as const;

interface ExportResult {
  prediction: { label: { displayName: string }; score: number };
  uncertain: boolean;
  model: { version: string; classes: { displayName: string }[]; domain?: { description: string } };
  completedAt: string;
}

export function analysisFilename(name: string, format: ExportFormat): string {
  const safe =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'scene';
  return `horizon-${safe}-analysis.${format === 'jpeg' ? 'jpg' : format}`;
}

function sceneList(names: string[]): string {
  const lower = names.map((name) => name.toLowerCase());
  return lower.length < 2 ? lower.join('') : `${lower.slice(0, -1).join(', ')} and ${lower.at(-1)}`;
}

/** Renders a shareable result card in memory with a browser-native or BMP encoder. */
export async function exportAnalysis(
  image: SelectedImage,
  result: ExportResult,
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1320;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(COPY.unsupported);
  }
  const decoded = await decodeImage(image.file);
  try {
    context.fillStyle = '#f5f4ef';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#254d38';
    context.font = '600 34px system-ui, sans-serif';
    context.fillText(COPY.brand, 64, 82);
    context.font = '22px system-ui, sans-serif';
    context.fillStyle = '#636c63';
    context.fillText(COPY.description, 64, 122);
    const scale = Math.min(1072 / decoded.width, 730 / decoded.height);
    const width = decoded.width * scale;
    const height = decoded.height * scale;
    context.fillStyle = '#e8ebe3';
    context.fillRect(64, 164, 1072, 730);
    context.drawImage(
      decoded.source,
      64 + (1072 - width) / 2,
      164 + (730 - height) / 2,
      width,
      height,
    );
    context.fillStyle = '#203429';
    context.font = '600 52px system-ui, sans-serif';
    context.fillText(result.prediction.label.displayName, 64, 982, 1072);
    context.font = '28px system-ui, sans-serif';
    context.fillStyle = '#48614b';
    context.fillText(COPY.prediction(result.uncertain, result.prediction.score), 64, 1036, 1072);
    context.fillStyle = '#687168';
    context.font = '23px system-ui, sans-serif';
    context.fillText(
      COPY.scope(sceneList(result.model.classes.map((label) => label.displayName))),
      64,
      1100,
      1072,
    );
    context.font = '20px system-ui, sans-serif';
    context.fillText(result.model.domain ? COPY.palette : COPY.limitation, 64, 1130, 1072);
    context.fillRect(64, 1153, 1072, 1);
    context.font = '20px system-ui, sans-serif';
    context.fillText(COPY.model(result.model.version), 64, 1192, 1072);
    context.fillText(new Date(result.completedAt).toLocaleString(), 64, 1232);
    const blob =
      format === 'bmp'
        ? new Blob(
            [
              encodeBmp(
                canvas.width,
                canvas.height,
                context.getImageData(0, 0, canvas.width, canvas.height).data,
              ),
            ],
            { type: 'image/bmp' },
          )
        : await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error(COPY.failed))),
              `image/${format}`,
              0.92,
            ),
          );
    if (blob.type !== `image/${format}`) {
      throw new Error(COPY.unsupportedFormat(format));
    }
    return { blob, filename: analysisFilename(result.prediction.label.displayName, format) };
  } finally {
    decoded.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  try {
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
