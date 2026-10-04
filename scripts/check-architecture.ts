import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../react-web-app/src/', import.meta.url));
const layers = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
const violations: string[] = [];
async function walk(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(filename);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(filename) || filename.includes('.test.')) {
      continue;
    }
    const current = path.relative(source, filename).split(path.sep);
    const contents = await readFile(filename, 'utf8');
    for (const match of contents.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      const resolved = specifier.startsWith('@/')
        ? path.join(source, specifier.slice(2))
        : specifier.startsWith('.')
          ? path.resolve(path.dirname(filename), specifier)
          : null;
      if (!resolved) {
        continue;
      }
      const target = path.relative(source, resolved).split(path.sep);
      if (layers.indexOf(target[0]) > layers.indexOf(current[0])) {
        violations.push(`${current.join('/')}: upward import ${specifier}`);
      }
      if (
        target[0] === current[0] &&
        !['shared', 'app'].includes(current[0]) &&
        current[1] !== target[1] &&
        !target.includes('@x')
      ) {
        violations.push(
          `${current.join('/')}: same-layer slice import ${specifier}; use composition or an explicit entity @x API`,
        );
      }
      if (
        current[0] !== target[0] &&
        target[0] !== 'shared' &&
        target.length > 2 &&
        target[2] !== 'index' &&
        target[2] !== 'index.ts' &&
        !target.includes('@x')
      ) {
        violations.push(`${current.join('/')}: import the public slice API for ${specifier}`);
      }
    }
  }
}
await walk(source);
if (violations.length) {
  throw new Error(violations.join('\n'));
}
console.log('Feature-Sliced Design import boundaries passed.');
