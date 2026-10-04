import type { ModelManifest } from '@horizon/brain/core';
import { formatPercent } from '@/shared/lib/format';
import { DefinitionList, DetailsSection } from '@/shared/ui';
import { isHistogramFiltered, testCohort } from '../model/quality';

const COPY = {
  title: 'About the local model',
  version: 'Version',
  hash: 'Model SHA-256',
  method: 'Method',
  methodName: 'Zawyalow brightness histogram',
  preprocessing: 'Preprocessing',
  network: 'Network',
  sampleCounts: 'Training / validation / test images',
  training: 'Saved training epoch / learning rate',
  scenes: 'Supported scenes',
  inputs: 'Feature inputs',
  cleanAccuracy: 'Clean test accuracy',
  paletteAccuracy: 'Palette test accuracy',
  accuracy: 'Test accuracy',
  f1: 'Macro-F1',
  validation: 'Validation accuracy',
  library: 'Library',
  architecture: (value: string) => `${value} · sigmoid`,
  test: (accuracy: number, total: number, cohort: string) =>
    `${formatPercent(accuracy)} · ${total.toLocaleString()} ${cohort} test images`,
  brainVersion: (version: string) => `Brain.js ${version}`,
  sources: (datasets: string, train: string, test: string) =>
    `Datasets: ${datasets}. Training and validation: ${train}; final test: ${test}. Test accuracy describes these datasets, not a guarantee for your photo.`,
} as const;

export function ModelMetadata({ model }: { model: ModelManifest }) {
  const items = [
    { label: COPY.version, value: model.version },
    { label: COPY.hash, value: model.modelSha256, wrap: true },
    { label: COPY.method, value: COPY.methodName },
    { label: COPY.preprocessing, value: model.preprocessingVersion, wrap: true },
    { label: COPY.network, value: COPY.architecture(model.network.architecture) },
    {
      label: COPY.sampleCounts,
      value: `${model.sampleCounts.train} / ${model.sampleCounts.validation} / ${model.sampleCounts.test}`,
    },
    { label: COPY.training, value: `${model.network.iterations} / ${model.network.learningRate}` },
    { label: COPY.scenes, value: model.classes.map((label) => label.displayName).join(', ') },
    { label: COPY.inputs, value: model.featureLength.toLocaleString() },
    {
      label: isHistogramFiltered(model)
        ? COPY.cleanAccuracy
        : model.domain
          ? COPY.paletteAccuracy
          : COPY.accuracy,
      value: COPY.test(model.testMetrics.accuracy, model.testMetrics.total, testCohort(model)),
    },
    { label: COPY.f1, value: model.testMetrics.macroF1.toFixed(3) },
    { label: COPY.validation, value: formatPercent(model.validationMetrics.accuracy) },
    { label: COPY.library, value: COPY.brainVersion(model.brainVersion) },
  ];
  const datasets = model.datasets
    .map((dataset) => `${dataset.name} (${dataset.selectedClasses.join(', ')})`)
    .join('; ');
  return (
    <DetailsSection title={COPY.title} className="model-details">
      <DefinitionList items={items} />
      <p className="fine-print">
        {COPY.sources(datasets, model.split.trainSource, model.split.testSource)}
      </p>
    </DetailsSection>
  );
}
