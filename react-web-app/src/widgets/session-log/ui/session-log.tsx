import { ExportSessionLog } from '@/features/export-session-log';
import { SESSION_LOG_LIMIT, useSessionLog } from '@/shared/lib/session-log';
import { formatDuration } from '@/shared/lib/format';

const COPY = {
  title: 'Session log',
  description: `Stored in memory for this page session. Download it before closing the page. The last ${SESSION_LOG_LIMIT} operations are shown.`,
  count: (count: number) => `(${count} operations)`,
  status: (status: string) => ` · ${status}`,
  detail: (value: string) => ` · ${value}`,
} as const;

export function SessionLog() {
  const { rows } = useSessionLog();
  return (
    <details className="session-log">
      <summary>
        {COPY.title} <span>{COPY.count(rows.length)}</span>
      </summary>
      <p>{COPY.description}</p>
      <ExportSessionLog />
      <ol>
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`}>
            <time dateTime={row.at}>{new Date(row.at).toLocaleTimeString()}</time>{' '}
            <strong>{row.operation}</strong>
            {COPY.status(row.status)}
            {row.durationMs !== undefined && COPY.detail(formatDuration(row.durationMs))}
            {row.details && <span>{COPY.detail(row.details)}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
