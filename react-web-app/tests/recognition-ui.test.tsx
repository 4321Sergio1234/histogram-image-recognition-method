// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { SelectedImage } from '../src/entities/image-analysis';
import {
  RecognitionServiceContext,
  type SceneRecognitionService,
  type RecognitionProgress,
  type RecognitionResult,
} from '../src/entities/recognition-result';
import { RecognitionPage } from '../src/pages/recognition';
import { ToastProvider } from '../src/shared/ui';
import { prepareImage } from '../src/entities/image-analysis';
import { downloadBlob, exportAnalysis } from '../src/shared/lib/export-analysis';
import { formatBytes } from '../src/shared/lib/format';
import { SessionLogProvider } from '../src/shared/lib/session-log';
import { manifestFixture, sceneClasses } from './model-fixture';

vi.mock('../src/entities/image-analysis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/entities/image-analysis')>()),
  prepareImage: vi.fn(),
}));
vi.mock('../src/shared/lib/export-analysis', () => ({
  exportAnalysis: vi.fn(),
  downloadBlob: vi.fn(),
}));

const [sea, forest, desert] = sceneClasses;
const manifest = manifestFixture({
  version: 'test-model',
  network: {
    architecture: '1024 → 32 → 3',
    hiddenLayers: [32],
    activation: 'sigmoid',
    iterations: 8,
    learningRate: 0.1,
    momentum: 0.1,
  },
  uncertainty: { minScore: 0.65, minMargin: 0.15 },
});
const recognition: RecognitionResult = {
  prediction: { label: sea, score: 0.82 },
  predictions: [
    { label: sea, score: 0.82 },
    { label: desert, score: 0.31 },
    { label: forest, score: 0.05 },
  ],
  uncertain: false,
  histogram: Array.from({ length: 256 }, (_, index) => index),
  quantized: Array.from({ length: 256 }, () => 1),
  timings: { decodeMs: 2, pixelsMs: 3, featuresMs: 1, inferenceMs: 4, totalMs: 11 },
  model: manifest,
  completedAt: '2026-01-01T00:00:00Z',
  execution: 'worker',
};
const file = new File(['test image input'], 'coast.jpg', { type: 'image/jpeg' });
const selected: SelectedImage = {
  file,
  previewUrl: 'blob:test-photo',
  metadata: {
    name: file.name,
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    width: 640,
    height: 480,
    pixelCount: 307200,
    source: 'file',
  },
  dispose: vi.fn(),
};
let service: SceneRecognitionService;
function start() {
  return render(
    <RecognitionServiceContext value={service}>
      <SessionLogProvider>
        <ToastProvider>
          <RecognitionPage />
        </ToastProvider>
      </SessionLogProvider>
    </RecognitionServiceContext>,
  );
}
async function choose() {
  await screen.findByText('Local model ready');
  fireEvent.change(screen.getByLabelText('Choose an image file'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Analyze image' });
}
async function recognize() {
  await choose();
  fireEvent.click(screen.getByRole('button', { name: 'Analyze image' }));
  return screen.findByTestId('recognition-result');
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.mocked(prepareImage).mockResolvedValue(selected);
  vi.mocked(exportAnalysis).mockResolvedValue({
    blob: new Blob(['output']),
    filename: 'horizon-result.bmp',
  });
  service = {
    getModelInfo: vi.fn().mockResolvedValue(manifest),
    recognize: vi.fn().mockResolvedValue(recognition),
  };
});
afterEach(cleanup);

describe('consumer scene recognition workflow', () => {
  it('presents a natural-scene product with exactly the three manifest scenes and no analysis without input', async () => {
    start();
    await screen.findByText('Local model ready');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Recognize a natural scene.',
    );
    expect(
      screen.getByText(/identify whether it shows a sea, forest or desert scene/),
    ).toBeInTheDocument();
    const catalog = screen.getByText('Supported scenes').closest('.catalog') as HTMLElement;
    expect(
      within(catalog)
        .getAllByText(/^(Sea|Forest|Desert)$/)
        .map((item) => item.textContent),
    ).toEqual(['Sea', 'Forest', 'Desert']);
    expect(
      within(catalog).getByText(
        /3 scene types\. Cities, rooms, people and other scenes are not recognized\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyze image' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(
      /fresh|rotten|food|produce|fruit|vegetable|nutrition|harvest|basket|zawyalow|brain\.js|variant/i,
    );
  });
  it('previews a selected image and its metadata before analysis', async () => {
    start();
    await choose();
    expect(screen.getByRole('img', { name: 'Selected scene photo' })).toHaveAttribute(
      'src',
      'blob:test-photo',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Image information' }));
    const dialog = screen.getByRole('dialog', { name: 'Image information' });
    expect(within(dialog).getByText('2.0 KB')).toBeInTheDocument();
    expect(within(dialog).getByText('640 × 480 px')).toBeInTheDocument();
    expect(within(dialog).getByText('307,200')).toBeInTheDocument();
  });
  it('announces actual service progress until a result arrives', async () => {
    let finish!: (result: RecognitionResult) => void;
    let progress!: (value: RecognitionProgress) => void;
    service.recognize = vi.fn((_image, update) => {
      progress = update!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    start();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze image' }));
    act(() =>
      progress({ stage: 'encoding', label: 'Encoding 1,024 features', step: 5, totalSteps: 8 }),
    );
    expect(screen.getByRole('progressbar', { name: 'Recognition progress' })).toHaveAttribute(
      'value',
      '5',
    );
    expect(screen.getByText('Encoding 1,024 features')).toBeInTheDocument();
    await act(async () => finish(recognition));
    expect(await screen.findByTestId('recognition-result')).toBeInTheDocument();
  });
  it('shows the predicted scene, model confidence, alternatives and processing time without food or freshness semantics', async () => {
    start();
    const result = await recognize();
    expect(within(result).getByRole('heading', { name: 'Sea' })).toBeInTheDocument();
    expect(within(result).getByText('Predicted scene')).toBeInTheDocument();
    expect(within(result).getByText('Model confidence')).toBeInTheDocument();
    expect(
      within(result).getByText('An uncalibrated model score, not a probability of being right.'),
    ).toBeInTheDocument();
    const alternatives = within(result).getByRole('region', { name: 'Other possible scenes' });
    expect(within(alternatives).getAllByRole('listitem')).toHaveLength(2);
    expect(alternatives).toHaveTextContent('Desert31.0%');
    expect(alternatives).toHaveTextContent('Forest5.0%');
    expect(within(result).getByText('11.0 ms')).toBeInTheDocument();
    expect(
      within(result).getByText(/recognizes sea, forest and desert scenes only/),
    ).toBeInTheDocument();
    expect(result.textContent).not.toMatch(/fresh|rotten|food|produce|nutrition|looks fresh/i);
  });
  it('exposes uncertain predictions and explains the supported scope instead of claiming an unknown class', async () => {
    vi.mocked(service.recognize).mockResolvedValue({
      ...recognition,
      uncertain: true,
      prediction: { label: desert, score: 0.41 },
      predictions: [
        { label: desert, score: 0.41 },
        { label: sea, score: 0.38 },
        { label: forest, score: 0.1 },
      ],
    });
    start();
    const result = await recognize();
    expect(within(result).getByText('Uncertain result')).toBeInTheDocument();
    expect(within(result).getByRole('heading', { name: 'Desert' })).toBeInTheDocument();
    expect(
      within(result).getByText(/The model recognizes only sea, forest and desert scenes\./),
    ).toBeInTheDocument();
    expect(result.textContent).not.toMatch(/unknown/i);
  });
  it('shows recognition failure while retaining the photo for retry', async () => {
    vi.mocked(service.recognize).mockRejectedValueOnce(new Error('Model file is damaged.'));
    start();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Model file is damaged.');
    expect(screen.getByRole('img', { name: 'Selected scene photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze image' }));
    expect(await screen.findByTestId('recognition-result')).toBeInTheDocument();
  });
  it('recovers from model-loading failure through an explicit retry', async () => {
    vi.mocked(service.getModelInfo).mockRejectedValueOnce(new Error('Model download failed.'));
    start();
    expect(await screen.findByRole('alert')).toHaveTextContent('Model download failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry model' }));
    await screen.findByText('Local model ready');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('rejects an invalid selection with a useful message', async () => {
    vi.mocked(prepareImage).mockRejectedValueOnce(new Error('Choose a JPEG, PNG, or WebP image.'));
    start();
    await screen.findByText('Local model ready');
    fireEvent.change(screen.getByLabelText('Choose an image file'), {
      target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a JPEG, PNG, or WebP image.',
    );
    expect(screen.queryByRole('img', { name: 'Selected scene photo' })).not.toBeInTheDocument();
  });
  it('resets results and releases the selected image', async () => {
    start();
    await recognize();
    fireEvent.click(screen.getByRole('button', { name: 'Analyze another image' }));
    expect(screen.queryByTestId('recognition-result')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose image' })).toBeInTheDocument();
    expect(selected.dispose).toHaveBeenCalledTimes(1);
  });
  it('opens both histograms, all three labelled network outputs, timings and facts from the model that produced the result', async () => {
    service.recognize = vi.fn().mockResolvedValue({
      ...recognition,
      model: { ...manifest, version: 'result-model', modelSha256: 'b'.repeat(64) },
    });
    start();
    await recognize();
    fireEvent.click(screen.getByRole('button', { name: 'Analysis details' }));
    const dialog = screen.getByRole('dialog', { name: 'Analysis details' });
    expect(
      within(dialog).getByRole('img', { name: /Original 256-bin brightness histogram/ }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('img', { name: /Quantized histogram, each bin scaled to 0–15/ }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('1,024 input values')).toBeInTheDocument();
    const outputs = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.closest('.scene-outputs'));
    expect(outputs.map((item) => item.textContent)).toEqual([
      'Sea82.0%',
      'Forest5.0%',
      'Desert31.0%',
    ]);
    const table = within(dialog).getByRole('table');
    expect(table).toHaveTextContent('Preprocessing total6.00 ms');
    expect(table).toHaveTextContent('Neural network4.00 ms');
    expect(table).toHaveTextContent('Total analysis11.00 ms');
    expect(within(dialog).getByText('result-model')).toBeInTheDocument();
    expect(within(dialog).queryByText('test-model')).not.toBeInTheDocument();
    expect(within(dialog).getByText('b'.repeat(64))).toBeInTheDocument();
    expect(within(dialog).getByText('1024 → 32 → 3 · sigmoid')).toBeInTheDocument();
    expect(within(dialog).getByText('Sea, Forest, Desert')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Intel Image Classification \(sea, forest\); Landscape Recognition Image Dataset \(12k\) \(desert\)/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Model reliability' })).toHaveTextContent(
      '3 of 6 dataset test photos',
    );
    expect(within(dialog).getByRole('region', { name: 'Model reliability' })).toHaveTextContent(
      'Sea and Desert photos are mistaken for each other most often (2 test photos).',
    );
  });
  it('exports the selected format through one result action', async () => {
    start();
    await recognize();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
      target: { value: 'bmp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export result' }));
    await waitFor(() => expect(exportAnalysis).toHaveBeenCalledWith(selected, recognition, 'bmp'));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'horizon-result.bmp');
    expect(await screen.findByText('BMP analysis image downloaded.')).toBeInTheDocument();
  });
  it('labels restricted metrics with palette scope and full-population coverage from the result manifest', async () => {
    const scoped = {
      ...manifest,
      domain: {
        id: 'geoscene-canonical-palette-v1' as const,
        description: 'Blue/cyan sea, green forest and warm sandy desert only.',
        palettes: [
          { id: 'sea', description: 'Blue/cyan sea' },
          { id: 'forest', description: 'Green forest' },
          { id: 'desert', description: 'Warm sandy desert' },
        ],
        paletteTestCoverage: 0.3,
        populationTestMetrics: { ...manifest.testMetrics, total: 20, accuracy: 0.4 },
        sourceCaveat: 'Renamed photos retain their original source bias.',
      },
    };
    service.getModelInfo = vi.fn().mockResolvedValue(scoped);
    service.recognize = vi.fn().mockResolvedValue({ ...recognition, model: scoped });
    start();
    const result = await recognize();
    expect(result).toHaveTextContent(scoped.domain.description);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis details' }));
    const dialog = screen.getByRole('dialog', { name: 'Analysis details' });
    const quality = within(dialog).getByRole('region', { name: 'Model reliability' });
    expect(quality).toHaveTextContent('3 of 6 palette-selected test photos');
    expect(quality).toHaveTextContent('cover 30.0% of the original test partition');
    expect(quality).toHaveTextContent('Across all 20 test photos, accuracy was 40.0%');
    expect(dialog).toHaveTextContent(scoped.domain.sourceCaveat);
  });
  it('shows strict test counts without inventing an unfiltered-population accuracy', async () => {
    const scoped = {
      ...manifest,
      domain: {
        id: 'geoscene-strict-histogram-v1' as const,
        description: 'Typical palettes with distinct brightness histograms.',
        palettes: sceneClasses.map((label) => ({ id: label.id, description: label.displayName })),
        paletteTestCoverage: 0.3,
        testPopulationCount: 20,
        cleanDatasetFingerprint: manifest.datasetFingerprint,
        sourceCaveat: 'Previously inspected images.',
      },
    };
    service.getModelInfo = vi.fn().mockResolvedValue(scoped);
    service.recognize = vi.fn().mockResolvedValue({ ...recognition, model: scoped });
    start();
    await recognize();
    fireEvent.click(screen.getByRole('button', { name: 'Analysis details' }));
    const quality = screen.getByRole('region', { name: 'Model reliability' });
    expect(quality).toHaveTextContent('3 of 6 histogram-filtered test photos');
    expect(quality).toHaveTextContent(
      'Training, validation and test use the same palette and histogram rule.',
    );
    expect(quality).toHaveTextContent('Sea 2 · Forest 2 · Desert 2');
    expect(quality).not.toHaveTextContent('Across all');
  });
  it('formats byte sizes at the MB boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
  });
});
