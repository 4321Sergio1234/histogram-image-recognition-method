import { useEffect, useState } from 'react';
import { ArrowUpRight, Sunrise, WifiOff } from 'lucide-react';
import { InstallPwa } from '@/features/install-pwa';
export function AppHeader({ onAbout }: { onAbout: () => void }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="#main-content" aria-label="Horizon home">
          <span className="brand-symbol">
            <Sunrise size={24} strokeWidth={1.6} />
          </span>
          horizon<span className="brand-dot">.</span>
        </a>
        <div className="header-tools">
          {!online && (
            <span className="offline-badge">
              <WifiOff size={14} />
              Offline
            </span>
          )}
          <button className="button button-text about-button" onClick={onAbout}>
            How it works
            <ArrowUpRight size={15} />
          </button>
          <span className="header-divider" aria-hidden="true" />
          <InstallPwa />
        </div>
      </div>
    </header>
  );
}
