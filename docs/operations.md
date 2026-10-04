# Workspace operations

## 1. Install

Use Node 24.19.0 and pnpm 10.34.5. Run these commands from the repository root:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
python3 -m pip install -r requirements-dev.txt
```

On Linux, browser dependencies can be installed with
`pnpm exec playwright install --with-deps chromium`. Python 3.12 or newer and Ruff are required
only for checking or formatting diagnostic Python scripts. The browser app and training CLI
run on Node. Native GPU install scripts are disabled; Brain.js uses its CPU/browser bundle.

## 2. Daily commands

| Command                                      | Purpose                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                                   | Start the web development server                                          |
| `pnpm build`                                 | Verify model assets, typecheck, build the PWA and verify the copied model |
| `pnpm preview --host 127.0.0.1 --port 4173`  | Serve the built PWA locally                                               |
| `pnpm format`                                | Format supported source, config and documentation files                   |
| `pnpm format:check`                          | Fail if those files need formatting                                       |
| `pnpm lint`                                  | Formatting, ESLint and Feature-Sliced Design import checks                |
| `pnpm format:python`                         | Format diagnostic Python scripts                                          |
| `pnpm lint:python`                           | Check Python lint and formatting                                          |
| `pnpm typecheck`                             | Check all packages and workspace scripts                                  |
| `pnpm test`                                  | Run unit and integration tests, including dataset integrity               |
| `pnpm test:e2e`                              | Run desktop/mobile browser tests against the built PWA                    |
| `pnpm check`                                 | Run lint, unit tests, build and browser tests in sequence                 |
| `pnpm verify:model`                          | Verify public model files against the frozen run                          |
| `pnpm verify:model --dir react-web-app/dist` | Verify the model in production build output                               |

`pnpm check` requires the committed dataset, model artifacts and Chromium. Python checks are a
separate CI step; locally, run `pnpm lint:python` alongside it. A build is required before running
browser tests directly. Check `.prettierignore` before extending formatting to frozen data.

## 3. Model operations

```bash
pnpm ml --help
pnpm ml inspect
pnpm train --epochs 60 --learning-rate 0.1 --hidden 16 --out brain-js/artifacts/new-run
pnpm ml evaluate --out brain-js/artifacts/new-run
pnpm ml sync --out brain-js/artifacts/new-run
pnpm verify:model
pnpm check
```

New experiment directories are ignored by Git. Promoting a new run also requires updating the
frozen reference directory used by `scripts/check-model.ts`, the artifact allowlist in `.gitignore`
and `.vercelignore`, and version-specific regression expectations. Commit the evaluated run and
the synchronized public pair together. Do not edit serialized weights or manifests manually.

See [training operations](../brain-js/docs/training.md) for all options and the dataset workflow.

## 4. Diagnostic commands

| Command                                                  | Inputs and output                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm diagnose:features`                                 | Verifies the active dataset and lists counts/selectable folders                            |
| `pnpm parity:preprocessing`                              | Compares Node and Chromium features on active validation images                            |
| `pnpm verify:production`                                 | Checks online/offline hashes and UI class mapping; set `PREVIEW_URL`                       |
| `pnpm benchmark`                                         | Measures browser preprocessing/inference at native image sizes                             |
| `pnpm benchmark:training --hidden 0 --sizes 300,600,all` | Compares training size and learning rate using the same validation set                     |
| `pnpm review:model`                                      | Writes model errors, source counts and broad external checks                               |
| `pnpm screenshots`                                       | Captures app states for the external reports                                               |
| `pnpm prepare:dataset`                                   | Checks the active materialized dataset; a new destination rebuilds from source collections |

Report-producing commands write to the external sibling `../docs/` hierarchy. Runtime benchmarks,
screenshots and external model review require their recorded photos there; they are not CI inputs.
Historical `:palette` and `:clean` package commands and other investigation scripts reproduce older
experiments and require archived data. They are not part of the current training or release path.

## 5. Troubleshooting

- **Model checksum or export mismatch:** evaluate and sync the intended run; verify that public
  files and the frozen reference belong to the same version. Do not bypass the check.
- **Dataset integrity failure:** restore the recorded original file or investigate the manifest.
  New images belong in a new materialized dataset, not an existing frozen split.
- **Frozen run already exists:** choose a different `--out`. Training will not overwrite a selection.
- **Missing browser executable:** run the Playwright installation command above.
- **Preview port busy:** stop the previous preview or choose a different port. The browser test
  configuration uses 4173 and refuses to reuse a server in CI.
- **Offline app serves an old model:** verify the current build and service worker using
  `PREVIEW_URL=http://127.0.0.1:4173 pnpm verify:production` after starting the preview.
