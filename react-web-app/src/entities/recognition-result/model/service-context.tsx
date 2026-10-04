import { createContext, useContext } from 'react';
import type { SceneRecognitionService } from './types';

export const RecognitionServiceContext = createContext<SceneRecognitionService | null>(null);

export function useRecognitionService(): SceneRecognitionService {
  const service = useContext(RecognitionServiceContext);
  if (!service) {
    throw new Error('Recognition service provider is missing.');
  }
  return service;
}
