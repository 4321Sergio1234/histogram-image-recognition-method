# Dataset sources and attribution

The manifest records the original collection and relative source path for each copied image. Images are original bytes; no transformations or upscaling were applied. Duplicate source-photo groups contribute one file only.

| Collection | Source | Publisher metadata checked 4 October 2026 |
|---|---|---|
| GeoSceneNet16K | [Hugging Face dataset card](https://huggingface.co/datasets/prithivMLmods/Multilabel-GeoSceneNet-16K) | Apache-2.0 in the dataset card |
| Intel Image Classification | [Kaggle dataset](https://www.kaggle.com/datasets/puneet6060/intel-image-classification/data) | Data files © Original Authors in Kaggle API metadata |
| Landscape Recognition, 12k | [Kaggle dataset](https://www.kaggle.com/datasets/utkarshsaxenadn/landscape-recognition-image-dataset-12k-images) | CC0: Public Domain in Kaggle API metadata |

These are publisher declarations, not a new license granted by this repository for individual photographs. The local GeoScene Sea/Forest files are aliases of Intel content, and its Desert files alias Landscape content. Keeping those source relationships visible matters for both attribution and the ML source-bias discussion.

The `provenance/` folder retains the frozen population partition, original manual decisions, separate visual reinspection and confirmed-artifact decisions used to reproduce curation. These are training-data metadata. Reports, external sanity pictures and performance benchmark inputs remain in the sibling `docs/` folder.
