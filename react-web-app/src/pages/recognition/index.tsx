import { useState } from 'react';
import { AlertCircle, ArrowUpRight, Check, LoaderCircle } from 'lucide-react';
import { AppHeader } from '@/widgets/app-header';
import { AppFooter } from '@/widgets/app-footer';
import { RecognitionWorkspace } from '@/widgets/recognition-workspace';
import { RecognitionResult } from '@/widgets/recognition-result';
import { AnalysisDetails, ContextualPanel, PhotoTips } from '@/widgets/contextual-analysis-panel';
import { ImageInfo } from '@/features/view-image-info';
import { useRecognition } from '@/features/recognize-scene';
import { sceneList } from '@/entities/scene';
import { SessionLog } from '@/shared/ui';

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
    : 'sea, forest or desert';
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <AppHeader onAbout={() => setDetailsOpen(true)} />
      <main id="main-content" className="main-content">
        <div className="hero">
          <div>
            <p className="eyebrow">
              <span /> NATURAL SCENE RECOGNITION
            </p>
            <h1>
              Recognize a<br className="mobile-break" /> <em>natural scene.</em>
            </h1>
            <p className="hero-description">
              Take a photo or choose an image to identify whether it shows a {scenes} scene.
            </p>
          </div>
          <span className="hero-aside">
            On-device analysis.
            <br />
            Nothing is uploaded.
          </span>
        </div>
        <ol className="workflow-steps" aria-label="Recognition steps">
          {['Choose a photo', 'Analyze on your device', 'See the scene'].map((label, index) => (
            <li
              key={label}
              className={
                index === currentStep ? 'is-current' : index < currentStep ? 'is-complete' : ''
              }
              aria-current={index === currentStep ? 'step' : undefined}
            >
              <span>{index < currentStep ? <Check size={13} /> : `0${index + 1}`}</span>
              {label}
            </li>
          ))}
        </ol>
        {flow.modelError && (
          <div className="model-error" role="alert">
            <AlertCircle size={21} />
            <div>
              <strong>The local model isn’t ready</strong>
              <p>{flow.modelError}</p>
            </div>
            <button className="button button-secondary" onClick={() => void flow.retryModel()}>
              Retry model
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
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
        <div className="below-workspace">
          <span>
            {flow.loadingModel ? (
              <>
                <LoaderCircle className="spin" size={13} />
                Preparing your local model…
              </>
            ) : flow.model ? (
              <>
                <span className="ready-dot" />
                Local model ready
              </>
            ) : (
              <>
                <AlertCircle size={13} />
                Local model unavailable
              </>
            )}
          </span>
          <p>Recognizes {scenes} scenes only.</p>
        </div>
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
