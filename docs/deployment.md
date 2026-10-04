# Production deployment

## 1. Release flow

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. Install pinned Node/pnpm dependencies and Ruff.
2. Check Python scripts and the committed model/manifest pair.
3. Run formatting, lint, typechecking, unit tests, build and desktop/mobile browser tests.
4. Verify the model copied into the built app.
5. On a `main` push only, run the production deployment job after **Quality checks** succeeds.
6. Verify project access, run `pnpm build:vercel` and verify its actual static model assets.
7. Upload that verified output using `vercel deploy --prebuilt --prod`.

A PR merge creates a push to `main`, so the same flow handles merges. PR checks do not use deployment
secrets. Configure branch protection to require the **Quality checks** job before merging.

Native Vercel Git deployments are disabled in `vercel.json`. This gives GitHub Actions control of
deployment and prevents a parallel deployment before checks finish. The workflow uses the pinned
Vercel CLI in `package.json`. The static PWA uses Vercel's
[Build Output API v3](https://vercel.com/docs/build-output-api) and
[prebuilt deployment](https://vercel.com/docs/cli/deploy#prebuilt), so CI does not need to pull
team settings or environment files. The app has no Vercel build-time environment variables.

## 2. GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret              | Value                                               |
| ------------------- | --------------------------------------------------- |
| `VERCEL_TOKEN`      | A Vercel access token scoped to this project        |
| `VERCEL_ORG_ID`     | The `orgId` in the local `.vercel/project.json`     |
| `VERCEL_PROJECT_ID` | The `projectId` in the local `.vercel/project.json` |

To link the project and find its IDs locally:

```bash
pnpm exec vercel login
pnpm exec vercel link
cat .vercel/project.json
```

Set the Vercel project root to the repository root. Install and build settings come from
`vercel.json`: frozen pnpm install, `pnpm build`, output `react-web-app/dist`. Use Node 24 in the
project settings as well. `.vercel/` and `.env*` are ignored and must not be committed.

The deployment job fails with the missing secret's name if any value is absent. Production
deployment cannot run until all three are configured. No token belongs in YAML, source code,
documentation or a checked-in environment file.

The current target is **horizon-scene-recognition**, owned by **4321sergio1234s-projects**:

| Setting             | Verified value                     |
| ------------------- | ---------------------------------- |
| `VERCEL_ORG_ID`     | `team_OKeZIcwUBPGBqTAFOqSB1ySf`    |
| `VERCEL_PROJECT_ID` | `prj_KhjJIfQrugInwDbJ9KODCDtSYALN` |

These are project identifiers, not credentials. Create a token scoped to
**horizon-scene-recognition** in its owning Hobby team and store only the token value in
`VERCEL_TOKEN`. The token does not need permission to read the team's metadata.

CI checks the project API using the same token and verifies that the project's ID and owner match
the configured IDs. It reports invalid credentials, denied project access or an unavailable project
separately, without printing secrets. A project-scoped token can access the project while the team
API returns 403. `vercel pull` also reads team metadata and can fail with **Could not retrieve
Project Settings** for that token; this workflow therefore builds the static output directly.

## 3. Model assets and payload

The deployed app must contain:

```text
models/scene-recognition/model.json
models/scene-recognition/manifest.json
```

The verifier rejects missing files, additional model directories, hash mismatch, stale export
metadata, incompatible dimensions and an unloadable network. It compares exact bytes with the
frozen training run before allowing deployment. The PWA precaches both files; model and service
worker HTTP headers require revalidation.

Training images are excluded from Vercel source uploads. `.vercelignore` allows only the three
small frozen model reference files required by build verification; other training records and
reports are excluded. With `--prebuilt`, deployment uploads compiled `.vercel/output`, not training
data or source collections. Training never runs in CI deployment.

`pnpm build:vercel` runs the normal verified PWA build, replaces `.vercel/output` with a fresh
copy of `react-web-app/dist` under `static/`, and writes the version 3 `config.json`. Routes come
from `vercel.json`, including model/service-worker revalidation headers. The packaging script
requires the app entry point, service worker and matching frozen model before producing output.
It does not modify the model or train a network.

To build and deploy the same payload locally after linking the project:

```bash
pnpm build:vercel
pnpm exec vercel deploy --prebuilt --prod --yes
```

## 4. Verify a release and roll back

The deployment URL appears in the GitHub Actions job summary. For an optional full browser check,
use the external diagnostic inputs and Chromium:

```bash
PREVIEW_URL=https://your-project.vercel.app pnpm verify:production
```

This checks online/offline model hashes and known class mappings. The app's Analysis details also
shows the active model version and hash. If a release is unsuitable, restore the prior production
deployment through the Vercel dashboard, or revert the relevant commit and merge the correction to
`main`. A reverted model change must restore its frozen reference and public assets together.
