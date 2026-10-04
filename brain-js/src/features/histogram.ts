import type { FeatureResult } from '../core/contracts';

export const HISTOGRAM_BINS = 256;
export const FEATURE_LENGTH = 1024;

/** Converts an sRGB pixel into the nearest integer luma bin. */
export function luminance(red: number, green: number, blue: number): number {
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
}

/** Counts native-resolution RGBA pixels, compositing transparency onto white. */
export function brightnessHistogram(rgba: Uint8ClampedArray | Uint8Array): number[] {
  if (!rgba.length || rgba.length % 4 !== 0) {
    throw new Error('Expected a non-empty RGBA pixel array.');
  }
  const histogram = new Array<number>(HISTOGRAM_BINS).fill(0);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    const white = 255 * (1 - alpha);
    const bin = luminance(
      rgba[i] * alpha + white,
      rgba[i + 1] * alpha + white,
      rgba[i + 2] * alpha + white,
    );
    histogram[bin] += 1;
  }
  return histogram;
}

/** Scales counts against the largest bin and rounds to the nearest four-bit integer. */
export function quantizeHistogram(
  histogram: readonly number[],
  normalization: 'max15' | 'sqrt-max15' = 'max15',
): number[] {
  if (
    histogram.length !== HISTOGRAM_BINS ||
    histogram.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error('A histogram must contain 256 finite non-negative counts.');
  }
  const maximum = Math.max(...histogram);
  return histogram.map((value) =>
    maximum === 0
      ? 0
      : Math.round(
          (normalization === 'sqrt-max15' ? Math.sqrt(value / maximum) : value / maximum) * 15,
        ),
  );
}

/** Encodes each integer as four binary inputs, most significant bit first. */
export function encodeFourBits(quantized: readonly number[]): number[] {
  if (
    quantized.length !== HISTOGRAM_BINS ||
    quantized.some((value) => !Number.isInteger(value) || value < 0 || value > 15)
  ) {
    throw new Error('Expected 256 integers in the range 0–15.');
  }
  return quantized.flatMap((value) => [
    (value >> 3) & 1,
    (value >> 2) & 1,
    (value >> 1) & 1,
    value & 1,
  ]);
}

export function extractFeatures(rgba: Uint8ClampedArray | Uint8Array): FeatureResult {
  const histogram = brightnessHistogram(rgba);
  const quantized = quantizeHistogram(histogram);
  return { histogram, quantized, features: encodeFourBits(quantized) };
}
