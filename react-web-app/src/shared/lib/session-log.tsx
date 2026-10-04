import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export const SESSION_LOG_LIMIT = 200;

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
      setRows((current) => [
        ...current.slice(1 - SESSION_LOG_LIMIT),
        { at: new Date().toISOString(), ...row },
      ]),
    [],
  );
  return <LogContext value={{ rows, record }}>{children}</LogContext>;
}
