import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_COPY as COPY } from '../config/copy';

function cameraError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return COPY.declined;
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return COPY.missing;
  }
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return COPY.inUse;
  }
  return COPY.startFailed;
}

export function useCamera(onCapture: (file: File) => void) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
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
      setError(COPY.unavailable);
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
      setError(COPY.notReady);
      return;
    }
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error(COPY.unsupported);
      }
      context.drawImage(source, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error(COPY.captureFailed))),
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
      setError(reason instanceof Error ? reason.message : COPY.retryCapture);
    } finally {
      setCapturing(false);
    }
  }
  return {
    open,
    close,
    error,
    ready,
    setReady,
    capturing,
    video,
    capture,
    openCamera: () => setOpen(true),
    retry: () => setAttempt((value) => value + 1),
  };
}
