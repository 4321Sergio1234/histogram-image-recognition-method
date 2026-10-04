import type { ModelManifest } from '@horizon/brain/core';
import type { RecognitionResult } from '@/entities/recognition-result';
import { sceneList } from '@/entities/scene';
import { DetailsSection, Dialog } from '@/shared/ui';
import { HistogramAnalysis } from './histogram-analysis';
import { NetworkOutputs } from './network-outputs';
import { ProcessingTimes } from './processing-times';
import { RecognitionMethod } from './recognition-method';
import { ModelReliability } from './model-reliability';
import { ModelMetadata } from './model-metadata';

const COPY = {
  resultTitle: 'Analysis details',
  methodTitle: 'How it works',
  resultDescription: 'The brightness pattern behind this result.',
  methodDescription: 'A local model. A simple idea. A clear limit.',
  defaultScenes: 'the supported',
  paletteTitle: 'Trained palette scope',
  limitationTitle: 'A useful clue, with limits',
  limitation: (scenes: string) =>
    `Brightness alone cannot capture color, shape or where things appear in the frame. Blue water and warm sand can share a similar brightness pattern; changing the lighting or palette can change the result. The model always chooses one of ${scenes} — even for a city, a room or a person — so a result for any other kind of photo is not meaningful.`,
} as const;

export function AnalysisDetails({
  open,
  onClose,
  model,
  result,
}: {
  open: boolean;
  onClose: () => void;
  model: ModelManifest | null;
  result: RecognitionResult | null;
}) {
  const qualityModel = result?.model ?? model;
  const scenes = qualityModel
    ? sceneList(
        qualityModel.classes.map((label) => label.displayName),
        'or',
      )
    : COPY.defaultScenes;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={result ? COPY.resultTitle : COPY.methodTitle}
      description={result ? COPY.resultDescription : COPY.methodDescription}
      className="analysis-dialog"
    >
      {result ? (
        <>
          <HistogramAnalysis result={result} />
          <NetworkOutputs result={result} />
          <ProcessingTimes result={result} />
        </>
      ) : (
        <RecognitionMethod scenes={scenes} />
      )}
      {qualityModel && <ModelReliability model={qualityModel} />}
      {qualityModel?.domain && (
        <DetailsSection title={COPY.paletteTitle}>
          <p>{qualityModel.domain.description}</p>
          <p className="fine-print">{qualityModel.domain.sourceCaveat}</p>
        </DetailsSection>
      )}
      <div className="callout limitation-callout">
        <strong>{COPY.limitationTitle}</strong>
        <p>{COPY.limitation(scenes)}</p>
      </div>
      {qualityModel && <ModelMetadata model={qualityModel} />}
    </Dialog>
  );
}
