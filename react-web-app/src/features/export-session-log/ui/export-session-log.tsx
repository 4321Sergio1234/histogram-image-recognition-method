import { downloadBlob } from '@/shared/lib/export-analysis';
import { SESSION_LOG_LIMIT, useSessionLog } from '@/shared/lib/session-log';
import { Button } from '@/shared/ui';

const COPY = {
  download: 'Download operation log',
  scope: `Last ${SESSION_LOG_LIMIT} operations in this page session; no image pixels or photo uploads`,
} as const;

export function ExportSessionLog() {
  const { rows } = useSessionLog();
  const save = () =>
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), scope: COPY.scope, operations: rows },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'horizon-session-log.json',
    );
  return (
    <Button variant="secondary" onClick={save} disabled={!rows.length}>
      {COPY.download}
    </Button>
  );
}
