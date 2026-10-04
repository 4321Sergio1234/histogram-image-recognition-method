# Production deployment

## 1. Release flow

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. Install pinned Node/pnpm dependencies and Ruff.
2. Check Python scripts and the committed model/manifest pair.
3. Run formatting, lint, typechecking, unit tests, build and desktop/mobile browser tests.
4. Verify the model copied into the built app.
5. On a `main` push only, run the production deployment job after **Quality checks** succeeds.
6. Pull Vercel project settings, build Vercel output and verify its actual static model assets.
7. Upload that verified output using `vercel deploy --prebuilt --prod`.

A PR merge creates a push to `main`, so the same flow handles merges. PR checks do not use deployment
secrets. Configure branch protection to require the **Quality checks** job before merging.

Native Vercel Git deployments are disabled in `vercel.json`. This gives GitHub Actions control of
deployment and prevents a parallel deployment before checks finish. The workflow uses the pinned
Vercel CLI in `package.json`. See [Vercel's GitHub Actions guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).

## 2. GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret              | Value                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `VERCEL_TOKEN`      | A Vercel access token with access to the project and owning team |
| `VERCEL_ORG_ID`     | The `orgId` in the local `.vercel/project.json`                  |
| `VERCEL_PROJECT_ID` | The `projectId` in the local `.vercel/project.json`              |

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

These are project identifiers, not credentials. A token scoped to another team cannot deploy this
project even when both IDs are correct. Create the deployment token with access to the owning team
and store only the token value in `VERCEL_TOKEN`.

Before pulling settings, CI checks team and project access directly using the same token. It reports
invalid credentials, denied access or an unavailable project separately, without printing secrets.
If `vercel pull` reports **Could not retrieve Project Settings**, check token permissions and both
IDs first. The runner already starts with no committed `.vercel` directory; removing a local cache
does not grant access to a different team.

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
