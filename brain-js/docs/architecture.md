# Training package architecture

## 1. Modules

`src/core` exports contracts shared with the browser. `src/features/histogram.ts` implements
luminance, histogram quantization and four-bit encoding. `src/image/decode.ts` decodes native
images with the recorded orientation, profile and alpha policy. Browser parity checks use the
same feature rules against Chromium decoding.

`src/dataset/curated.ts` owns the current dataset format, integrity checks and training folder
selection. Audit/grouping modules provide source inventory, exact hashes and recorded near-copy
groups for preparation. `src/cli/main.ts` parses commands and configures runs; `progress.ts` records
actual completed images and epochs in JSON Lines.

`src/model/train.ts` trains candidates and preserves validation checkpoints.
`src/evaluation/metrics.ts` computes accuracy, macro-F1 and per-class metrics.
`src/export/model.ts` creates and validates the model manifest and synchronizes the web assets.

## 2. Dataset integrity

The only active physical dataset is `data/scenes-curated-v2`. Its manifest freezes each file's
hash, source-photo group, dimensions, native extension, resolution band, class and split.
Loading validates the protocol hash and manifest fingerprint, hashes every actual file and rejects
unexpected files, symlinks, duplicate groups/hashes, invalid paths and mismatched counts.
Reading samples also rechecks the numerical curation rule using actual decoded pixels.

All three splits use the same canonical palette and brightness criterion. Brightness centroids
are fitted only on palette-eligible training groups. Palette screening is curation metadata;
the ANN still receives only global brightness bits. Prior holdout membership is preserved.
The original source collections and historical dataset copies are outside this package.

## 3. Training selection

Every admitted selected training original is used once per epoch. Folder/size choices affect
training only and must retain all three classes. Validation and test membership remains frozen.

Within a candidate, the best validation macro-F1 checkpoint wins, then accuracy, then earlier
epoch. Among candidates within 0.01 macro-F1 of the best, the fewest parameters win, followed by
macro-F1 and accuracy. Test does not participate in selection. The run records effective settings,
selected file paths/hashes, candidate checkpoints and timings before test evaluation.

## 4. Export and inference

The serialized network uses numeric outputs in fixed order: **Sea, Forest, Desert**. The manifest
binds that order to display labels and records 1024 inputs, normalization, model SHA-256,
architecture, checkpoint, learning rate, dataset fingerprint and evaluation counts.

`evaluate` verifies frozen selection/dataset hashes and reproduces previous test metrics exactly
when called again. `sync` refuses a model from a different dataset and replaces the entire web
model directory with one validated pair. Workspace model checks compare that pair with the
frozen training artifacts before build and deployment.

Historical `clean` and `palette` modules remain for earlier audit/reproduction records. Their
package script aliases are separate from the current `pnpm ml` workflow.
