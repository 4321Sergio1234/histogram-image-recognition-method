# Web development

## 1. Run and build

Install workspace dependencies from `repo/`; do not install a separate package lock here.

```bash
pnpm dev
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

The production output is `react-web-app/dist`. The development server supports UI iteration;
use a built preview to test the service worker and offline behavior. No raw dataset download or
training is needed to build the app. The frozen model reference is required by build verification.

## 2. Check a change

```bash
pnpm format
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm check` runs the same sequence except the formatting write step. Tests cover image handling,
worker/main-thread equivalence, model validation, UI state, camera mocks and exports. Browser
tests run on desktop Chrome and a mobile viewport, including offline recognition and model cache
checks. Physical cameras, Safari/Firefox and full screen-reader use require separate verification.

Keep imports within layer boundaries and use each slice's public API. Keep the service contract
independent of visual components. Meaningful user operations should update the session log and
actual progress or timing; avoid elapsed-time-driven progress percentages.

## 3. Update model assets

```bash
pnpm ml evaluate --out brain-js/artifacts/new-run
pnpm ml sync --out brain-js/artifacts/new-run
pnpm verify:model
pnpm check
```

Update the frozen reference and release expectations as described in the
[training guide](../../brain-js/docs/training.md). Do not copy only weights or only a manifest.
Do not hand-edit either file. The verifier must pass for public assets and the built output.

For a browser hash/class check after starting a preview:

```bash
PREVIEW_URL=http://127.0.0.1:4173 pnpm verify:production
```

That diagnostic uses known images from the committed training set and writes external report
evidence. It tests serving and mapping, not generalization accuracy.

## 4. Useful inspection points

- **Analysis details:** active model version/hash, preprocessing, source/split metadata and outputs.
- **Session log:** operation success/failure, duration and a downloadable JSON log.
- **Network panel:** the single model/manifest pair, with no image upload request.
- **Application panel:** installed service worker and Workbox cache entries.
- **Download actions:** original file, result JSON and annotated image formats.

Deployment configuration lives at the workspace root; follow the
[deployment guide](../../docs/deployment.md) to set GitHub secrets and release from `main`.
