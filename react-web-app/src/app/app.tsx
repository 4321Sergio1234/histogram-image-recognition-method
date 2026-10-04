import { RecognitionPage } from '@/pages/recognition';
import { ToastProvider } from '@/shared/ui';
import { RecognitionProvider } from './providers/recognition-provider';
export function App() {
  return (
    <RecognitionProvider>
      <ToastProvider>
        <RecognitionPage />
      </ToastProvider>
    </RecognitionProvider>
  );
}
