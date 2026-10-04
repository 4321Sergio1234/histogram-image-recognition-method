import { ArrowUpRight, Sunrise, WifiOff } from 'lucide-react';
import { InstallPwa } from '@/features/install-pwa';
import { useOnline } from '@/shared/lib/use-online';
import { Button } from '@/shared/ui';

const COPY = {
  home: 'Horizon home',
  brand: 'horizon',
  dot: '.',
  offline: 'Offline',
  about: 'How it works',
} as const;

export function AppHeader({ onAbout }: { onAbout: () => void }) {
  const online = useOnline();
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="#main-content" aria-label={COPY.home}>
          <span className="brand-symbol">
            <Sunrise size={24} strokeWidth={1.6} />
          </span>
          {COPY.brand}
          <span className="brand-dot">{COPY.dot}</span>
        </a>
        <div className="header-tools">
          {!online && (
            <span className="offline-badge">
              <WifiOff size={14} />
              {COPY.offline}
            </span>
          )}
          <Button
            variant="text"
            className="about-button"
            onClick={onAbout}
            trailingIcon={<ArrowUpRight size={15} />}
          >
            {COPY.about}
          </Button>
          <span className="header-divider" aria-hidden="true" />
          <InstallPwa />
        </div>
      </div>
    </header>
  );
}
