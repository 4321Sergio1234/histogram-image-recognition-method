import type { SceneClass } from '../core/contracts';
import type { SectionRole } from '../core/scenes';

export type SplitName = 'train' | 'validation' | 'test';
export interface SectionLayout {
  name: string;
  role: SectionRole;
  directory: string;
  labeled: boolean;
  classes: { label: string; directory: string }[];
}
export interface DatasetLayout {
  root: string;
  sections: SectionLayout[];
}
/** `path` is `<source>/<path relative to that source root>`, unique across sources. */
export interface AuditedImage {
  perceptualHash?: string;
  path: string;
  source: string;
  section: string;
  role: SectionRole;
  label: string | null;
  bytes: number;
  width: number;
  height: number;
  format: string;
  extension: string;
  sha256: string;
  pixelSha256: string;
  group: string;
  featureIndex: number;
}
export interface SkippedFile {
  path: string;
  reason: string;
}
export interface DuplicateSummary {
  groups: number;
  imagesInGroups: number;
  poolTestGroups: number;
  poolTestImages: string[];
  crossLabelGroups: { labels: string[]; paths: string[] }[];
}
export interface AuditedSource {
  id: string;
  name: string;
  url: string;
  root: string;
  sections: {
    name: string;
    role: SectionRole;
    directory: string;
    labeled: boolean;
    classes: string[];
  }[];
  counts: Record<string, Record<string, { discovered: number; readable: number }>>;
  dimensions: Record<string, number>;
  outsideSections: Record<string, number>;
  selectedClasses: string[];
  ignoredClasses: string[];
}
export interface DatasetAudit {
  auditVersion: 'scenes-v3';
  decoderPolicy?: 'sharp-opaque-chromium-profile-alpha-v2';
  nearDuplicates?: {
    method: string;
    pairs: { a: string; b: string; bits: number; mode: number; mae: number; correlation: number }[];
  };
  createdAt: string;
  sources: AuditedSource[];
  formats: Record<string, number>;
  extensionCounts: Record<string, number>;
  formatMismatches: { path: string; extension: string; format: string }[];
  unreadable: SkippedFile[];
  ignoredFiles: SkippedFile[];
  duplicates: DuplicateSummary;
  discovered: number;
  readable: number;
  images: AuditedImage[];
  fingerprint: string;
  preprocessingVersion: 'luma-round-max15-msb-v1';
}
export interface DatasetSplit {
  seed: number;
  validationPercent: number;
  datasetFingerprint: string;
  classes: SceneClass[];
  ignoredClasses: Record<string, string[]>;
  train: AuditedImage[];
  validation: AuditedImage[];
  test: AuditedImage[];
  counts: Record<string, Record<SplitName, number> & { available: number; excluded: number }>;
  excluded: SkippedFile[];
}
export interface FeatureSample {
  input: number[];
  output: number[];
  classIndex: number;
  path: string;
}
