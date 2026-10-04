// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureImage } from '../src/features/capture-image';

const stop = vi.fn();
const media = { getTracks: () => [{ stop }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  getUserMedia.mockResolvedValue(media);
});
afterEach(cleanup);

describe('camera lifecycle', () => {
  it('requests permission only after the camera action and stops tracks when closed', async () => {
    render(<CaptureImage onCapture={vi.fn()} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() =>
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('stops a late stream when the user closes the dialog during permission resolution', async () => {
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((done) => {
        resolve = done;
      }),
    );
    render(<CaptureImage onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await act(async () => resolve(media));
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('provides a useful permission-denied message and device picker fallback', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Declined', 'NotAllowedError'));
    render(<CaptureImage onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Camera permission was declined.');
    expect(screen.getByRole('button', { name: 'Use device camera or gallery' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Capture photo' })).toBeDisabled();
  });
  it('offers a fallback in an insecure context without attempting camera access', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    render(<CaptureImage onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Live camera access is unavailable');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
