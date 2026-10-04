import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { downloadBlob } from '../lib/export-analysis';

export interface SessionOperation {
  at: string;
  operation: string;
  status: 'started' | 'success' | 'error';
  durationMs?: number;
  details?: string;
}
const LogContext = createContext<{
  rows: SessionOperation[];
  record: (row: Omit<SessionOperation, 'at'>) => void;
}>({ rows: [], record: () => undefined });
export const useSessionLog = () => useContext(LogContext);
export function SessionLogProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<SessionOperation[]>([]);
  const record = useCallback(
    (row: Omit<SessionOperation, 'at'>) =>
      setRows((current) => [...current.slice(-199), { at: new Date().toISOString(), ...row }]),
    [],
  );
  return <LogContext value={{ rows, record }}>{children}</LogContext>;
}
export function SessionLog() {
  const { rows } = useSessionLog();
  const save = () =>
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              scope: 'Last 200 operations in this page session; no image pixels or photo uploads',
              operations: rows,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'horizon-session-log.json',
    );
  return (
    <details className="session-log">
      <summary>
        Session log <span>({rows.length} operations)</span>
      </summary>
      <p>
        Stored in memory for this page session. Download it before closing the page. The last 200
        operations are shown.
      </p>
      <button className="button button-secondary" onClick={save} disabled={!rows.length}>
        Download operation log
      </button>
      <ol>
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`}>
            <time dateTime={row.at}>{new Date(row.at).toLocaleTimeString()}</time>{' '}
            <strong>{row.operation}</strong> · {row.status}
            {row.durationMs !== undefined && ` · ${row.durationMs.toFixed(1)} ms`}
            {row.details && <span> · {row.details}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
