# Web application architecture

## 1. UI layers

The source uses Feature-Sliced Design with dependency direction:

```text
app → pages → widgets → features → entities → shared
```

`app` initializes providers, styles and the PWA. `pages/recognition` composes the screen.
Widgets combine the upload/camera workspace, result and analysis panel. Features implement
capture/upload, recognition, analysis details, photo tips and export actions. Entities define images, scene results and
the recognition service contract. Shared modules contain engine code, image utilities and UI
primitives. `scripts/check-architecture.ts` checks layer and public API imports.

## 2. Recognition execution

The recognition hook coordinates image selection, stage progress, cancellation/reset, errors and
the session log. The service exposes initialization and recognition without coupling UI components
to Brain.js. The worker adapter transfers RGBA pixels to the worker, which computes the histogram,
quantization, binary features and ANN outputs. The main-thread fallback uses the same engine.

The active output order is **Sea, Forest, Desert**. Display labels come from validated metadata;
scores are ranked independently of their numeric position. UI tests and browser mapping checks
guard against swapping labels. Scores are uncalibrated model outputs.

The progress bar reports eight completed stages. Result timing covers preprocessing and inference,
not initial model download or React rendering. The session log records model initialization,
selection, recognition, reset and exports with status and elapsed time; it retains up to 200 entries
and supports a local JSON download.

## 3. Model loading and offline behavior

The app serves exactly one pair in `public/models/scene-recognition`. The engine validates the
manifest and hashes actual model bytes before loading the network. Metadata binds the task,
feature format, output catalog, architecture and model version. Analysis details exposes the
version, SHA-256, histogram and three scores.

`vite.config.ts` configures Workbox precaching, auto-update and the installable app manifest.
Build output includes the verified pair. Asset revisions invalidate changed weights automatically;
the user does not need a manual storage reset. Offline recognition works after a complete first
online load has cached the app and model. Deployments revalidate model and service-worker files.

## 4. Images and exports

Image input handles supported file signatures, dimensions and orientation before decoding pixels.
Camera capture creates a local image; uploads never go to an inference server. Export actions save
the original bytes, result JSON or an annotated PNG/JPEG/BMP image. JSON includes model metadata,
scores, histograms and execution timing; the session log contains operation metadata, not pixels.

Canonical palette and brightness constraints are described in the UI. There is no trained unknown
class or reliable out-of-domain detector; an unsupported photo may still receive a high score.

## 5. Components and slice APIs

Each slice exposes its supported imports through `index.ts`. Implementations live in purpose-based
segments, following the [FSD layer rules](https://feature-sliced.design/docs/reference/layers) and
[public API conventions](https://feature-sliced.design/docs/reference/public-api):

```text
features/capture-image/
  index.ts                    # Public CaptureImage component
  config/copy.ts              # Camera labels, guidance and errors
  model/use-camera.ts         # Permission, stream and capture lifecycle
  ui/capture-image.tsx        # Camera controls and dialog

features/view-analysis-details/
  index.ts
  model/quality.ts            # Recorded test cohort and confusion calculations
  ui/analysis-details.tsx     # Dialog composition
  ui/histogram-analysis.tsx
  ui/network-outputs.tsx
  ui/processing-times.tsx
  ui/recognition-method.tsx
  ui/model-reliability.tsx
  ui/model-metadata.tsx
```

Workspace components own the dropzone, selected photo, stage progress and actions. The recognition
page composes these widgets, feature dialogs, its hero, workflow steps and model status. Photo
guidance belongs to the scene entity so both the side panel and tips dialog use the same guidance.
The histogram belongs to the image-analysis entity, and the confidence meter belongs to the result
entity. Neither entity imports another slice at its own layer.

Shared UI components contain reusable presentation: `Button`, `IconButton`, `Dialog`,
`DefinitionList`, `DetailsSection`, `InstructionList` and `ValueTrack`. They accept data and content
through props. Shared display formatters handle percentages, measured durations, dimensions and
file sizes. Recognition thresholds, metric selection and scene labels remain in their owning
slices or the validated model.

The operation-log store lives in `shared/lib/session-log.tsx`. Its presentation is the
`widgets/session-log` slice and its download action is `features/export-session-log`. App-level
provider composition mounts the service, log and toast providers independently; a toast provider
does not implicitly create a log store.

## 6. UI copy

Keep static visible text and accessible labels in a module-level `COPY` constant beside a small
component. When a feature's hook and view share messages, keep them in that slice's `config/copy.ts`
and import the named constant. Arrays of instructions and export choices carry their labels as
data. Dynamic model names and errors supplied by the service remain data, rather than duplicated
display strings.

```tsx
import { Button } from '@/shared/ui';

const COPY = { analyze: 'Analyze image' } as const;

export function AnalyzeAction({ onAnalyze }: { onAnalyze: () => void }) {
  return <Button onClick={onAnalyze}>{COPY.analyze}</Button>;
}
```

Use named copy formatters for sentences containing counts or model values. Preserve whitespace
between adjacent inline elements explicitly where needed. Decorative images may use an empty
`alt`; meaningful alternative text comes from copy constants or props.

`pnpm lint` enforces the `horizon/ui-copy` ESLint rule on application TSX. It rejects literal JSX
text, visible text attributes, and direct conditional/template text expressions. Structural values
such as CSS classes, URLs, input types and test IDs remain ordinary literals. Dedicated rule tests
cover both prohibited copy and permitted structural values. The existing architecture check
continues to reject upward dependencies, same-layer slice imports and private slice imports.
