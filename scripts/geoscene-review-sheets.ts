import sharp from 'sharp';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { brightnessHistogram } from '../brain-js/src/core';
const folders = { sea: 'Sea or Ocean', forest: 'Forest Area', desert: 'Desert' };
const directory = resolve('../docs/GeoSceneNet16K');
const output = resolve('../docs/lab2/data/geoscene-palette/manual-review');
const figures = resolve('../docs/lab2/figures/geoscene-palette/manual-review');
await mkdir(output, { recursive: true });
await mkdir(figures, { recursive: true });
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const [label, folder] of Object.entries(folders)) {
  const names = (await readdir(resolve(directory, folder)))
    .filter((x) => !x.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const index = [];
  const thumbs: Buffer[] = [];
  for (let i = 0; i < names.length; i++) {
    const bytes = await readFile(resolve(directory, folder, names[i]));
    const { data, info } = await sharp(bytes)
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const histogram = brightnessHistogram(data),
      max = Math.max(...histogram),
      total = info.width * info.height;
    const bars = histogram
      .map(
        (n, k) =>
          `${k ? 'L' : 'M'}${((k * 184) / 255).toFixed(2)},${(34 - (32 * n) / max).toFixed(2)}`,
      )
      .join(' ');
    const caption = Buffer.from(
      `<svg width="192" height="62"><rect width="192" height="62" fill="white"/><text x="4" y="12" font-family="Arial" font-size="11">${i + 1}. ${esc(names[i])}</text><g transform="translate(4,17)"><path d="${bars}" fill="none" stroke="#444" stroke-width="0.8"/></g><text x="4" y="60" font-family="Arial" font-size="8">Y mean ${(histogram.reduce((s, n, k) => s + n * k, 0) / total).toFixed(0)} · dark 0 → 255 light</text></svg>`,
    );
    const photo = await sharp(bytes)
      .rotate()
      .resize(184, 126, { fit: 'contain', background: '#eeeeee' })
      .png()
      .toBuffer();
    thumbs.push(
      await sharp({ create: { width: 192, height: 194, channels: 3, background: '#ffffff' } })
        .composite([
          { input: photo, left: 4, top: 2 },
          { input: caption, left: 0, top: 130 },
        ])
        .jpeg({ quality: 88 })
        .toBuffer(),
    );
    index.push({
      id: i + 1,
      path: `geoscene/${folder}/${names[i]}`,
      relativePath: `${folder}/${names[i]}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: info.width,
      height: info.height,
      sheet: Math.floor(i / 48) + 1,
      tile: (i % 48) + 1,
    });
  }
  const sheets = [];
  for (let start = 0; start < thumbs.length; start += 48) {
    const n = Math.min(48, thumbs.length - start),
      page = Math.floor(start / 48) + 1,
      name = `${label}-${String(page).padStart(3, '0')}.jpg`;
    const title = Buffer.from(
      `<svg width="1152" height="32"><rect width="1152" height="32" fill="white"/><text x="8" y="23" font-family="Arial" font-size="18">${label} · manual review ${start + 1}–${start + n} / ${thumbs.length} · luminance histograms</text></svg>`,
    );
    await sharp({
      create: {
        width: 1152,
        height: 32 + Math.ceil(n / 6) * 194,
        channels: 3,
        background: 'white',
      },
    })
      .composite([
        { input: title, left: 0, top: 0 },
        ...thumbs
          .slice(start, start + n)
          .map((input, i) => ({ input, left: (i % 6) * 192, top: 32 + Math.floor(i / 6) * 194 })),
      ])
      .jpeg({ quality: 90 })
      .toFile(resolve(figures, name));
    sheets.push({ page, file: name, firstId: start + 1, lastId: start + n });
  }
  await writeFile(
    resolve(output, `${label}-index.json`),
    JSON.stringify(
      { label, folder, total: index.length, columns: 6, tilesPerSheet: 48, sheets, images: index },
      null,
      2,
    ),
  );
  console.log(`${label}: ${index.length} images, ${sheets.length} review sheets`);
}
