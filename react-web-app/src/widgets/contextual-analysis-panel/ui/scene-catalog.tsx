import { ArrowUpRight, Compass, LoaderCircle } from 'lucide-react';
import type { ModelManifest } from '@horizon/brain/core';
import { SceneIcon } from '@/entities/scene';
import { Button } from '@/shared/ui';

const COPY = {
  title: 'Supported scenes',
  loading: 'Loading supported scenes…',
  empty: 'The supported scene list will appear when the local model is ready.',
  palette: 'Palette scope:',
  about: 'About this recognition',
  scope: (count: number) =>
    `${count} scene types. Cities, rooms, people and other scenes are not recognized.`,
  palettes: (descriptions: readonly string[]) =>
    `${descriptions.join('; ')}. Other palettes may be misclassified.`,
} as const;

export function SceneCatalog({
  model,
  loading,
  onDetails,
}: {
  model: ModelManifest | null;
  loading: boolean;
  onDetails: () => void;
}) {
  const scenes = model?.classes ?? [];
  return (
    <div className="catalog">
      <div className="catalog-heading">
        <Compass size={16} />
        <span>{COPY.title}</span>
      </div>
      {loading ? (
        <p className="catalog-loading">
          <LoaderCircle size={15} className="spin" />
          {COPY.loading}
        </p>
      ) : scenes.length ? (
        <>
          <div className="catalog-items">
            {scenes.map((scene) => (
              <span key={scene.id}>
                <SceneIcon id={scene.id} size={13} />
                {scene.displayName}
              </span>
            ))}
          </div>
          <p>{COPY.scope(scenes.length)}</p>
        </>
      ) : (
        <p>{COPY.empty}</p>
      )}
      {model?.domain && (
        <p>
          <strong>{COPY.palette}</strong>{' '}
          {COPY.palettes(model.domain.palettes.map((item) => item.description))}
        </p>
      )}
      <Button variant="link" onClick={onDetails} trailingIcon={<ArrowUpRight size={14} />}>
        {COPY.about}
      </Button>
    </div>
  );
}
