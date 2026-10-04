import { LockKeyhole, Sunrise } from 'lucide-react';
export function AppFooter() {
  return (
    <footer className="site-footer">
      <p>
        <LockKeyhole size={14} />
        Your photo stays yours. Always processed on your device.
      </p>
      <span>
        <Sunrise size={15} />A wider view.
      </span>
    </footer>
  );
}
