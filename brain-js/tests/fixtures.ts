import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { AuditedImage, DatasetAudit } from '../src/dataset/types';

/** Writes a small real JPEG; `shade` controls its uniform brightness. */
export async function jpeg(file: string, shade: number, width = 4, height = 4): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await sharp({
    create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } },
  })
    .jpeg({ quality: 95 })
    .toFile(file);
}

export async function touch(file: string, contents = 'metadata'): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
}

const roles: Record<string, AuditedImage['role']> = {
  seg_train: 'pool',
  seg_test: 'test',
  seg_pred: 'unlabeled',
  'Training Data': 'pool',
  'Validation Data': 'pool',
  'Testing Data': 'test',
};

export function image(
  path: string,
  section: string,
  label: string | null,
  hash = path,
  source = section.startsWith('seg_') ? 'intel' : 'landscape',
): AuditedImage {
  return {
    path: `${source}/${path}`,
    source,
    section,
    role: roles[section],
    label,
    bytes: 1,
    width: 150,
    height: 150,
    format: 'jpeg',
    extension: 'jpg',
    sha256: hash,
    pixelSha256: hash,
    group: `${source}/${path}`,
    featureIndex: 0,
  };
}

export function auditOf(images: AuditedImage[]): DatasetAudit {
  return { fingerprint: 'fixture', images } as DatasetAudit;
}
