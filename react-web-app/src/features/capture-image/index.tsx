import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, LoaderCircle, RefreshCw } from 'lucide-react';
import { Dialog } from '@/shared/ui';

function cameraError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Camera permission was declined. Allow camera access in your browser, or choose a photo below.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No camera was found. Connect a camera, or choose a photo below.';
  }
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return 'Your camera may be in use by another app. Close it there and try again.';
  }
  return 'The camera could not start. Try again, or use your device’s photo picker.';
}

export function CaptureImage({
  onCapture,
  disabled = false,
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const close = useCallback(() => {
    stop();
    setOpen(false);
  }, [stop]);
  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    setReady(false);
    setError('');
    setCapturing(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Live camera access is unavailable in this browser. Use the device camera or photo picker below.',
      );
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (media) => {
        if (!active) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
      })
      .catch((reason) => {
        if (active) {
          stop();
          setError(cameraError(reason));
        }
      });
    return () => {
      active = false;
      stop();
    };
  }, [open, attempt, stop]);

  async function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) {
      setError('The camera is still starting. Please try again in a moment.');
      return;
    }
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to capture a photo in this browser.');
      }
      context.drawImage(source, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Photo capture failed.'))),
          'image/jpeg',
          0.94,
        ),
      );
      canvas.width = 0;
      canvas.height = 0;
      onCapture(
        new File([blob], `horizon-photo-${new Date().toISOString().slice(0, 10)}.jpg`, {
          type: 'image/jpeg',
        }),
      );
      close();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Photo capture failed. Please try again.',
      );
    } finally {
      setCapturing(false);
    }
  }
  return (
    <>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Camera size={18} />
        Take photo
      </button>
      <Dialog
        open={open}
        onClose={close}
        title="Frame the scene"
        description="Step back and fit as much of the view as you can, in daylight."
        className="camera-dialog"
      >
        <div className={`camera-view ${error ? 'has-error' : ''}`}>
          {!error && (
            <video
              ref={video}
              muted
              autoPlay
              playsInline
              onLoadedMetadata={() => setReady(true)}
              aria-label="Live camera preview"
            />
          )}
          {!ready && !error && (
            <div className="camera-status">
              <LoaderCircle className="spin" size={28} />
              <p>Starting your camera…</p>
            </div>
          )}
          {error && (
            <div className="camera-status">
              <Camera size={36} />
              <p role="alert">{error}</p>
              <button
                className="button button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                <RefreshCw size={16} />
                Try camera again
              </button>
            </div>
          )}
          {ready && !error && <div className="camera-guide" aria-hidden="true" />}
        </div>
        <div className="camera-actions">
          <button
            className="button button-primary"
            onClick={() => void capture()}
            disabled={!ready || !!error || capturing}
          >
            <Circle size={18} />
            {capturing ? 'Capturing…' : 'Capture photo'}
          </button>
          <button className="button button-text" onClick={() => fallback.current?.click()}>
            Use device camera or gallery
          </button>
          <input
            ref={fallback}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Use device camera or gallery"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onCapture(file);
                close();
              }
              event.target.value = '';
            }}
          />
        </div>
        <p className="fine-print center">Your camera is only active while this window is open.</p>
      </Dialog>
    </>
  );
}
