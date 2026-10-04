import { useEffect, useState } from 'react';
import { useToast } from '@/shared/ui';
import { INSTALL_COPY as COPY } from '../config/copy';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function useInstallPwa() {
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
      notify(COPY.installedNotification);
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
  return { installed, open, install, close: () => setOpen(false) };
}
