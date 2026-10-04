# Horizon

Horizon recognizes **Sea, Forest and Desert** entirely in the browser using brightness histograms, 1024 binary features and Brain.js. Training is a separate Node CLI. The app supports camera capture and upload, progress and execution time, histogram inspection, original/result/annotated-image exports and a downloadable session log. Photos stay on-device.

## Documentation

- [Workspace architecture and operations](docs/README.md)
- [Training package and CLI](brain-js/docs/README.md)
- [Web application development](react-web-app/docs/README.md)
- [GitHub Actions and Vercel deployment](docs/deployment.md)

## Run the app

Use Node **24.19.0** (`.nvmrc`) and pnpm **10.34.5** (packageManager).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
pnpm check
```

The exported model is already committed. App builds do not train or require raw docs collections. Native GPU install scripts are disabled; the CPU/browser Brain.js bundle is used.

## Current model and data

Model **6.1.0**, **1024 → 16 → 3**, LR **0.1**, saved epoch **56** of 60. SHA `5e4dbd351c39ba21ef3d0afc7d86940373a22ece361b4c421d7ce72275cd5235`.

| Split      | Sea | Forest | Desert | Total |
| ---------- | --: | -----: | -----: | ----: |
| train      | 765 |   1407 |    108 |  2280 |
| validation | 303 |    473 |    103 |   879 |
| test       | 350 |    651 |     85 |  1086 |

| Split      | Correct / total | Accuracy | Macro-F1 |
| ---------- | --------------: | -------: | -------: |
| Train      |       2276/2280 |   99.82% |   0.9987 |
| Validation |         831/879 |   94.54% |   0.9078 |
| Test       |       1051/1086 |   96.78% |   0.9263 |

The committed native originals are in [brain-js/data/scenes-curated-v2](brain-js/data/scenes-curated-v2/README.md); its manifest freezes hashes/groups/membership. Data are grouped by extension and actual native resolution, without upscaling. All 2280 training images are used; no reserve. Model run/config/checkpoints/log are in `brain-js/artifacts/curated-v2`; the browser serves one verified model/manifest pair in `react-web-app/public/models/scene-recognition`.

## Separate training CLI

```sh
pnpm ml --help
pnpm ml inspect
pnpm train --epochs 60 --rates 0.03,0.1,0.3 --hidden 0,16,32 --out brain-js/artifacts/my-run
pnpm ml train --folder train/jpg/small --folder train/jpeg/medium --epochs 40 --learning-rate 0.1 --out brain-js/artifacts/folder-run
pnpm ml evaluate --out brain-js/artifacts/my-run
pnpm ml sync --out brain-js/artifacts/my-run
pnpm ml review --out brain-js/artifacts/my-run
pnpm benchmark:training --hidden 0 --sizes 300,600,all
```

Epochs, LR, seed, normalization, train folders/limit and output version are runtime options. Invalid values, holdout training folders or missing classes are rejected. New runs need a new output directory; frozen runs are not overwritten. Every actual completed image/epoch is recorded with elapsed time in `operations.jsonl`; TTY also has a progress bar. Training/evaluation read copied originals and recheck eligibility, not old cached features. Selection uses validation macro-F1; test runs after selection is frozen.

`pnpm prepare:dataset` verifies the committed dataset if present. Rebuilding a new data directory requires the original collections under sibling `docs/` and frozen provenance. All raw folders were inventoried; unlabeled prediction files, TFRecords duplicates, report figures and external diagnostic photos were not added to training.

## Cleaning and limitations

The same palette and training-only brightness-centroid criterion applies in train, validation and test. Curation uses known labels and canonical HSV palettes; ANN input is brightness alone. Manual exclusions, separate reinspection and confirmed artifacts remain applied. Source groups keep previous holdouts; no validation/test image enters training. Added-source palette screening is automatic, not an exhaustive manual review.

**The test score is conditional**, on reused inspected photos selected for separable brightness distributions. A nearest-centroid classifier is correct on admitted photos by construction. The ANN score does not measure arbitrary-photo recognition. Desert has only 108 training groups; recall on its 85 test images is 71.76%. Source confounding remains. The unchanged broad sanity set is 14/34; Sahara still predicts Sea at 99.78%. No failure was hidden or added to training.

## Deployment on main

GitHub Actions checks pull requests and pushes to `main`. After **Quality checks** passes on a main push, the deployment job builds and verifies Vercel's static output, then deploys it with the pinned CLI. Native Vercel Git deployments are disabled to prevent duplicate releases before checks finish. Training never runs during deployment.

Add `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` as GitHub Actions secrets. Set branch protection to require **Quality checks** before merging. The [deployment guide](docs/deployment.md) explains project linking, secrets, model checks and rollback. Production deployment requires those secrets to be configured.

## Architecture and verification

Feature-Sliced Design: shared → entities → features → widgets → pages → app; imports checked by lint. UI depends on `SceneRecognitionService`. A Web Worker receives a transferable RGBA buffer, computes histogram/encoding/ANN and returns results; the main-thread fallback uses the same core. Actual inference time is shown, excluding model download and React rendering.

```text
RGB → round(0.299R + 0.587G + 0.114B) → 256 bins
→ round(15 × sqrt(bin / max)) → 4 bits/bin, MSB-first
→ 1024 binary inputs → 3 sigmoid outputs: Sea/Forest/Desert
```

`pnpm parity:preprocessing` verifies all 879 validation images independently in Node and Chromium. `pnpm verify:production` verifies actual online/offline hashes and class mapping (set PREVIEW_URL for a hosted app). `pnpm benchmark` records native-resolution runtime/heartbeat measurements. `pnpm review:model` retains source counts, errors and external negative results.

Prettier and ESLint check source formatting and code; Ruff checks Python diagnostics. Run `pnpm format` to apply formatting and `pnpm lint` to verify it. Frozen weights and dataset/run records retain their original bytes for integrity checks.

Operating guides are committed in the three package documentation folders. Academic reports and diagnostic images remain in the **external sibling docs/** hierarchy. Lab1–Lab4 are Markdown with numbered contents; print pagination is added during Google Docs export. Historical datasets are archived outside the repository. Physical phones, Safari/Firefox, exhaustive crop detection and full screen-reader testing are not verified.
