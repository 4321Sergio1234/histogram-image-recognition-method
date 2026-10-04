import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceRoot } from '../src/config/training';
import { verifyModelAssets } from '../../scripts/lib/model-assets';

const run = join(workspaceRoot, 'brain-js/artifacts/curated-v2');
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'horizon-model-assets-'));
  roots.push(root);
  await cp(join(workspaceRoot, 'react-web-app/public/models'), join(root, 'models'), {
    recursive: true,
  });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('deployment model assets', () => {
  it('accepts the exported pair in public assets or a built static directory', async () => {
    const result = await verifyModelAssets(await fixture(), run);
    expect(result.version).toBe('6.1.0');
    expect(result.sampleCounts).toEqual({ train: 2280, validation: 879, test: 1086 });
  });

  it('rejects missing weights', async () => {
    const root = await fixture();
    await rm(join(root, 'models/scene-recognition/model.json'));
    await expect(verifyModelAssets(root, run)).rejects.toThrow('model.json and manifest.json');
  });

  it('rejects corrupted weights', async () => {
    const root = await fixture();
    await writeFile(join(root, 'models/scene-recognition/model.json'), '{}');
    await expect(verifyModelAssets(root, run)).rejects.toThrow('checksum');
  });

  it('rejects a valid manifest that differs from the frozen export', async () => {
    const root = await fixture();
    const path = join(root, 'models/scene-recognition/manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.version = '9.9.9';
    await writeFile(path, JSON.stringify(manifest));
    await expect(verifyModelAssets(root, run)).rejects.toThrow('frozen training export');
  });

  it('rejects a second model directory that could ship stale weights', async () => {
    const root = await fixture();
    await mkdir(join(root, 'models/old-model'));
    await expect(verifyModelAssets(root, run)).rejects.toThrow('only the current');
  });
});
