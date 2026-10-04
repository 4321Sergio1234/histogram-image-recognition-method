import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  contactSheet,
  perceptualHash,
  transformSquare,
  hamming,
  thumbnailSimilarity,
} from './lib/diagnostic-images';
import { imageFile } from '../brain-js/src/dataset/audit';
import type { DatasetAudit } from '../brain-js/src/dataset/types';
const directory = resolve('../docs/lab2/data/model-diagnostics/external-sanity');
const sources = JSON.parse(await readFile(resolve(directory, 'sources.json'), 'utf8')) as {
  images: { file: string; classId: string; title: string; status: string }[];
};
const audit = JSON.parse(await readFile('brain-js/artifacts/audit.json', 'utf8')) as DatasetAudit;
const overlaps = [];
for (const label of ['desert', 'sea', 'forest']) {
  const rows = sources.images.filter((x) => x.classId === label);
  await contactSheet(
    rows.map((x) => ({
      file: resolve(directory, x.file),
      caption: x.title.replace('File:', '').slice(0, 32),
    })),
    resolve(`../docs/lab2/figures/model-diagnostics/sanity-candidates-${label}.jpg`),
    `External candidates: ${label}; no inference`,
    4,
  );
}
for (const row of [
  ...sources.images,
  {
    file: '/Users/admin/Downloads/desertSachara.jpg',
    classId: 'desert',
    title: 'Sahara',
    status: 'external-diagnostic',
  },
]) {
  const thumb = await sharp(resolve(directory, row.file))
    .rotate()
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer();
  for (let mode = 0; mode < 8; mode++) {
    const transformed = mode ? transformSquare(thumb, mode) : thumb,
      hash = perceptualHash(transformed);
    for (const image of audit.images) {
      if (!image.perceptualHash || hamming(hash, BigInt('0x' + image.perceptualHash)) > 4) {
        continue;
      }
      const other = await sharp(imageFile(audit, image))
        .rotate()
        .resize(32, 32, { fit: 'fill' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer();
      const similarity = thumbnailSimilarity(transformed, other);
      if (similarity.mae <= 10 && similarity.correlation >= 0.985) {
        overlaps.push({
          file: row.file,
          datasetImage: image.path,
          role: image.role,
          mode,
          ...similarity,
        });
      }
    }
  }
}
await writeFile(
  resolve(directory, 'overlap-check.json'),
  JSON.stringify(
    {
      method:
        'Same conservative full-frame perceptual matcher as the dataset audit; no guarantee against substantial crops.',
      checked: sources.images.length + 1,
      overlaps,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ checked: sources.images.length + 1, overlaps }, null, 2));
