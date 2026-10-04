import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyModelAssets } from './lib/model-assets';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'react-web-app/dist');
const output = resolve(root, '.vercel/output');
const run = resolve(root, 'brain-js/artifacts/curated-v2');
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));

if (!Array.isArray(config.routes)) {
  throw new Error('vercel.json must define the deployment routes');
}
await access(resolve(dist, 'index.html'));
await access(resolve(dist, 'sw.js'));
await verifyModelAssets(dist, run);

// Build Output API v3 can deploy a static PWA without pulling team settings or environment files.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(dist, resolve(output, 'static'), { recursive: true });
await writeFile(
  resolve(output, 'config.json'),
  `${JSON.stringify({ version: 3, routes: config.routes }, null, 2)}\n`,
);
const verified = await verifyModelAssets(resolve(output, 'static'), run);
console.log(JSON.stringify({ output: '.vercel/output', ...verified }, null, 2));
