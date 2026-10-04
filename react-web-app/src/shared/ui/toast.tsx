import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, X } from 'lucide-react';
import { SessionLogProvider } from './session-log';
const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(''), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SessionLogProvider>
      <ToastContext value={notify}>
        {children}
        <div className={`toast ${message ? 'is-visible' : ''}`} role="status" aria-live="polite">
          {message && (
            <>
              <Check size={18} />
              <span>{message}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setMessage('')}
              >
                <X size={17} />
              </button>
            </>
          )}
        </div>
      </ToastContext>
    </SessionLogProvider>
  );
}
