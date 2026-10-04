import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
const data = resolve('../docs/lab2/data/geoscene-clean-v1');
const oldRoot = resolve('../docs/lab2/data/model-diagnostics/baseline-3.0.0/production-dist');
const newRoot = resolve('react-web-app/dist');
let root = oldRoot;
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(200, {
      'content-type': mime[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(await readFile(file));
  } catch {
    response.destroy();
  }
});
await new Promise<void>((r) => server.listen(4176, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto('http://127.0.0.1:4176');
  await page.getByText('Local model ready', { exact: true }).waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }),
      );
    }
  });
  const cachedKeys = () =>
    page.evaluate(async () => {
      const keys = [];
      for (const name of await caches.keys()) {
        for (const item of await (await caches.open(name)).keys()) {
          keys.push(item.url);
        }
      }
      return keys.sort();
    });
  const before = await cachedKeys();
  const oldManifest = (await page.evaluate(
    async () => await (await fetch('/models/scene-recognition/manifest.json')).json(),
  )) as { version: string; modelSha256: string };
  root = newRoot;
  // Simulate the browser's update check after a deployment. No cache/storage clearing or manual SW removal.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect
    .poll(async () => JSON.stringify(await cachedKeys()), { timeout: 30000 })
    .not.toBe(JSON.stringify(before));
  await page.reload();
  await page.getByText('Local model ready', { exact: true }).waitFor();
  const after = await cachedKeys();
  const sw = await readFile(resolve(newRoot, 'sw.js'), 'utf8');
  const shell = await readFile(resolve(newRoot, 'index.html'), 'utf8');
  const assets = [...shell.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((x) => x[1]);
  for (const asset of assets) {
    expect(after.some((key) => new URL(key).pathname === asset)).toBe(true);
  }
  const oldAssets = before.filter(
    (key) => new URL(key).pathname.startsWith('/assets/') && !after.includes(key),
  );
  expect(oldAssets.length).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await page.getByText('Local model ready', { exact: true }).waitFor();
  await page.getByLabel('Choose an image file').setInputFiles('e2e/fixtures/sea-640x480.jpg');
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await page.getByTestId('recognition-result').waitFor();
  await page.getByRole('button', { name: 'Analysis details', exact: true }).click();
  const manifest = JSON.parse(
    await readFile(resolve(newRoot, 'models/scene-recognition/manifest.json'), 'utf8'),
  ) as { version: string; modelSha256: string };
  await expect(page.getByRole('dialog')).toContainText(manifest.modelSha256);
  const result = {
    previousVersion: oldManifest.version,
    previousSha256: oldManifest.modelSha256,
    checkedAt: new Date().toISOString(),
    browser: browser.version(),
    modelVersion: manifest.version,
    modelSha256: manifest.modelSha256,
    oldServiceWorkerSha256: createHash('sha256')
      .update(await readFile(resolve(oldRoot, 'sw.js')))
      .digest('hex'),
    newServiceWorkerSha256: createHash('sha256').update(sw).digest('hex'),
    before,
    after,
    removedAssetCount: oldAssets.length,
    offlineRecognition: true,
    storageCleared: false,
    note: 'Real archived production build -> current production build on one origin/context. registration.update invokes the standard update algorithm. The old model/manifest and shell revisions are replaced together; the new hash is verified in offline recognition details.',
  };
  await writeFile(resolve(data, 'pwa-update.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      removedAssetCount: oldAssets.length,
      offlineRecognition: true,
      modelVersion: manifest.version,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
