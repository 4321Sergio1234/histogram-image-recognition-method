import { RecognitionPage } from '@/pages/recognition';
import { AppProviders } from './providers/app-providers';
export function App() {
  return (
    <AppProviders>
      <RecognitionPage />
    </AppProviders>
  );
}
