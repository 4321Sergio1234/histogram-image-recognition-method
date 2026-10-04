# Web application architecture

## 1. UI layers

The source uses Feature-Sliced Design with dependency direction:

```text
app → pages → widgets → features → entities → shared
```

`app` initializes providers, styles and the PWA. `pages/recognition` composes the screen.
Widgets combine the upload/camera workspace, result and analysis panel. Features implement
capture/upload, recognition, details and export actions. Entities define images, scene results and
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
