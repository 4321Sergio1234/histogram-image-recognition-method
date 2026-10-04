import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fixture = path.resolve('e2e/fixtures/sea-640x480.jpg');
const forbidden = /fresh|rotten|food|produce|fruit|vegetable|nutrition|harvest|basket|spoilage/i;
async function selectImage(page: Page) {
  await page.getByLabel('Choose an image file').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Analyze image', exact: true })).toBeEnabled();
}
async function analyze(page: Page) {
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await expect(page.getByTestId('recognition-result')).toBeVisible();
}

test('local recognition, information, details, all exports, reset and accessible layout', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const outbound: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') {
      outbound.push(request.url());
    }
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recognize a natural scene');
  await expect(page.locator('.catalog')).toContainText('3 scene types');
  const catalog = (await (
    await page.request.get('/models/scene-recognition/manifest.json')
  ).json()) as {
    task: string;
    classes: { id: string }[];
    datasets: { id: string; selectedClasses: string[] }[];
    network: { architecture: string };
  };
  expect(catalog.task).toBe('natural-scene-classification');
  expect(catalog.classes.map((label) => label.id)).toEqual(['sea', 'forest', 'desert']);
  expect(catalog.datasets.map((dataset) => [dataset.id, dataset.selectedClasses])).toEqual([
    ['geoscene', ['desert', 'forest area', 'sea or ocean']],
    ['intel', ['forest', 'sea']],
    ['landscape', ['coast', 'desert', 'forest']],
  ]);
  await expect(page.locator('.catalog-items > span')).toHaveText(['Sea', 'Forest', 'Desert']);
  const stale = await page.request.get('/models/food-recognition/manifest.json');
  expect(stale.ok() && (await stale.text()).includes('"classes"')).toBe(false);
  expect(await page.locator('body').innerText()).not.toMatch(forbidden);
  await expect(page.getByRole('button', { name: 'Analyze image', exact: true })).toHaveCount(0);
  await selectImage(page);
  await page.getByRole('button', { name: 'Image information', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Image information' })).toContainText('image/jpeg');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await analyze(page);
  await expect(page.getByTestId('recognition-result')).toContainText('Model confidence');
  await expect(page.getByTestId('recognition-result')).toContainText(
    'recognizes sea, forest and desert scenes only',
  );
  await expect(
    page.getByTestId('recognition-result').getByRole('heading', { level: 2 }),
  ).toHaveText(/^(Sea|Forest|Desert)$/);
  await expect(
    page.getByRole('region', { name: 'Other possible scenes' }).getByRole('listitem'),
  ).toHaveCount(2);
  expect(await page.locator('body').innerText()).not.toMatch(forbidden);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  await page.getByRole('button', { name: 'Analysis details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1,024');
  await expect(
    page.getByRole('img', { name: /Original 256-bin brightness histogram/ }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /Quantized histogram/ })).toBeAttached();
  await expect(page.locator('.scene-outputs li')).toHaveCount(3);
  await expect(page.locator('.scene-outputs li > span:first-child')).toHaveText([
    'Sea',
    'Forest',
    'Desert',
  ]);
  await expect(page.getByRole('dialog')).toContainText(`${catalog.network.architecture} · sigmoid`);
  await expect(page.getByRole('region', { name: 'Model reliability' })).toContainText(
    '1051 of 1086 histogram-filtered test photos',
  );
  await expect(page.getByRole('region', { name: 'Model reliability' })).toContainText(
    'Sea 350 · Forest 651 · Desert 85',
  );
  await expect(page.getByRole('dialog')).toContainText('6.1.0');
  await expect(page.getByRole('region', { name: 'Model reliability' })).toContainText(
    'A high confidence can still be wrong',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const format of ['png', 'jpeg', 'bmp']) {
    await page.getByLabel('Export format').selectOption(format);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export result', exact: true }).click();
    const download = await downloadEvent;
    const filename = await download.path();
    expect(filename).not.toBeNull();
    const buffer = await readFile(filename!);
    expect(buffer.length).toBeGreaterThan(1000);
    if (format === 'png') {
      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    if (format === 'jpeg') {
      expect(buffer.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    }
    if (format === 'bmp') {
      expect(buffer.subarray(0, 2).toString()).toBe('BM');
      expect(buffer.readUInt16LE(28)).toBe(24);
      expect(buffer.readUInt32LE(2)).toBe(buffer.length);
    }
  }
  for (const [name, expectedName] of [
    ['Save original photo', 'sea-640x480.jpg'],
    ['Save result JSON', 'horizon-result.json'],
  ]) {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toBe(expectedName);
    const bytes = await readFile((await download.path())!);
    if (name === 'Save original photo') {
      expect(bytes.equals(await readFile(fixture))).toBe(true);
    } else {
      expect(JSON.parse(bytes.toString())).toMatchObject({
        model: { version: '6.1.0' },
        execution: 'worker',
      });
    }
  }
  await page.getByText('Session log', { exact: false }).first().click();
  const logDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download operation log', exact: true }).click();
  const logged = JSON.parse(await readFile((await (await logDownload).path())!, 'utf8'));
  expect(
    logged.operations.some(
      (row: { operation: string; status: string; durationMs?: number }) =>
        row.operation === 'Analyze image' && row.status === 'success' && row.durationMs! >= 0,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Analyze another image', exact: true }).click();
  await expect(page.getByTestId('recognition-result')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze image', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(failures).toEqual([]);
  expect(outbound).toEqual([]);
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test('invalid, empty and corrupt input are explained without a crash', async ({ page }) => {
  await page.goto('/');
  for (const file of [
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
    { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 0, 0]) },
  ]) {
    await page.getByLabel('Choose an image file').setInputFiles(file);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByTestId('recognition-result')).toHaveCount(0);
  }
});

test('model failure is actionable and retry recovers', async ({ page }) => {
  await page.route('**/models/scene-recognition/manifest.json', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.unroute('**/models/scene-recognition/manifest.json');
  await page
    .getByRole('button', { name: /retry|try again/i })
    .first()
    .click();
  await selectImage(page);
  await analyze(page);
});

test('configured low-confidence rule presents an uncertain result that explains the supported scope', async ({
  page,
}) => {
  const manifest = JSON.parse(
    await readFile('react-web-app/public/models/scene-recognition/manifest.json', 'utf8'),
  ) as Record<string, unknown>;
  await page.route('**/models/scene-recognition/manifest.json', (route) =>
    route.fulfill({ json: { ...manifest, uncertainty: { minScore: 1, minMargin: 0.15 } } }),
  );
  await page.goto('/');
  await selectImage(page);
  await analyze(page);
  await expect(page.getByTestId('recognition-result')).toContainText('Uncertain result');
  await expect(page.getByTestId('recognition-result')).toContainText(
    'The model recognizes only sea, forest and desert scenes.',
  );
  await expect(page.getByTestId('recognition-result')).not.toContainText(/unknown/i);
});

test('a stale model from the previous recognition task is refused rather than used', async ({
  page,
}) => {
  const legacy = {
    version: '1.2.0',
    algorithm: 'zawyalow-brightness-histogram-v1',
    preprocessingVersion: 'luma-round-max15-msb-v1',
    featureLength: 1024,
    classes: [{ id: 'legacy', displayName: 'Legacy' }],
  };
  await page.route('**/models/scene-recognition/manifest.json', (route) =>
    route.fulfill({ json: legacy }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert').first()).toContainText('different recognition task');
  await expect(page.getByRole('button', { name: 'Choose image', exact: true })).toBeVisible();
  await page.getByLabel('Choose an image file').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Analyze image', exact: true })).toBeDisabled();
});

test('camera denial offers gallery fallback and closes cleanly', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('Denied for test', 'NotAllowedError')),
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Camera permission was declined');
  await expect(
    page.locator('button').filter({ hasText: 'Use device camera or gallery' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('production PWA caches model and recognizes after offline reload', async ({
  page,
  context,
}) => {
  const expected = JSON.parse(
    await readFile('react-web-app/public/models/scene-recognition/manifest.json', 'utf8'),
  ) as { version: string; modelSha256: string };
  const modelHash = createHash('sha256')
    .update(await readFile('react-web-app/public/models/scene-recognition/model.json'))
    .digest('hex');
  expect(modelHash).toBe(expected.modelSha256);
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
  });
  await selectImage(page);
  await analyze(page);
  await context.setOffline(true);
  await page.reload();
  await selectImage(page);
  await analyze(page);
  await page.getByRole('button', { name: 'Analysis details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(expected.modelSha256);
  await expect(page.getByRole('dialog')).toContainText(expected.version);
  const cached = await page.evaluate(async () => {
    const manifest = (await (await fetch('/models/scene-recognition/manifest.json')).json()) as {
      version: string;
      modelSha256: string;
    };
    const bytes = await (await fetch('/models/scene-recognition/model.json')).arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    return { version: manifest.version, manifestHash: manifest.modelSha256, hash };
  });
  expect(cached).toEqual({ version: expected.version, manifestHash: modelHash, hash: modelHash });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByTestId('recognition-result')).toBeVisible();
  await context.setOffline(false);
});

test('camera capture creates a preview and stops its media tracks', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const tracks: MediaStreamTrack[] = [];
    Object.defineProperty(window, '__cameraTracks', { value: tracks });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture photo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('img', { name: 'Selected scene photo' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const tracks = (window as unknown as { __cameraTracks: MediaStreamTrack[] }).__cameraTracks;
      return tracks.length > 0 && tracks.every((track) => track.readyState === 'ended');
    }),
  ).toBe(true);
  await page.getByRole('button', { name: 'Image information' }).click();
  await expect(page.getByRole('dialog')).toContainText('Camera');
});

test('production manifest and icons satisfy Chromium installability checks', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    name: string;
    display: string;
    icons: { src: string; sizes: string }[];
  };
  expect(manifest.name).toBe('Horizon — Natural scene recognition');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toContain('192x192');
  expect(manifest.icons.map((icon) => icon.sizes)).toContain('512x512');
  for (const icon of manifest.icons) {
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }
  const session = await context.newCDPSession(page);
  const result = await session.send('Page.getInstallabilityErrors');
  expect(result.installabilityErrors).toEqual([]);
  await session.detach();
});
