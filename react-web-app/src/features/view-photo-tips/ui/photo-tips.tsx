import type { ModelManifest } from '@horizon/brain/core';
import { PHOTO_GUIDANCE } from '@/entities/scene';
import { Dialog, InstructionList } from '@/shared/ui';

const COPY = {
  title: 'A clearer view',
  description: 'A few small changes can help the model.',
} as const;

export function PhotoTips({
  open,
  onClose,
  model,
}: {
  open: boolean;
  onClose: () => void;
  model?: ModelManifest | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={COPY.title} description={COPY.description}>
      {model?.domain && <p>{model.domain.description}</p>}
      <InstructionList items={PHOTO_GUIDANCE} />
    </Dialog>
  );
}
