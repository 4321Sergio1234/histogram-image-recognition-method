import { LockKeyhole, Sunrise } from 'lucide-react';

const COPY = {
  privacy: 'Your photo stays yours. Always processed on your device.',
  tagline: 'A wider view.',
} as const;

export function AppFooter() {
  return (
    <footer className="site-footer">
      <p>
        <LockKeyhole size={14} />
        {COPY.privacy}
      </p>
      <span>
        <Sunrise size={15} />
        {COPY.tagline}
      </span>
    </footer>
  );
}
