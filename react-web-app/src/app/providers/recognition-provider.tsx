import { useEffect, useState, type ReactNode } from 'react';
import {
  LocalBrainSceneRecognitionService,
  RecognitionServiceContext,
  type SceneRecognitionService,
} from '@/entities/recognition-result';

export function RecognitionProvider({
  children,
  service: provided,
}: {
  children: ReactNode;
  service?: SceneRecognitionService;
}) {
  const [service] = useState(() => provided ?? new LocalBrainSceneRecognitionService());
  useEffect(
    () => () => {
      if (!provided) {
        service.dispose?.();
      }
    },
    [service, provided],
  );
  return <RecognitionServiceContext value={service}>{children}</RecognitionServiceContext>;
}
