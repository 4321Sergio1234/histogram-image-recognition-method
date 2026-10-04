import type { RecognitionResult } from '@/entities/recognition-result';
import { formatDuration } from '@/shared/lib/format';
import { DetailsSection } from '@/shared/ui';

const COPY = {
  title: 'Processing time',
  caption: 'Recognition timing in milliseconds',
  stage: 'Stage',
  time: 'Time',
  decode: 'Image decode',
  pixels: 'Pixel extraction',
  features: 'Histogram & 4-bit encoding',
  preprocessing: 'Preprocessing total',
  inference: 'Neural network',
  total: 'Total analysis',
  worker: 'Histogram and neural network computed in a Web Worker.',
  fallback: 'Computed on the main thread using the browser fallback.',
  scope:
    'Total includes pipeline overhead; downloading the model and rendering the interface are excluded.',
} as const;

export function ProcessingTimes({ result }: { result: RecognitionResult }) {
  const timings = [
    [COPY.decode, result.timings.decodeMs],
    [COPY.pixels, result.timings.pixelsMs],
    [COPY.features, result.timings.featuresMs],
    [
      COPY.preprocessing,
      result.timings.decodeMs + result.timings.pixelsMs + result.timings.featuresMs,
    ],
    [COPY.inference, result.timings.inferenceMs],
    [COPY.total, result.timings.totalMs],
  ] as const;
  return (
    <DetailsSection title={COPY.title}>
      <table className="timings-table">
        <caption className="visually-hidden">{COPY.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.stage}</th>
            <th scope="col">{COPY.time}</th>
          </tr>
        </thead>
        <tbody>
          {timings.map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{formatDuration(value, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine-print">
        {result.execution === 'worker' ? COPY.worker : COPY.fallback} {COPY.scope}
      </p>
    </DetailsSection>
  );
}
