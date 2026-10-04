import { Download, Smartphone } from 'lucide-react';
import { Button, Dialog } from '@/shared/ui';
import { INSTALL_COPY as COPY } from '../config/copy';
import { useInstallPwa } from '../model/use-install-pwa';

export function InstallPwa() {
  const control = useInstallPwa();
  if (control.installed) {
    return (
      <span className="installed-label">
        <Smartphone size={16} />
        {COPY.installed}
      </span>
    );
  }
  return (
    <>
      <Button
        variant="text"
        className="install-button"
        onClick={() => void control.install()}
        icon={<Download size={16} />}
      >
        <span>{COPY.install}</span>
      </Button>
      <Dialog
        open={control.open}
        onClose={control.close}
        title={COPY.title}
        description={COPY.description}
      >
        <div className="install-illustration">
          <img src="/icons/icon.svg" width="64" height="64" alt="" />
          <span>{COPY.brand}</span>
        </div>
        <p>
          {COPY.menu}
          <strong>{COPY.install}</strong>
          {COPY.alternative}
          <strong>{COPY.homeScreen}</strong>
          {COPY.safari}
        </p>
        <p className="callout">{COPY.offline}</p>
      </Dialog>
    </>
  );
}
