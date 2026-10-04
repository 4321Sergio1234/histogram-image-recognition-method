import { ArrowUpRight, Focus } from 'lucide-react';
import type { ModelManifest } from '@horizon/brain/core';
import { PhotoGuidance } from '@/entities/scene';
import { Button } from '@/shared/ui';
import { SceneCatalog } from './scene-catalog';

const COPY = {
  label: 'Photo guidance',
  eyebrow: 'WHAT WORKS BEST',
  title: 'The whole view.',
  subtitle: 'Not the details.',
  tips: 'Tips for a better photo',
} as const;

export function ContextualPanel({
  model,
  loading,
  onDetails,
  onTips,
}: {
  model: ModelManifest | null;
  loading: boolean;
  onDetails: () => void;
  onTips: () => void;
}) {
  return (
    <aside className="context-panel" aria-label={COPY.label}>
      <div className="context-guide">
        <span className="section-label">{COPY.eyebrow}</span>
        <h2>
          {COPY.title}
          <br />
          {COPY.subtitle}
        </h2>
        <PhotoGuidance />
      </div>
      <Button
        variant="secondary"
        className="mobile-tips-button"
        onClick={onTips}
        icon={<Focus size={17} />}
        trailingIcon={<ArrowUpRight size={16} />}
      >
        {COPY.tips}
      </Button>
      <SceneCatalog model={model} loading={loading} onDetails={onDetails} />
    </aside>
  );
}
