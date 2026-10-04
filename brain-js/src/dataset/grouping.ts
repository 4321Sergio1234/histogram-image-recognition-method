import type { AuditedImage, DuplicateSummary } from './types';

/** Unions byte-identical and pixel-identical images across every source, section and label. */
export function assignGroups(
  images: AuditedImage[],
  nearPairs: readonly { first: number; second: number }[] = [],
): DuplicateSummary {
  const parents = images.map((_, index) => index);
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  const seen = new Map<string, number>();
  images.forEach((image, index) => {
    for (const key of [`file:${image.sha256}`, `pixel:${image.pixelSha256}`]) {
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, index);
        continue;
      }
      const first = root(previous);
      const second = root(index);
      parents[Math.max(first, second)] = Math.min(first, second);
    }
  });
  for (const pair of nearPairs) {
    const first = root(pair.first);
    const second = root(pair.second);
    parents[Math.max(first, second)] = Math.min(first, second);
  }
  const members = new Map<string, AuditedImage[]>();
  images.forEach((image, index) => {
    image.group = images[root(index)].path;
    members.set(image.group, [...(members.get(image.group) ?? []), image]);
  });
  const duplicates = [...members.values()].filter((group) => group.length > 1);
  const poolTest = duplicates.filter(
    (group) =>
      group.some((image) => image.role === 'pool') && group.some((image) => image.role === 'test'),
  );
  return {
    groups: duplicates.length,
    imagesInGroups: duplicates.reduce((sum, group) => sum + group.length, 0),
    poolTestGroups: poolTest.length,
    poolTestImages: poolTest
      .flat()
      .map((image) => image.path)
      .sort((a, b) => a.localeCompare(b, 'en')),
    crossLabelGroups: duplicates
      .map((group) => ({
        labels: [
          ...new Set(
            group.map((image) => image.label).filter((label): label is string => label !== null),
          ),
        ].sort(),
        paths: group.map((image) => image.path).sort((a, b) => a.localeCompare(b, 'en')),
      }))
      .filter((group) => group.labels.length > 1),
  };
}
