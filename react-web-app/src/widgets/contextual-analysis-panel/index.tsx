import {
  ArrowUpRight,
  Compass,
  Focus,
  LoaderCircle,
  ShieldCheck,
  SunMedium,
  UserX,
} from 'lucide-react';
import type { ModelManifest } from '@horizon/brain/core';
import type { RecognitionResult } from '@/entities/recognition-result';
import { SceneIcon, sceneList } from '@/entities/scene';
import { Dialog } from '@/shared/ui';

export function ContextualPanel({
  model,
  loading,
  onDetails,
  onTips,
}: {
  model: ModelManifest | null;
  loading: boolean;
  onDetails: () => void;
  onTips: () => void;
}) {
  const scenes = model?.classes ?? [];
  return (
    <aside className="context-panel" aria-label="Photo guidance">
      <div className="context-guide">
        <span className="section-label">WHAT WORKS BEST</span>
        <h2>
          The whole view.
          <br />
          Not the details.
        </h2>
        <div className="photo-tips">
          <div>
            <span>
              <Focus size={19} />
            </span>
            <p>
              <strong>Show the whole scene</strong>Step back so water, trees or dunes fill most of
              the frame.
            </p>
          </div>
          <div>
            <span>
              <SunMedium size={19} />
            </span>
            <p>
              <strong>Use daylight</strong>Natural light works best. Night shots and heavy filters
              change the brightness.
            </p>
          </div>
          <div>
            <span>
              <UserX size={19} />
            </span>
            <p>
              <strong>Avoid close-ups</strong>People, objects or text in front of the view can
              change the result.
            </p>
          </div>
        </div>
      </div>
      <button className="button button-secondary mobile-tips-button" onClick={onTips}>
        <Focus size={17} />
        Tips for a better photo
        <ArrowUpRight size={16} />
      </button>
      <div className="catalog">
        <div className="catalog-heading">
          <Compass size={16} />
          <span>Supported scenes</span>
        </div>
        {loading ? (
          <p className="catalog-loading">
            <LoaderCircle size={15} className="spin" />
            Loading supported scenes…
          </p>
        ) : scenes.length ? (
          <>
            <div className="catalog-items">
              {scenes.map((scene) => (
                <span key={scene.id}>
                  <SceneIcon id={scene.id} size={13} />
                  {scene.displayName}
                </span>
              ))}
            </div>
            <p>
              {scenes.length} scene types. Cities, rooms, people and other scenes are not
              recognized.
            </p>
          </>
        ) : (
          <p>The supported scene list will appear when the local model is ready.</p>
        )}
        {model?.domain && (
          <p>
            <strong>Palette scope:</strong>{' '}
            {model.domain.palettes.map((item) => item.description).join('; ')}. Other palettes may
            be misclassified.
          </p>
        )}
        <button className="text-link" onClick={onDetails}>
          About this recognition
          <ArrowUpRight size={14} />
        </button>
      </div>
    </aside>
  );
}

export function PhotoTips({
  open,
  onClose,
  model,
}: {
  open: boolean;
  onClose: () => void;
  model?: ModelManifest | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="A clearer view"
      description="A few small changes can help the model."
    >
      {model?.domain && <p>{model.domain.description}</p>}
      <ol className="method-steps">
        <li>
          <strong>Show the whole scene</strong>
          <p>
            The model looks at the brightness of the entire photo. Step back so the sea, forest or
            desert fills most of the frame.
          </p>
        </li>
        <li>
          <strong>Use daylight</strong>
          <p>
            Soft, natural light works best. Night shots, flash and strong filters change the
            brightness pattern. Color is not measured: blue water and warm sand can still have
            similar brightness histograms.
          </p>
        </li>
        <li>
          <strong>Avoid close-ups</strong>
          <p>Keep people, vehicles, signs and other objects out of the foreground where you can.</p>
        </li>
      </ol>
    </Dialog>
  );
}

