import { BrightnessHistogram } from '@/entities/image-analysis';
import type { RecognitionResult } from '@/entities/recognition-result';
import { DetailsSection } from '@/shared/ui';

const COPY = {
  title: 'Brightness histogram',
  originalLabel: 'Original 256-bin brightness histogram, from dark to light',
  originalCaption: 'Pixel counts · 256 bins',
  quantizedLabel: 'Quantized histogram, each bin scaled to 0–15',
  quantizedCaption: 'Quantized 0–15 · 4 bits each',
  facts: ['256 bins', '4 bits per bin', '1,024 input values'],
  method: (squareRoot: boolean) =>
    `Each pixel’s brightness is Y′ = 0.299R + 0.587G + 0.114B. Bin counts are scaled to the largest bin${squareRoot ? ' using a square-root mapping' : ''}, rounded to 0–15 and encoded as four binary values each.`,
} as const;

export function HistogramAnalysis({ result }: { result: RecognitionResult }) {
  return (
    <DetailsSection title={COPY.title}>
      <BrightnessHistogram
        values={result.histogram}
        max={Math.max(1, ...result.histogram)}
        label={COPY.originalLabel}
        caption={COPY.originalCaption}
        tone="#52745c"
      />
      <BrightnessHistogram
        values={result.quantized}
        max={15}
        label={COPY.quantizedLabel}
        caption={COPY.quantizedCaption}
        tone="#2f6f86"
      />
      <div className="technical-pills">
        {COPY.facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
      <p className="fine-print">
        {COPY.method(result.model.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2')}
      </p>
    </DetailsSection>
  );
}
