import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyModelAssets } from './lib/model-assets';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string' } }, strict: true });
const assets = resolve(root, values.dir ?? 'react-web-app/public');
const run = resolve(root, 'brain-js/artifacts/curated-v2');
console.log(JSON.stringify(await verifyModelAssets(assets, run), null, 2));
