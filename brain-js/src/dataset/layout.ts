import { readdir } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import type { DatasetSource } from '../core/scenes';
import type { DatasetLayout, SectionLayout } from './types';

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|bmp|tiff?)$/i;

/** System metadata that archive tools and file browsers add; never dataset content. */
export function isSystemFile(name: string): boolean {
  return name.startsWith('.') || /^(?:thumbs\.db|desktop\.ini)$/i.test(name) || name === '__MACOSX';
}

async function entries(directory: string) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => !isSystemFile(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Descends through repeated wrapper folders such as seg_train/seg_train; a lone class folder is never unwrapped. */
async function unwrap(directory: string): Promise<string> {
  let current = directory;
  for (let depth = 0; depth < 4; depth++) {
    const children = await entries(current);
    const folders = children.filter((entry) => entry.isDirectory());
    if (
      children.some((entry) => entry.isFile() && IMAGE_EXTENSIONS.test(entry.name)) ||
      folders.length !== 1 ||
      folders[0].name.toLowerCase() !== basename(directory).toLowerCase()
    ) {
      break;
    }
    current = resolve(current, folders[0].name);
  }
  return current;
}

/** Breadth-first search for the shallowest folder carrying each section name (case-insensitive). */
async function findSections(root: string, names: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Map(names.map((name) => [name.toLowerCase(), name]));
  const found = new Map<string, string>();
  let level = [root];
  for (let depth = 0; depth <= 4 && level.length && found.size < names.length; depth++) {
    const next: string[] = [];
    const atDepth = new Map<string, string[]>();
    for (const directory of level) {
      const name = wanted.get(basename(directory).toLowerCase());
      if (directory !== root && name && !found.has(name)) {
        atDepth.set(name, [...(atDepth.get(name) ?? []), directory]);
        continue;
      }
      for (const entry of await entries(directory)) {
        if (entry.isDirectory()) {
          next.push(resolve(directory, entry.name));
        }
      }
    }
    for (const [name, matches] of atDepth) {
      if (matches.length > 1) {
        throw new Error(
          `Ambiguous dataset layout: ${name} appears at ${matches.map((match) => relative(root, match)).join(', ')}.`,
        );
      }
      found.set(name, matches[0]);
    }
    level = next;
  }
  return found;
}

/** Resolves a source's sections and class folders without assuming a fixed nesting depth. */
export async function discoverLayout(
  root: string,
  source: Pick<DatasetSource, 'name' | 'sections'>,
): Promise<DatasetLayout> {
  const found = await findSections(
    root,
    source.sections.map((section) => section.name).filter((name) => name !== '.'),
  );
  if (source.sections.some((section) => section.name === '.')) {
    found.set('.', root);
  }
  const sections: SectionLayout[] = [];
  for (const { name, role } of source.sections) {
    const directory = found.get(name);
    if (!directory) {
      if (role === 'unlabeled') {
        continue;
      }
      throw new Error(
        `The dataset at ${root} has no ${name} section. Point the ${source.name} path at the extracted archive.`,
      );
    }
    const content = await unwrap(directory);
    const folders = (await entries(content)).filter((entry) => entry.isDirectory());
    const labeled = role !== 'unlabeled';
    if (labeled && !folders.length) {
      throw new Error(`${name} contains no class folders.`);
    }
    sections.push({
      name,
      role,
      directory: relative(root, content).split('\\').join('/'),
      labeled,
      classes: labeled
        ? folders.map((folder) => ({
            label: folder.name.toLowerCase(),
            directory: relative(root, resolve(content, folder.name)).split('\\').join('/'),
          }))
        : [],
    });
  }
  return { root, sections };
}
