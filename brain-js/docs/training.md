# Training operations

## 1. Active dataset and results

Model **6.1.0** uses `scenes-curated-v2` and architecture **1024 → 16 → 3**. Its learning rate is
**0.1**, with checkpoint **56** selected from **60** completed epochs.

| Split      | Sea | Forest | Desert | Total |
| ---------- | --: | -----: | -----: | ----: |
| Train      | 765 |   1407 |    108 |  2280 |
| Validation | 303 |    473 |    103 |   879 |
| Test       | 350 |    651 |     85 |  1086 |

The cleaned test result is **1051/1086**, accuracy **96.78%**, macro-F1 **0.9263**. This is a
conditional result on reused, inspected photos admitted by the curation rule. It does not establish
arbitrary-photo recognition: the unchanged broad sanity set is **14/34**, and the Sahara example
still predicts Sea at **99.78%**. Desert test recall is **71.76%**. Class imbalance and source
confounding remain. These limitations are preserved in the model manifest and external reports.

The [dataset protocol](../data/scenes-curated-v2/protocol.md) and
[source attribution](../data/scenes-curated-v2/SOURCES.md) explain admission and provenance.

## 2. Train a new run

Run commands from `repo/`. Paths are relative to that root, including package script invocations.

```bash
pnpm ml --help
pnpm ml inspect
pnpm train --epochs 60 --rates 0.03,0.1,0.3 --hidden 0,16,32 --out brain-js/artifacts/experiment-01
pnpm ml evaluate --out brain-js/artifacts/experiment-01
pnpm ml review --out brain-js/artifacts/experiment-01
```

`train` decodes training and validation images and freezes selection. `evaluate` loads test images
afterward. `review` requires external diagnostic inputs under sibling `docs/`; it does not change
weights or dataset membership. A frozen run cannot be overwritten: choose another `--out`.

## 3. Configuration

| Option                  | Meaning                                         | Default                           |
| ----------------------- | ----------------------------------------------- | --------------------------------- |
| `--data PATH`           | Materialized dataset root                       | `brain-js/data/scenes-curated-v2` |
| `--docs PATH`           | Original collections for preparation            | `../docs`                         |
| `--out PATH`            | New run directory                               | `brain-js/artifacts/curated-v2`   |
| `--epochs N`            | Positive maximum completed epochs per candidate | `60`                              |
| `--learning-rate N`     | A single rate in `(0, 1]`                       | Grid below when omitted           |
| `--rates LIST`          | Comma-separated learning rates                  | `0.03,0.1,0.3`                    |
| `--hidden LIST`         | Hidden widths; `0` means no hidden layer        | `0,16,32`                         |
| `--normalization VALUE` | `max15` or `sqrt-max15`                         | `sqrt-max15`                      |
| `--seed N`              | Positive initialization seed                    | `20261004`                        |
| `--folder PATH`         | Training folder; repeat to combine              | All training files                |
| `--limit N`             | Deterministic training-only subset              | No limit                          |
| `--version X.Y.Z`       | Export version for a new run                    | `6.1.0`                           |
| `--sizes LIST`          | Benchmark training sizes                        | `300,600,all`                     |
| `--quiet`               | File logging without terminal progress          | Off                               |

Use either `--learning-rate` or `--rates`. `--hidden` accepts widths from 0 to 256. Invalid flags,
rates, epochs, holdout folder selections and subsets missing a class are rejected.
Always set a new output directory and version for a proposed replacement model.

## 4. Folder selection

Images are grouped as `split / extension / native-resolution / class / original-file`.
Resolution bands describe the longest edge: small ≤256, medium ≤1024, large >1024. These are
dimension groups, not perceptual quality scores. No images are upscaled to create a quality group.

```bash
pnpm ml train --folder train/jpg/small --folder train/jpeg/medium --epochs 40 --learning-rate 0.1 --out brain-js/artifacts/folder-run
pnpm benchmark:training --hidden 0 --sizes 300,600,all --out ../docs/lab3/data/training-benchmark-new
```

Selecting the dataset root or `train` includes all training files. Validation/test folders are
forbidden as training inputs. Overlapping folder selections do not duplicate examples. All selected
files and their hashes are recorded; no selection changes the holdouts or centroid definitions.
Benchmark candidates use the same validation set and nested deterministic training subsets,
without test-based selection. Training timings are single measurements per configuration.

## 5. Preparing data

The committed dataset needs no download or raw collection access to train and test. Running
`pnpm prepare:dataset` checks it when present. To rebuild a separate dataset, provide all recorded
source collections under `--docs` and choose a new destination with `--data`.

The preparer inventories labeled GeoSceneNet16K, Intel and Landscape files, preserves known
manual exclusions, deduplicates source-photo groups, applies the frozen split rules and copies
native originals. Frozen provenance is available in the committed dataset. Unlabeled prediction
photos, TFRecords duplicates and external diagnostic photos are excluded from training.
Original source files are not modified. Never replace a test failure with an easier image.

## 6. Progress, logs and promotion

`operations.jsonl` contains timestamps, elapsed time, command settings, actual image/epoch counts,
candidate results and failures. A terminal progress bar uses completed work rather than a timer.
`selection.json`, `effective-config.json`, `splits.json`, evaluation records and both selected/exported
weights preserve the run. Inspect these records before promoting it.

```bash
pnpm ml sync --out brain-js/artifacts/experiment-01
pnpm verify:model
pnpm check
```

For a release, update the verifier's frozen run reference, artifact ignore allowlists and
version-specific tests together, then commit the new evaluated run and synchronized public pair.
Until that reference is updated, `verify:model` intentionally rejects a different newly synced run.
Only the current dataset belongs under `brain-js/data`; retain historical material outside `repo`.
