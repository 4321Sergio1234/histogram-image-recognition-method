import { describe, expect, it } from 'vitest';
import {
  brightnessHistogram,
  encodeFourBits,
  extractFeatures,
  luminance,
  quantizeHistogram,
} from '../src/core';

describe('canonical brightness features', () => {
  it.each([
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [255, 0, 0, 76],
    [0, 255, 0, 150],
    [0, 0, 255, 29],
  ])('uses article luma coefficients for (%i,%i,%i)', (red, green, blue, expected) =>
    expect(luminance(red, green, blue)).toBe(expected),
  );
  it('creates exactly 256 bins and conserves pixel counts', () => {
    const histogram = brightnessHistogram(
      new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]),
    );
    expect(histogram).toHaveLength(256);
    expect(histogram[0]).toBe(2);
    expect(histogram[255]).toBe(1);
    expect(histogram.reduce((a, b) => a + b)).toBe(3);
  });
  it('composites alpha onto white consistently', () => {
    expect(brightnessHistogram(new Uint8Array([0, 0, 0, 0]))[255]).toBe(1);
    expect(brightnessHistogram(new Uint8Array([0, 0, 0, 128]))[127]).toBe(1);
  });
  it.each([[], [1, 2, 3], [1, 2, 3, 4, 5]].map((input) => ({ input })))(
    'rejects empty or incomplete RGBA: %j',
    ({ input }) => expect(() => extractFeatures(new Uint8Array(input))).toThrow(),
  );
  it('quantizes against the maximum with nearest integer rounding', () => {
    const bins = new Array<number>(256).fill(0);
    bins[0] = 30;
    bins[1] = 15;
    bins[2] = 1;
    expect(quantizeHistogram(bins).slice(0, 4)).toEqual([15, 8, 1, 0]);
  });
  it('handles an all-zero histogram without NaN', () =>
    expect(quantizeHistogram(new Array<number>(256).fill(0))).toEqual(
      new Array<number>(256).fill(0),
    ));
  it.each([-1, NaN, Infinity])('rejects invalid histogram magnitudes: %j', (invalid) => {
    const bins = new Array<number>(256).fill(0);
    bins[42] = invalid;
    expect(() => quantizeHistogram(bins)).toThrow();
  });
  it('rejects incorrect histogram size', () => expect(() => quantizeHistogram([1])).toThrow());
  it('encodes every four-bit integer MSB-first', () => {
    const bins = new Array<number>(256).fill(0);
    for (let value = 0; value < 16; value++) {
      bins[value] = value;
    }
    const encoded = encodeFourBits(bins);
    expect(encoded).toHaveLength(1024);
    for (let value = 0; value < 16; value++) {
      expect(encoded.slice(value * 4, value * 4 + 4).join('')).toBe(
        value.toString(2).padStart(4, '0'),
      );
    }
  });
  it.each([16, -1, 1.1, NaN])('rejects unencodable quantized value %s', (value) => {
    const bins = new Array<number>(256).fill(0);
    bins[0] = value;
    expect(() => encodeFourBits(bins)).toThrow();
  });
  it('is independent of Uint8Array vs browser Uint8ClampedArray', () => {
    const data = [14, 80, 230, 255, 101, 15, 11, 128];
    expect(extractFeatures(new Uint8Array(data))).toEqual(
      extractFeatures(new Uint8ClampedArray(data)),
    );
  });
  it('uses all native pixels and is invariant to order', () => {
    const a = [0, 0, 0, 255];
    const b = [255, 255, 255, 255];
    expect(extractFeatures(new Uint8Array([...a, ...b]))).toEqual(
      extractFeatures(new Uint8Array([...b, ...a])),
    );
  });
});

it('keeps the controlled square-root variant in four-bit range with the same 1024-input contract', () => {
  const histogram = Array.from({ length: 256 }, (_, i) => i);
  const quantized = quantizeHistogram(histogram, 'sqrt-max15');
  expect(quantized[0]).toBe(0);
  expect(quantized[255]).toBe(15);
  expect(quantized.every((value) => Number.isInteger(value) && value >= 0 && value <= 15)).toBe(
    true,
  );
  expect(encodeFourBits(quantized)).toHaveLength(1024);
  expect(quantized[64]).toBe(8);
});
