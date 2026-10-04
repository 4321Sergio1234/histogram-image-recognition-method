/** Encodes RGBA pixels as a bottom-up, row-padded 24-bit Windows bitmap. */
export function encodeBmp(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
): ArrayBuffer {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 24_000_000 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('Invalid bitmap dimensions or pixel buffer.');
  }
  const stride = (width * 3 + 3) & ~3;
  const pixelsSize = stride * height;
  const buffer = new ArrayBuffer(54 + pixelsSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([66, 77]);
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelsSize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = 54 + (height - y - 1) * stride + x * 3;
      const alpha = rgba[source + 3] / 255;
      bytes[target] = Math.round(rgba[source + 2] * alpha + 255 * (1 - alpha));
      bytes[target + 1] = Math.round(rgba[source + 1] * alpha + 255 * (1 - alpha));
      bytes[target + 2] = Math.round(rgba[source] * alpha + 255 * (1 - alpha));
    }
  }
  return buffer;
}
