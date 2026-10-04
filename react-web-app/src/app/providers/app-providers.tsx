import type { ReactNode } from 'react';
import { SessionLogProvider } from '@/shared/lib/session-log';
import { ToastProvider } from '@/shared/ui';
import { RecognitionProvider } from './recognition-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <RecognitionProvider>
      <SessionLogProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionLogProvider>
    </RecognitionProvider>
  );
}
