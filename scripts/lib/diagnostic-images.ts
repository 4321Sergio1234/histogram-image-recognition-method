import sharp from 'sharp';
import { basename } from 'node:path';
export const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export async function contactSheet(
  rows: { file: string; caption: string }[],
  destination: string,
  title: string,
  columns = 5,
) {
  const cellWidth = 220,
    cellHeight = 192,
    header = 48;
  const width = columns * cellWidth,
    height = header + Math.ceil(rows.length / columns) * cellHeight;
  const tiles = await Promise.all(
    rows.map(async (row, i) => ({
      input: await sharp(row.file)
        .rotate()
        .resize(208, 148, { fit: 'contain', background: '#eee' })
        .jpeg()
        .toBuffer(),
      left: (i % columns) * cellWidth + 6,
      top: header + Math.floor(i / columns) * cellHeight,
    })),
  );
  const text = `<svg width="${width}" height="${height}"><g font-family="Arial" fill="#182f26"><text x="10" y="28" font-size="20">${escapeXml(title)}</text>${rows.map((row, i) => `<text x="${(i % columns) * cellWidth + 6}" y="${header + Math.floor(i / columns) * cellHeight + 163}" font-size="11">${escapeXml(`${i + 1}. ${row.caption}`)}</text><text x="${(i % columns) * cellWidth + 6}" y="${header + Math.floor(i / columns) * cellHeight + 180}" font-size="10">${escapeXml(basename(row.file).slice(0, 32))}</text>`).join('')}</g></svg>`;
  await sharp({ create: { width, height, channels: 3, background: '#fafaf7' } })
    .composite([...tiles, { input: Buffer.from(text), left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toFile(destination);
}
export {
  perceptualHash,
  transformSquare,
  hamming,
  thumbnailSimilarity,
} from '../../brain-js/src/dataset/perceptual';
