import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { inspectImageHeader } from '../react-web-app/src/shared/lib/image-input';
import type { RecognitionTimings } from '../react-web-app/src/entities/recognition-result/model/types';

interface BenchmarkInput {
  id: string;
  file: string;
  title: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  sha256: string;
  license: string;
  sourceUrl: string;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(root, '../docs/lab3');
const inputsFile = path.join(output, 'data/benchmark-inputs.json');
const inputs = (JSON.parse(await readFile(inputsFile, 'utf8')) as { images: BenchmarkInput[] })
  .images;
for (const input of inputs) {
  const bytes = await readFile(path.resolve(path.dirname(inputsFile), input.file));
  const header = inspectImageHeader(bytes.subarray(0, 1024 * 1024));
  if (
    createHash('sha256').update(bytes).digest('hex') !== input.sha256 ||
    bytes.length !== input.bytes
  ) {
    throw new Error(`${input.id}: file differs from its recorded source metadata.`);
  }
  if (header.width !== input.width || header.height !== input.height) {
    throw new Error(`${input.id}: native dimensions differ from the metadata.`);
  }
}
inputs.sort((a, b) => a.width * a.height - b.width * b.height || a.bytes - b.bytes);
await mkdir(path.join(output, 'data'), { recursive: true });
await mkdir(path.join(output, 'figures'), { recursive: true });
const server = await createServer({
  root: path.join(root, 'react-web-app'),
  configFile: path.join(root, 'react-web-app/vite.config.ts'),
  server: { port: 5181, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch();
type Stage = keyof RecognitionTimings;
type Measurement = {
  image: string;
  mode: string;
  order: number;
  run: number;
  warmup: boolean;
  heartbeatMaxGapMs: number;
  timings: RecognitionTimings;
  execution: string;
  predictionId: string;
  score: number;
  uncertain: boolean;
  histogramSha256: string;
};
const runs: Measurement[] = [];
try {
  const page = await browser.newPage();
  const harness = await server.transformIndexHtml(
    '/__benchmark',
    '<!doctype html><html><head><title>Horizon benchmark</title></head><body>Benchmark harness</body></html>',
  );
  await page.route('**/__benchmark', (route) =>
    route.fulfill({ contentType: 'text/html', body: harness }),
  );
  for (let index = 0; index < inputs.length; index++) {
    await page.route(`**/__input/${index}`, (route) =>
      route.fulfill({
        path: path.resolve(path.dirname(inputsFile), inputs[index].file),
        contentType: 'image/jpeg',
      }),
    );
  }
  await page.goto('http://127.0.0.1:5181/__benchmark');
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    // Alternate which mode runs first so that neither mode always benefits from a warmer process.
    const modes = index % 2 === 0 ? ['worker', 'main-thread'] : ['main-thread', 'worker'];
    for (const [order, mode] of modes.entries()) {
      console.log(`${input.id} ${mode}: ${input.width} × ${input.height}, ${input.bytes} bytes`);
      const measurements = await page.evaluate(
        async ({ index, mode, name }) => {
          const servicePath = '/src/entities/recognition-result/index.ts';
          const imagePath = '/src/entities/image-analysis/index.ts';
          const { LocalBrainSceneRecognitionService } = (await import(
            servicePath
          )) as typeof import('../react-web-app/src/entities/recognition-result');
          const { prepareImage } = (await import(
            imagePath
          )) as typeof import('../react-web-app/src/entities/image-analysis');
          const service = new LocalBrainSceneRecognitionService({
            preferWorker: mode === 'worker',
          });
          await service.getModelInfo();
          const blob = await (await fetch(`/__input/${index}`)).blob();
          const image = await prepareImage(new File([blob], name, { type: blob.type }));
          const entries = [];
          try {
            for (let run = 0; run < 6; run++) {
              let previous = performance.now();
              let maxGap = 0;
              const timer = setInterval(() => {
                const now = performance.now();
                maxGap = Math.max(maxGap, now - previous);
                previous = now;
              }, 5);
              const result = await service.recognize(image);
              await new Promise((resolve) => setTimeout(resolve, 10));
              clearInterval(timer);
              const digest = await crypto.subtle.digest(
                'SHA-256',
                new Uint32Array(result.histogram).buffer,
              );
              const histogramSha256 = Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, '0'),
              ).join('');
              entries.push({
                run,
                warmup: run === 0,
                heartbeatMaxGapMs: maxGap,
                timings: result.timings,
                execution: result.execution,
                predictionId: result.prediction.label.id,
                score: result.prediction.score,
                uncertain: result.uncertain,
                histogramSha256,
              });
            }
          } finally {
            image.dispose();
            service.dispose?.();
          }
          return entries;
        },
        { index, mode, name: path.basename(input.file) },
      );
      runs.push(...measurements.map((entry) => ({ ...entry, image: input.id, mode, order })));
    }
  }
  for (const input of inputs) {
    const entries = runs.filter((run) => run.image === input.id);
    if (entries.some((run) => run.execution !== run.mode)) {
      throw new Error(`${input.id}: a run did not execute in its requested mode.`);
    }
    if (
      new Set(entries.map((run) => run.histogramSha256)).size !== 1 ||
      new Set(entries.map((run) => run.predictionId)).size !== 1 ||
      Math.max(...entries.map((run) => run.score)) - Math.min(...entries.map((run) => run.score)) >
        1e-7
    ) {
      throw new Error(`Worker/main-thread prediction parity failed: ${input.id}`);
    }
  }
  const summarize = (numbers: number[]) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      min: sorted[0],
      max: sorted.at(-1)!,
      mean: numbers.reduce((a, b) => a + b, 0) / numbers.length,
      median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    };
  };
  const stages: Stage[] = ['decodeMs', 'pixelsMs', 'featuresMs', 'inferenceMs', 'totalMs'];
  const summaries = inputs.flatMap((input) =>
    ['worker', 'main-thread'].map((mode) => {
      const matches = runs.filter(
        (run) => run.image === input.id && run.mode === mode && !run.warmup,
      );
      if (matches.length < 5) {
        throw new Error(`${input.id} ${mode}: fewer than five measured runs.`);
      }
      return {
        image: input.id,
        mode,
        pixels: input.width * input.height,
        bytes: input.bytes,
        measuredRuns: matches.length,
        ...summarize(matches.map((run) => run.timings.totalMs)),
        stages: Object.fromEntries(
          stages.map((stage) => [stage, summarize(matches.map((run) => run.timings[stage]))]),
        ),
        heartbeat: summarize(matches.map((run) => run.heartbeatMaxGapMs)),
      };
    }),
  );
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  const webPackage = JSON.parse(
    await readFile(path.join(root, 'react-web-app/package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  const manifest = JSON.parse(
    await readFile(
      path.join(root, 'react-web-app/public/models/scene-recognition/manifest.json'),
      'utf8',
    ),
  ) as {
    version: string;
    modelSha256: string;
    network: { architecture: string };
    brainVersion: string;
  };
  const predictions = inputs.map((input) => {
    const run = runs.find((item) => item.image === input.id)!;
    return {
      image: input.id,
      predictionId: run.predictionId,
      score: run.score,
      uncertain: run.uncertain,
    };
  });
  const document = {
    measuredAt: new Date().toISOString(),
    environment: {
      os: `${os.type()} ${os.release()} ${os.version()}`,
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      ramBytes: os.totalmem(),
      node: process.version,
      browser: `Chromium ${browser.version()} (Playwright headless)`,
      libraries: {
        ...packageJson.devDependencies,
        react: webPackage.dependencies.react,
        'brain.js': manifest.brainVersion,
      },
    },
    model: {
      version: manifest.version,
      sha256: manifest.modelSha256,
      architecture: manifest.network.architecture,
    },
    methodology:
      'Real native-resolution natural-scene images (see benchmark-inputs.json); no resizing or upscaling. Final source recognition service in a Vite harness, without React rendering. Model loading, file fetch, validation/preview and UI are excluded. Timed: decode + pixel extraction + histogram/4-bit encoding + ANN + transfer/scheduling. One recorded warm-up and five measured runs per image and mode; mode order alternates between images. A 5 ms main-thread heartbeat is a responsiveness proxy, not a frame-rate measurement. Predictions are recorded only to check Worker/main-thread parity and are not accuracy evidence.',
    images: inputs.map(
      ({ id, file, title, width, height, bytes, format, sha256, license, sourceUrl }) => ({
        id,
        file,
        title,
        width,
        height,
        pixels: width * height,
        bytes,
        format,
        sha256,
        license,
        sourceUrl,
      }),
    ),
    runs,
    summaries,
    predictions,
  };
  await writeFile(path.join(output, 'data/benchmark.json'), JSON.stringify(document, null, 2));
  const csv = [
    'image,mode,order,run,warmup,decode_ms,pixels_ms,features_ms,inference_ms,total_ms,heartbeat_max_gap_ms',
    ...runs.map((run) =>
      [
        run.image,
        run.mode,
        run.order,
        run.run,
        run.warmup,
        run.timings.decodeMs,
        run.timings.pixelsMs,
        run.timings.featuresMs,
        run.timings.inferenceMs,
        run.timings.totalMs,
        run.heartbeatMaxGapMs,
      ].join(','),
    ),
  ].join('\n');
  await writeFile(path.join(output, 'data/runs.csv'), csv + '\n');

  const ink = {
    primary: '#0b0b0b',
    secondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    surface: '#fcfcfb',
  };
  const font = 'font-family="system-ui,-apple-system,Segoe UI,sans-serif"';
  const colors: Record<string, string> = { worker: '#2a78d6', 'main-thread': '#eb6834' };
  const names: Record<string, string> = { worker: 'Web Worker', 'main-thread': 'Основний потік' };
  const maxY = Math.ceil(Math.max(...summaries.map((item) => item.max)) / 50) * 50;
  const maxX = Math.ceil(Math.max(...summaries.map((item) => item.pixels)) / 5e6) * 5e6;
  const x = (pixels: number) => 90 + (pixels / maxX) * 700;
  const y = (ms: number) => 400 - (ms / maxY) * 300;
  const series = Object.keys(colors)
    .map((mode) => {
      const items = summaries.filter((item) => item.mode === mode);
      return (
        `<polyline fill="none" stroke="${colors[mode]}" stroke-width="2" stroke-linejoin="round" points="${items.map((item) => `${x(item.pixels).toFixed(1)},${y(item.mean).toFixed(1)}`).join(' ')}"/>` +
        items
          .map(
            (item) =>
              `<line x1="${x(item.pixels)}" x2="${x(item.pixels)}" y1="${y(item.min)}" y2="${y(item.max)}" stroke="${colors[mode]}" stroke-width="2"/><circle cx="${x(item.pixels)}" cy="${y(item.mean)}" r="4.5" fill="${colors[mode]}" stroke="${ink.surface}" stroke-width="2"/>`,
          )
          .join('')
      );
    })
    .join('');
  const largest = summaries.filter(
    (item) => item.pixels === Math.max(...summaries.map((entry) => entry.pixels)),
  );
  const labels = largest
    .map(
      (item) =>
        `<text x="${x(item.pixels) + 12}" y="${y(item.mean) + (item.mode === 'worker' ? -8 : 18)}" fill="${ink.primary}" font-size="13">${names[item.mode]}: ${item.mean.toFixed(1)} мс</text>`,
    )
    .join('');
  const yTicks = Array.from({ length: maxY / 50 + 1 }, (_, i) => i * 50)
    .map(
      (value) =>
        `<line x1="90" x2="790" y1="${y(value)}" y2="${y(value)}" stroke="${value ? ink.grid : ink.axis}"/><text x="80" y="${y(value) + 4}" text-anchor="end" fill="${ink.muted}" font-size="12">${value}</text>`,
    )
    .join('');
  const xTicks = Array.from({ length: maxX / 5e6 + 1 }, (_, i) => i * 5e6)
    .map(
      (value) =>
        `<text x="${x(value)}" y="420" text-anchor="middle" fill="${ink.muted}" font-size="12">${(value / 1e6).toFixed(0)}</text>`,
    )
    .join('');
  const legend = Object.keys(colors)
    .map(
      (mode, i) =>
        `<g transform="translate(${90 + i * 170} 78)"><line x1="0" x2="22" y1="-5" y2="-5" stroke="${colors[mode]}" stroke-width="3" stroke-linecap="round"/><text x="30" y="0" fill="${ink.secondary}" font-size="14">${names[mode]}</text></g>`,
    )
    .join('');
  const scaling = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="470" viewBox="0 0 1000 470" role="img" aria-label="Залежність часу розпізнавання від кількості пікселів"><rect width="1000" height="470" fill="${ink.surface}"/><g ${font}><text x="90" y="34" fill="${ink.primary}" font-size="20" font-weight="600">Horizon ${manifest.version}: тривалість розпізнавання</text><text x="90" y="56" fill="${ink.secondary}" font-size="14">Середнє (точка) та min–max (відрізок) з 5 вимірів після прогріву; ${inputs.length} реальних зображень</text>${legend}${yTicks}${xTicks}${series}${labels}<text x="440" y="452" text-anchor="middle" fill="${ink.secondary}" font-size="13">Кількість пікселів, Мп</text><text transform="translate(34 250) rotate(-90)" text-anchor="middle" fill="${ink.secondary}" font-size="13">Час, мс</text></g></svg>`;
  await writeFile(path.join(output, 'figures/scaling.svg'), scaling);

  const stageColors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
  const stageNames = ['Декодування', 'Отримання пікселів', 'Гістограма + 4 біти', 'ANN'];
  const worker = summaries.filter((item) => item.mode === 'worker');
  const maxTotal = Math.max(...worker.map((item) => item.mean));
  const barX = (ms: number) => (ms / maxTotal) * 560;
  const rows = worker
    .map((item, row) => {
      const input = inputs.find((entry) => entry.id === item.image)!;
      let offset = 0;
      const segments = (['decodeMs', 'pixelsMs', 'featuresMs', 'inferenceMs'] as Stage[])
        .map((stage, index) => {
          const width = Math.max(0, barX(item.stages[stage].mean) - 2);
          const rect = `<rect x="${200 + offset}" y="${110 + row * 34}" width="${width.toFixed(1)}" height="20" fill="${stageColors[index]}"/>`;
          offset += barX(item.stages[stage].mean);
          return rect;
        })
        .join('');
      return `<text x="190" y="${125 + row * 34}" text-anchor="end" fill="${ink.secondary}" font-size="13">${item.image} · ${input.width}×${input.height}</text>${segments}<text x="${206 + offset}" y="${125 + row * 34}" fill="${ink.primary}" font-size="12">${item.mean.toFixed(1)} мс</text>`;
    })
    .join('');
  const stageLegend = stageNames
    .map(
      (name, i) =>
        `<g transform="translate(${200 + i * 150} 80)"><rect x="0" y="-12" width="14" height="14" rx="3" fill="${stageColors[i]}"/><text x="20" y="0" fill="${ink.secondary}" font-size="13">${name}</text></g>`,
    )
    .join('');
  const stageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="${140 + worker.length * 34}" viewBox="0 0 860 ${140 + worker.length * 34}" role="img" aria-label="Розподіл часу за етапами у Web Worker"><rect width="100%" height="100%" fill="${ink.surface}"/><g ${font}><text x="200" y="34" fill="${ink.primary}" font-size="20" font-weight="600">Середній час етапів (Web Worker)</text><text x="200" y="56" fill="${ink.secondary}" font-size="14">Сегменти — decode, pixels, features, ANN (≤ 0,3 мс, майже не видно); решта до total — передача й планування</text>${stageLegend}${rows}</g></svg>`;
  await writeFile(path.join(output, 'figures/stages.svg'), stageSvg);
  console.log(
    JSON.stringify(
      summaries.map(({ image, mode, pixels, mean, median, min, max, heartbeat }) => ({
        image,
        mode,
        pixels,
        mean,
        median,
        min,
        max,
        heartbeatMean: heartbeat.mean,
      })),
      null,
      2,
    ),
  );
  console.log(`Measurements saved: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
