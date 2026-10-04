import { AlertCircle, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/shared/ui';

const COPY = {
  error: 'The local model isn’t ready',
  retry: 'Retry model',
  loading: 'Preparing your local model…',
  ready: 'Local model ready',
  unavailable: 'Local model unavailable',
  scope: (scenes: string) => `Recognizes ${scenes} scenes only`,
} as const;

export function ModelError({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (!error) {
    return null;
  }
  return (
    <div className="model-error" role="alert">
      <AlertCircle size={21} />
      <div>
        <strong>{COPY.error}</strong>
        <p>{error}</p>
      </div>
      <Button variant="secondary" onClick={onRetry} trailingIcon={<ArrowUpRight size={16} />}>
        {COPY.retry}
      </Button>
    </div>
  );
}

export function ModelStatus({
  loading,
  ready,
  scenes,
}: {
  loading: boolean;
  ready: boolean;
  scenes: string;
}) {
  return (
    <div className="below-workspace">
      <span>
        {loading ? (
          <>
            <LoaderCircle className="spin" size={13} />
            {COPY.loading}
          </>
        ) : ready ? (
          COPY.ready
        ) : (
          <>
            <AlertCircle size={13} />
            {COPY.unavailable}
          </>
        )}
      </span>
      <p>{COPY.scope(scenes)}</p>
    </div>
  );
}
