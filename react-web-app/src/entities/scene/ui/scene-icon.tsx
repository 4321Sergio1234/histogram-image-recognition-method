import { Image, Sun, Trees, Waves, type LucideProps } from 'lucide-react';

const icons: Record<string, typeof Waves> = { sea: Waves, forest: Trees, desert: Sun };

/** Decorative symbol for a supported scene; the scene name is always shown as text beside it. */
export function SceneIcon({ id, ...props }: { id: string } & LucideProps) {
  const Icon = icons[id] ?? Image;
  return <Icon aria-hidden="true" {...props} />;
}