function Histogram({
  values,
  max,
  label,
  caption,
  tone,
}: {
  values: number[];
  max: number;
  label: string;
  caption: string;
  tone: string;
}) {
  return (
    <figure className="histogram">
      <svg viewBox="0 0 512 112" role="img" aria-label={label}>
        {values.map((value, index) => (
          <rect
            key={index}
            x={index * 2}
            y={104 - (value / max) * 100}
            width="1.7"
            height={Math.max(0.2, (value / max) * 100)}
            fill={tone}
          />
        ))}
        <line x1="0" y1="105" x2="512" y2="105" stroke="#d3d9cb" />
      </svg>
      <figcaption>
        <span>0 · Dark</span>
        <span>{caption}</span>
        <span>Light · 255</span>
      </figcaption>
    </figure>
  );
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/** The pair of scenes most often mistaken for each other in the held-out test confusion matrix. */
function mostConfused(model: ModelManifest) {
  const matrix = model.testMetrics.confusionMatrix;
  let best = { names: ['', ''], count: 0 };
  for (let a = 0; a < matrix.length; a++) {
    for (let b = a + 1; b < matrix.length; b++) {
      const count = matrix[a][b] + matrix[b][a];
      if (count > best.count) {
        best = { names: [model.classes[a].displayName, model.classes[b].displayName], count };
      }
    }
  }
  return best;
}

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
  const test = qualityModel?.testMetrics;
  const histogramFiltered =
    qualityModel?.domain?.id === 'geoscene-strict-histogram-v1' ||
    qualityModel?.domain?.id === 'curated-histogram-v2';
  const correctTestImages =
    test?.confusionMatrix.reduce((total, row, index) => total + row[index], 0) ?? 0;
  const scenes = qualityModel
    ? sceneList(
        qualityModel.classes.map((label) => label.displayName),
        'or',
      )
    : 'the supported';
  const confused = qualityModel ? mostConfused(qualityModel) : null;
  const timings = result
    ? ([
        ['Image decode', result.timings.decodeMs],
        ['Pixel extraction', result.timings.pixelsMs],
        ['Histogram & 4-bit encoding', result.timings.featuresMs],
        [
          'Preprocessing total',
          result.timings.decodeMs + result.timings.pixelsMs + result.timings.featuresMs,
        ],
        ['Neural network', result.timings.inferenceMs],
        ['Total analysis', result.timings.totalMs],
      ] as const)
    : [];
  const outputs = result
    ? result.model.classes.map((label) => ({
        label,
        score: result.predictions.find((item) => item.label.id === label.id)?.score ?? 0,
      }))
    : [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={result ? 'Analysis details' : 'How it works'}
      description={
        result
          ? 'The brightness pattern behind this result.'
          : 'A local model. A simple idea. A clear limit.'
      }
      className="analysis-dialog"
    >
      {result ? (
        <>
          <section className="details-section">
            <h3>Brightness histogram</h3>
            <Histogram
              values={result.histogram}
              max={Math.max(1, ...result.histogram)}
              label="Original 256-bin brightness histogram, from dark to light"
              caption="Pixel counts · 256 bins"
              tone="#52745c"
            />
            <Histogram
              values={result.quantized}
              max={15}
              label="Quantized histogram, each bin scaled to 0–15"
              caption="Quantized 0–15 · 4 bits each"
              tone="#2f6f86"
            />
            <div className="technical-pills">
              <span>256 bins</span>
              <span>4 bits per bin</span>
              <span>1,024 input values</span>
            </div>
            <p className="fine-print">
              Each pixel’s brightness is Y′ = 0.299R + 0.587G + 0.114B. Bin counts are scaled to the
              largest bin
              {result.model.preprocessingVersion === 'luma-round-sqrtmax15-msb-v2'
                ? ' using a square-root mapping'
                : ''}
              , rounded to 0–15 and encoded as four binary values each.
            </p>
          </section>
          <section className="details-section">
            <h3>Neural network outputs</h3>
            <ol className="prediction-list scene-outputs">
              {outputs.map((item) => (
                <li
                  key={item.label.id}
                  className={item.label.id === result.prediction.label.id ? 'is-top' : ''}
                >
                  <span>
                    <SceneIcon id={item.label.id} size={15} />
                    {item.label.displayName}
                  </span>
                  <span className="output-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(0, Math.min(100, item.score * 100))}%` }} />
                  </span>
                  <strong>{percent(item.score)}</strong>
                </li>
              ))}
            </ol>
            <p className="fine-print">
              One sigmoid output per supported scene, in model order. These are independent model
              scores, not calibrated probabilities, and do not need to add up to 100%. A result is
              marked uncertain when the top score is below{' '}
              {(result.model.uncertainty.minScore * 100).toFixed(0)}% or leads the runner-up by less
              than {(result.model.uncertainty.minMargin * 100).toFixed(0)} points.
            </p>
          </section>
          <section className="details-section">
            <h3>Processing time</h3>
            <table className="timings-table">
              <caption className="visually-hidden">Recognition timing in milliseconds</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {timings.map(([name, value]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{value.toFixed(2)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine-print">
              {result.execution === 'worker'
                ? 'Histogram and neural network computed in a Web Worker.'
                : 'Computed on the main thread using the browser fallback.'}{' '}
              Total includes pipeline overhead; downloading the model and rendering the interface
              are excluded.
            </p>
          </section>
        </>
      ) : (
        <>
          <div className="local-callout">
            <ShieldCheck size={24} />
            <p>
              <strong>Made to stay on your device.</strong>Your photo is processed in your browser.
              No account, image uploads, or tracking.
            </p>
          </div>
          <ol className="method-steps">
            <li>
              <strong>A photo becomes a brightness pattern</strong>
              <p>
                Horizon counts how many pixels fall on each of 256 brightness levels across the
                whole photo.
              </p>
            </li>
            <li>
              <strong>The pattern becomes a compact input</strong>
              <p>
                Each count is scaled to 0–15 and written as four bits, giving 1,024 input values.
              </p>
            </li>
            <li>
              <strong>A small neural network names the scene</strong>
              <p>A locally trained Brain.js network compares the pattern with {scenes} scenes.</p>
            </li>
          </ol>
        </>
      )}
      {qualityModel && test && (
        <section className="details-section model-quality" aria-label="Model reliability">
          <h3>How reliable is this?</h3>
          <p>
            <strong>
              {correctTestImages} of {test.total}{' '}
              {histogramFiltered
                ? 'histogram-filtered'
                : qualityModel.domain
                  ? 'palette-selected'
                  : 'dataset'}{' '}
              test photos
            </strong>{' '}
            were identified correctly ({percent(test.accuracy)}). Recall by scene:{' '}
            {test.perClass
              .map(
                (item, index) =>
                  `${qualityModel.classes[index]?.displayName ?? item.id} ${percent(item.recall)}`,
              )
              .join(' · ')}
            .
          </p>
          {qualityModel.domain && (
            <p>
              These selected {histogramFiltered ? 'histogram patterns' : 'palettes'} cover{' '}
              {percent(qualityModel.domain.paletteTestCoverage)} of the{' '}
              {qualityModel.domain.id === 'curated-histogram-v2'
                ? 'candidate test groups after manual exclusions'
                : 'original test partition'}
              .{' '}
              {qualityModel.domain.populationTestMetrics && (
                <>
                  Across all {qualityModel.domain.populationTestMetrics.total} test photos, accuracy
                  was {percent(qualityModel.domain.populationTestMetrics.accuracy)}.
                </>
              )}{' '}
              {histogramFiltered && (
                <>
                  Training, validation and test use the same palette and histogram rule. Test
                  examples by scene:{' '}
                  {test.perClass
                    .map(
                      (item, index) => `${qualityModel.classes[index].displayName} ${item.count}`,
                    )
                    .join(' · ')}
                  . Class imbalance and reused source photos limit this evidence.
                </>
              )}
            </p>
          )}
          <p>
            A high confidence can still be wrong.{' '}
            {confused &&
              confused.count > 0 &&
              `${confused.names.join(' and ')} photos are mistaken for each other most often (${confused.count} test photos).`}
          </p>
          <p className="fine-print">
            Related source photos and differences between datasets can make this score optimistic.
            Performance on independent photos may be lower.
          </p>
        </section>
      )}
      {qualityModel?.domain && (
        <section className="details-section">
          <h3>Trained palette scope</h3>
          <p>{qualityModel.domain.description}</p>
          <p className="fine-print">{qualityModel.domain.sourceCaveat}</p>
        </section>
      )}
      <div className="callout limitation-callout">
        <strong>A useful clue, with limits</strong>
        <p>
          Brightness alone cannot capture color, shape or where things appear in the frame. Blue
          water and warm sand can share a similar brightness pattern; changing the lighting or
          palette can change the result. The model always chooses one of {scenes} — even for a city,
          a room or a person — so a result for any other kind of photo is not meaningful.
        </p>
      </div>
      {qualityModel && (
        <section className="details-section model-details">
          <h3>About the local model</h3>
          <dl className="definition-list">
            <div>
              <dt>Version</dt>
              <dd>{qualityModel.version}</dd>
            </div>
            <div>
              <dt>Model SHA-256</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{qualityModel.modelSha256}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>Zawyalow brightness histogram</dd>
            </div>
            <div>
              <dt>Preprocessing</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{qualityModel.preprocessingVersion}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{qualityModel.network.architecture} · sigmoid</dd>
            </div>
            <div>
              <dt>Training / validation / test images</dt>
              <dd>
                {qualityModel.sampleCounts.train} / {qualityModel.sampleCounts.validation} /{' '}
                {qualityModel.sampleCounts.test}
              </dd>
            </div>
            <div>
              <dt>Saved training epoch / learning rate</dt>
              <dd>
                {qualityModel.network.iterations} / {qualityModel.network.learningRate}
              </dd>
            </div>
            <div>
              <dt>Supported scenes</dt>
              <dd>{qualityModel.classes.map((label) => label.displayName).join(', ')}</dd>
            </div>
            <div>
              <dt>Feature inputs</dt>
              <dd>{qualityModel.featureLength.toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                {histogramFiltered
                  ? 'Clean test accuracy'
                  : qualityModel.domain
                    ? 'Palette test accuracy'
                    : 'Test accuracy'}
              </dt>
              <dd>
                {percent(qualityModel.testMetrics.accuracy)} ·{' '}
                {qualityModel.testMetrics.total.toLocaleString()}{' '}
                {histogramFiltered
                  ? 'histogram-filtered'
                  : qualityModel.domain
                    ? 'palette-selected'
                    : 'dataset'}{' '}
                test images
              </dd>
            </div>
            <div>
              <dt>Macro-F1</dt>
              <dd>{qualityModel.testMetrics.macroF1.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Validation accuracy</dt>
              <dd>{percent(qualityModel.validationMetrics.accuracy)}</dd>
            </div>
            <div>
              <dt>Library</dt>
              <dd>Brain.js {qualityModel.brainVersion}</dd>
            </div>
          </dl>
          <p className="fine-print">
            Datasets:{' '}
            {qualityModel.datasets
              .map((dataset) => `${dataset.name} (${dataset.selectedClasses.join(', ')})`)
              .join('; ')}
            . Training and validation: {qualityModel.split.trainSource}; final test:{' '}
            {qualityModel.split.testSource}. Test accuracy describes these datasets, not a guarantee
            for your photo.
          </p>
        </section>
      )}
    </Dialog>
  );
}
