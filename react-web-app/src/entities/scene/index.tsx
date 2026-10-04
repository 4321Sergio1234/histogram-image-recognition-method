import { Image, Sun, Trees, Waves, type LucideProps } from 'lucide-react';

export type { SceneClass } from '@horizon/brain/core';

const icons: Record<string, typeof Waves> = { sea: Waves, forest: Trees, desert: Sun };

/** Decorative symbol for a supported scene; the scene name is always shown as text beside it. */
export function SceneIcon({ id, ...props }: { id: string } & LucideProps) {
  const Icon = icons[id] ?? Image;
  return <Icon aria-hidden="true" {...props} />;
}

/** Human list such as “sea, forest and desert”, read from the model catalog rather than hard-coded. */
export function sceneList(names: readonly string[], conjunction = 'and'): string {
  const lower = names.map((name) => name.toLowerCase());
  return lower.length < 2
    ? lower.join('')
    : `${lower.slice(0, -1).join(', ')} ${conjunction} ${lower.at(-1)}`;
}
