import type { SceneClass } from './contracts';

export type SectionRole = 'pool' | 'test' | 'unlabeled';
export interface DatasetSource {
  id: string;
  name: string;
  url: string;
  labels: readonly string[];
  sections: readonly { name: string; role: SectionRole }[];
}

/** Labeled image collections the catalog draws from; `pool` sections feed train/validation, `test` sections only the final test. */
export const DATASETS = {
  geoscene: {
    id: 'geoscene',
    name: 'GeoSceneNet16K (local collection)',
    url: 'https://huggingface.co/datasets/prithivMLmods/Multilabel-GeoSceneNet-16K',
    labels: [
      'buildings and structures',
      'desert',
      'forest area',
      'hill or mountain',
      'ice glacier',
      'sea or ocean',
      'street view',
    ],
    sections: [{ name: '.', role: 'pool' }],
  },
  intel: {
    id: 'intel',
    name: 'Intel Image Classification',
    url: 'https://www.kaggle.com/datasets/puneet6060/intel-image-classification/data',
    labels: ['buildings', 'forest', 'glacier', 'mountain', 'sea', 'street'],
    sections: [
      { name: 'seg_train', role: 'pool' },
      { name: 'seg_test', role: 'test' },
      { name: 'seg_pred', role: 'unlabeled' },
    ],
  },
  landscape: {
    id: 'landscape',
    name: 'Landscape Recognition Image Dataset (12k)',
    url: 'https://www.kaggle.com/datasets/utkarshsaxenadn/landscape-recognition-image-dataset-12k-images',
    labels: ['coast', 'desert', 'forest', 'glacier', 'mountain'],
    sections: [
      { name: 'Training Data', role: 'pool' },
      { name: 'Validation Data', role: 'pool' },
      { name: 'Testing Data', role: 'test' },
    ],
  },
} as const satisfies Record<string, DatasetSource>;

export type DatasetId = keyof typeof DATASETS;

/** Scene types the application supports, in network output order. */
export const SCENE_CATALOG: readonly SceneClass[] = [
  { id: 'sea', displayName: 'Sea', source: 'intel', datasetLabel: 'sea' },
  { id: 'forest', displayName: 'Forest', source: 'intel', datasetLabel: 'forest' },
  { id: 'desert', displayName: 'Desert', source: 'landscape', datasetLabel: 'desert' },
];

/** Palette-restricted experiment; output indices and human labels stay unchanged. */
export const GEOSCENE_CATALOG: readonly SceneClass[] = [
  { id: 'sea', displayName: 'Sea', source: 'geoscene', datasetLabel: 'sea or ocean' },
  { id: 'forest', displayName: 'Forest', source: 'geoscene', datasetLabel: 'forest area' },
  { id: 'desert', displayName: 'Desert', source: 'geoscene', datasetLabel: 'desert' },
];

/** Dataset categories deliberately left out of the classification problem, per source. */
export const IGNORED_DATASET_LABELS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    Object.values(DATASETS).map((dataset) => [
      dataset.id,
      dataset.labels.filter(
        (label) =>
          ![...SCENE_CATALOG, ...GEOSCENE_CATALOG].some(
            (scene) => scene.source === dataset.id && scene.datasetLabel === label,
          ),
      ),
    ]),
  );

/** Sources that contribute at least one supported scene. */
export const USED_DATASETS: readonly DatasetSource[] = Object.values(DATASETS).filter((dataset) =>
  SCENE_CATALOG.some((scene) => scene.source === dataset.id),
);
