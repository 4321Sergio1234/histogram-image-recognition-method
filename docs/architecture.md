# Workspace architecture

## 1. Packages and ownership

| Path                                            | Responsibility                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `brain-js/src/core`                             | Shared contracts, scene order, manifest validation and prediction ranking |
| `brain-js/src/features`                         | The brightness histogram, quantization and 1024-bit encoding              |
| `brain-js/src/image`                            | Node image decoding for training and diagnostics                          |
| `brain-js/src/dataset`                          | Audit, grouping, physical dataset checks and folder selection             |
| `brain-js/src/cli`                              | Separate training, evaluation, synchronization and operation logs         |
| `brain-js/data/scenes-curated-v2`               | The one active dataset, with original images and provenance               |
| `brain-js/artifacts/curated-v2`                 | The frozen training run and model export                                  |
| `react-web-app/src`                             | Browser application and worker execution                                  |
| `react-web-app/public/models/scene-recognition` | The single model/manifest pair served by the app                          |
| `scripts`                                       | Verification, benchmarks and historical diagnostics                       |
| `e2e`                                           | Desktop and mobile browser tests                                          |

Training is not a browser feature. The deployment build consumes committed weights; it never
trains, chooses a checkpoint or reads original source collections.

## 2. Classification data flow

```text
Decoded RGBA pixels, composited on white when needed
  → round(0.299 R + 0.587 G + 0.114 B)
  → global 256-bin brightness histogram
  → round(15 × sqrt(bin / largest bin))
  → four bits per bin, most significant bit first
  → 1024 ANN inputs
  → Brain.js sigmoid outputs, in order: Sea, Forest, Desert
```

The active normalization is `sqrt-max15`; the CLI also supports the historical `max15` baseline.
Color is used to curate the dataset, not as an ANN feature. Scores are uncalibrated and do not
detect unsupported scenes or unusual palettes.

## 3. Training and serving contract

The physical dataset manifest records image hashes, source-photo groups, split membership and
eligibility rules. The CLI checks actual image bytes, freezes training folder selections and
selects checkpoints using validation macro-F1. Test inference happens after selection is frozen.

`pnpm ml sync` copies an evaluated model and its manifest into public assets. The manifest records
the model hash, output order, feature format, architecture, source datasets and evaluation counts.
`pnpm verify:model` compares the served files with the selected weights and frozen export,
validates metadata, checks network dimensions and loads the network for an inference probe.
The same command accepts a built static directory through `--dir`.

Model JSON, frozen manifests and run records are intentionally excluded from automatic formatting:
their exact bytes participate in integrity checks. Application source and configuration files use
Prettier, ESLint and EditorConfig. Diagnostic Python scripts use Ruff.

## 4. Browser execution

The UI depends on `SceneRecognitionService`, which loads verified model assets and delegates
pixel processing to a Web Worker. A transferable buffer avoids an extra pixel copy. If workers
are unavailable, the same processing core runs on the main thread. Progress follows completed
stages; execution time measures preprocessing and inference.

The PWA precaches the app and model pair. Workbox revisions change when model bytes change, and
the model loader verifies SHA-256 before constructing the network. Photos stay in the browser;
exports and the downloadable session log are created locally.

UI slices expose public `index.ts` files and separate rendering, state and shared copy into
`ui`, `model` and `config` segments. Reusable controls live in `shared/ui`, while image/scene/result
presentation stays with its entity. The analysis dialog composes independent histogram, output,
timing, reliability and metadata components. ESLint checks component copy constants alongside the
FSD import check. See the [web architecture guide](../react-web-app/docs/architecture.md) for
ownership, provider composition and examples.

## 5. Limits of the active dataset

The cleaned test set measures the admitted canonical-palette and brightness domain. It has been
inspected and reused in earlier experiments. Class-specific eligibility uses known labels, so the
score is not an unbiased estimate for arbitrary photos. Desert remains underrepresented and
source confounding is not eliminated. See the [training guide](../brain-js/docs/training.md) for
counts and the separate broad sanity-set results.
