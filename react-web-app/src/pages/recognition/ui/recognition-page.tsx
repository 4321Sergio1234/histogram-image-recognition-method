import { useState } from 'react';
import { AppHeader } from '@/widgets/app-header';
import { AppFooter } from '@/widgets/app-footer';
import { RecognitionWorkspace } from '@/widgets/recognition-workspace';
import { RecognitionResult } from '@/widgets/recognition-result';
import { ContextualPanel } from '@/widgets/contextual-analysis-panel';
import { SessionLog } from '@/widgets/session-log';
import { AnalysisDetails } from '@/features/view-analysis-details';
import { PhotoTips } from '@/features/view-photo-tips';
import { ImageInfo } from '@/features/view-image-info';
import { useRecognition } from '@/features/recognize-scene';
import { sceneList } from '@/entities/scene';
import { RecognitionHero } from './recognition-hero';
import { WorkflowSteps } from './workflow-steps';
import { ModelError, ModelStatus } from './model-status';

const COPY = { skip: 'Skip to main content', defaultScenes: 'sea, forest or desert' } as const;

export function RecognitionPage() {
  const flow = useRecognition();
  const [infoOpen, setInfoOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const currentStep = flow.result ? 2 : flow.image ? 1 : 0;
  const scenes = flow.model
    ? sceneList(
        flow.model.classes.map((label) => label.displayName),
        'or',
      )
    : COPY.defaultScenes;
  return (
    <>
      <a className="skip-link" href="#main-content">
        {COPY.skip}
      </a>
      <AppHeader onAbout={() => setDetailsOpen(true)} />
      <main id="main-content" className="main-content">
        <RecognitionHero scenes={scenes} />
        <WorkflowSteps currentStep={currentStep} />
        <ModelError error={flow.modelError} onRetry={() => void flow.retryModel()} />
        <div className={`recognition-layout ${flow.result ? 'has-result' : ''}`}>
          <RecognitionWorkspace
            image={flow.image}
            result={flow.result}
            progress={flow.progress}
            selecting={flow.selecting}
            analyzing={flow.analyzing}
            canAnalyze={!!flow.model && !flow.loadingModel}
            error={flow.error}
            onSelect={(file) => void flow.selectImage(file)}
            onCapture={(file) => void flow.selectImage(file, 'camera')}
            onAnalyze={() => void flow.analyze()}
            onReset={flow.reset}
            onInfo={() => setInfoOpen(true)}
          />
          {flow.result && flow.image ? (
            <RecognitionResult
              image={flow.image}
              result={flow.result}
              onDetails={() => setDetailsOpen(true)}
            />
          ) : (
            <ContextualPanel
              model={flow.model}
              loading={flow.loadingModel}
              onDetails={() => setDetailsOpen(true)}
              onTips={() => setTipsOpen(true)}
            />
          )}
        </div>
        <ModelStatus loading={flow.loadingModel} ready={!!flow.model} scenes={scenes} />
        <SessionLog />
      </main>
      <AppFooter />
      {flow.image && (
        <ImageInfo
          image={flow.image}
          result={flow.result}
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
        />
      )}
      <AnalysisDetails
        model={flow.model}
        result={flow.result}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
      <PhotoTips
        model={flow.result?.model ?? flow.model}
        open={tipsOpen}
        onClose={() => setTipsOpen(false)}
      />
    </>
  );
}
