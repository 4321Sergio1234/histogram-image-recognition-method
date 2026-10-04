import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Dialog, useToast } from '@/shared/ui';
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function InstallPwa() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches,
  );
  const [open, setOpen] = useState(false);
  const notify = useToast();
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
      notify('Horizon is installed.');
    };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', complete);
    return () => {
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', complete);
    };
  }, [notify]);
  async function install() {
    if (!prompt) {
      setOpen(true);
      return;
    }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }
  if (installed) {
    return (
      <span className="installed-label">
        <Smartphone size={16} />
        Installed
      </span>
    );
  }
  return (
    <>
      <button className="button button-text install-button" onClick={() => void install()}>
        <Download size={16} />
        <span>Install app</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Keep Horizon close"
        description="Add Horizon to your home screen for quicker access on your next walk."
      >
        <div className="install-illustration">
          <img src="/icons/icon.svg" width="64" height="64" alt="" />
          <span>Horizon</span>
        </div>
        <p>
          In your browser menu, choose <strong>Install app</strong> or{' '}
          <strong>Add to Home Screen</strong>. On iPhone or iPad, open Safari’s Share menu first.
        </p>
        <p className="callout">
          Once the app and local model finish downloading, your next analysis can happen offline.
        </p>
      </Dialog>
    </>
  );
}
