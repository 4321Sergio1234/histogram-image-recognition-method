const COPY = { dark: '0 · Dark', light: 'Light · 255' } as const;

interface BrightnessHistogramProps {
  values: readonly number[];
  max: number;
  label: string;
  caption: string;
  tone: string;
}

export function BrightnessHistogram({
  values,
  max,
  label,
  caption,
  tone,
}: BrightnessHistogramProps) {
  const scale = Math.max(1, max);
  return (
    <figure className="histogram">
      <svg viewBox="0 0 512 112" role="img" aria-label={label}>
        {values.map((value, index) => (
          <rect
            key={index}
            x={index * 2}
            y={104 - (value / scale) * 100}
            width="1.7"
            height={Math.max(0.2, (value / scale) * 100)}
            fill={tone}
          />
        ))}
        <line x1="0" y1="105" x2="512" y2="105" stroke="#d3d9cb" />
      </svg>
      <figcaption>
        <span>{COPY.dark}</span>
        <span>{caption}</span>
        <span>{COPY.light}</span>
      </figcaption>
    </figure>
  );
}
