import { quantizeHistogram, encodeFourBits } from '../features/histogram';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seededRandom, shuffled } from './random';
import type { AuditedImage, DatasetAudit, DatasetSplit, FeatureSample, SplitName } from './types';
import type { SceneClass } from '../core/contracts';

/**
 * Pool sections (Intel seg_train; Landscape Training/Validation Data) → seeded, class-stratified train/validation partition.
 * Test sections (Intel seg_test; Landscape Testing Data) → final test, untouched.
 * Duplicate groups stay together; pool images that duplicate a test image or carry conflicting labels are excluded from both.
 */
export function splitDataset(
  audit: DatasetAudit,
  classes: readonly SceneClass[],
  seed: number,
  validationPercent: number,
): DatasetSplit {
  if (!Number.isInteger(validationPercent) || validationPercent <= 0 || validationPercent >= 100) {
    throw new Error('validationPercent must be an integer between 1 and 99.');
  }
  const random = seededRandom(seed);
  const members = new Map<string, AuditedImage[]>();
  for (const image of audit.images) {
    members.set(image.group, [...(members.get(image.group) ?? []), image]);
  }
  const ignoredClasses: Record<string, string[]> = {};
  for (const image of audit.images) {
    if (
      image.label !== null &&
      !classes.some((label) => label.source === image.source && label.datasetLabel === image.label)
    ) {
      ignoredClasses[image.source] = [
        ...new Set([...(ignoredClasses[image.source] ?? []), image.label]),
      ].sort();
    }
  }
  const split: DatasetSplit = {
    seed,
    validationPercent,
    datasetFingerprint: audit.fingerprint,
    classes: [...classes],
    ignoredClasses,
    train: [],
    validation: [],
    test: [],
    counts: {},
    excluded: [],
  };
  for (const label of classes) {
    const matches = (image: AuditedImage) =>
      image.source === label.source && image.label === label.datasetLabel;
    const available = audit.images.filter((image) => image.role === 'pool' && matches(image));
    const groups = new Map<string, AuditedImage[]>();
    for (const image of available) {
      const group = members.get(image.group) ?? [image];
      const reason = group.some((item) => item.role === 'test')
        ? 'Identical to a test-section image; excluded from training and validation.'
        : new Set(group.map((item) => item.label).filter((item) => item !== null)).size > 1
          ? 'Identical pixels carry conflicting dataset labels.'
          : null;
      if (reason) {
        split.excluded.push({ path: image.path, reason });
        continue;
      }
      groups.set(image.group, [...(groups.get(image.group) ?? []), image]);
    }
    const eligible = [...groups.values()].reduce((sum, group) => sum + group.length, 0);
    const target = Math.floor((eligible * validationPercent) / 100);
    const validation: AuditedImage[] = [];
    const train: AuditedImage[] = [];
    for (const group of shuffled([...groups.values()], random)) {
      (validation.length < target ? validation : train).push(...group);
    }
    const test = audit.images.filter((image) => image.role === 'test' && matches(image));
    if (!train.length || !validation.length || !test.length) {
      throw new Error(`Class ${label.id} needs images in train, validation and test.`);
    }
    split.train.push(...train);
    split.validation.push(...validation);
    split.test.push(...test);
    split.counts[label.id] = {
      available: available.length,
      excluded: available.length - eligible,
      train: train.length,
      validation: validation.length,
      test: test.length,
    };
  }
  split.excluded.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  split.train = shuffled(split.train, random);
  assertNoLeakage(split);
  return split;
}

export function assertNoLeakage(split: DatasetSplit): void {
  const roles: Record<SplitName, AuditedImage['role']> = {
    train: 'pool',
    validation: 'pool',
    test: 'test',
  };
  const assignments = new Map<string, SplitName>();
  for (const name of ['train', 'validation', 'test'] as SplitName[]) {
    for (const image of split[name]) {
      if (image.role !== roles[name]) {
        throw new Error(`${name} must come from a ${roles[name]} section: ${image.path}`);
      }
      for (const key of [image.group, image.sha256, image.pixelSha256]) {
        const previous = assignments.get(key);
        if (previous && previous !== name) {
          throw new Error(`Data leakage detected between ${previous} and ${name}: ${image.path}`);
        }
        assignments.set(key, name);
      }
    }
  }
}

export function classIndex(split: Pick<DatasetSplit, 'classes'>, image: AuditedImage): number {
  const index = split.classes.findIndex(
    (label) => label.source === image.source && label.datasetLabel === image.label,
  );
  if (index < 0) {
    throw new Error(`Image is outside the selected classes: ${image.path}`);
  }
  return index;
}

export async function readSamples(
  split: DatasetSplit,
  name: SplitName,
  directory: string,
  normalization: 'max15' | 'sqrt-max15' = 'max15',
): Promise<FeatureSample[]> {
  const features = await readFile(
    resolve(directory, normalization === 'max15' ? 'features.bin' : 'histograms.bin'),
  );
  return split[name].map((image) => {
    const index = classIndex(split, image);
    const offset = image.featureIndex * 1024;
    if (image.featureIndex < 0 || features.length < offset + 1024) {
      throw new Error('The feature cache is incomplete. Run audit:dataset again.');
    }
    const histogram =
      normalization === 'sqrt-max15'
        ? Array.from({ length: 256 }, (_, bin) => features.readUInt32LE(offset + bin * 4))
        : null;
    if (histogram && !histogram.some((value) => value > 0)) {
      throw new Error('Raw histogram cache is incomplete. Re-audit the dataset.');
    }
    return {
      input: histogram
        ? encodeFourBits(quantizeHistogram(histogram, normalization))
        : Array.from(features.subarray(offset, offset + 1024)),
      output: split.classes.map((_, position) => (position === index ? 1 : 0)),
      classIndex: index,
      path: image.path,
    };
  });
}
