import { useRef } from 'react';
import { Camera, Circle, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button, Dialog } from '@/shared/ui';
import { CAMERA_COPY as COPY } from '../config/copy';
import { useCamera } from '../model/use-camera';

export function CaptureImage({
  onCapture,
  disabled = false,
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const camera = useCamera(onCapture);
  const fallback = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={camera.openCamera}
        icon={<Camera size={18} />}
      >
        {COPY.take}
      </Button>
      <Dialog
        open={camera.open}
        onClose={camera.close}
        title={COPY.title}
        description={COPY.description}
        className="camera-dialog"
      >
        <div className={`camera-view ${camera.error ? 'has-error' : ''}`}>
          {!camera.error && (
            <video
              ref={camera.video}
              muted
              autoPlay
              playsInline
              onLoadedMetadata={() => camera.setReady(true)}
              aria-label={COPY.preview}
            />
          )}
          {!camera.ready && !camera.error && (
            <div className="camera-status">
              <LoaderCircle className="spin" size={28} />
              <p>{COPY.starting}</p>
            </div>
          )}
          {camera.error && (
            <div className="camera-status">
              <Camera size={36} />
              <p role="alert">{camera.error}</p>
              <Button variant="secondary" onClick={camera.retry} icon={<RefreshCw size={16} />}>
                {COPY.retry}
              </Button>
            </div>
          )}
          {camera.ready && !camera.error && <div className="camera-guide" aria-hidden="true" />}
        </div>
        <div className="camera-actions">
          <Button
            onClick={() => void camera.capture()}
            disabled={!camera.ready || !!camera.error || camera.capturing}
            icon={<Circle size={18} />}
          >
            {camera.capturing ? COPY.capturing : COPY.capture}
          </Button>
          <Button variant="text" onClick={() => fallback.current?.click()}>
            {COPY.picker}
          </Button>
          <input
            ref={fallback}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={COPY.picker}
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onCapture(file);
                camera.close();
              }
              event.target.value = '';
            }}
          />
        </div>
        <p className="fine-print center">{COPY.privacy}</p>
      </Dialog>
    </>
  );
}
