import type { AuditedImage, DatasetAudit, DatasetSplit } from './types';
import { assertNoLeakage } from './split';
import { seededRandom, shuffled } from './random';

export interface ExclusionRule {
  path: string;
  sha256: string;
  reason: string;
}
/** Retains the original holdout photos; pool groups linked to test are removed, not moved to train. */
export function correctSplit(
  audit: DatasetAudit,
  anchor: DatasetSplit,
  exclusions: readonly ExclusionRule[],
): DatasetSplit {
  const byPath = new Map(audit.images.map((image) => [image.path, image]));
  const rejected = new Map<string, string>();
  for (const rule of exclusions) {
    const image = byPath.get(rule.path);
    if (!image || image.sha256 !== rule.sha256) {
      throw new Error(`Reviewed exclusion no longer matches its original file: ${rule.path}`);
    }
    rejected.set(image.group, rule.reason);
  }
  const groups = new Map<string, AuditedImage[]>();
  for (const image of audit.images) {
    const group = groups.get(image.group) ?? [];
    group.push(image);
    groups.set(image.group, group);
  }
  const oldValidation = new Set(anchor.validation.map((image) => image.path));
  const oldTrain = new Set(anchor.train.map((image) => image.path));
  const split: DatasetSplit = {
    ...anchor,
    datasetFingerprint: audit.fingerprint,
    train: [],
    validation: [],
    test: anchor.test.map((image) => {
      const current = byPath.get(image.path);
      if (!current || current.sha256 !== image.sha256) {
        throw new Error(`The fixed test has changed: ${image.path}`);
      }
      return current;
    }),
    excluded: [],
    counts: {},
  };
  const random = seededRandom(anchor.seed);
  for (const label of anchor.classes) {
    const matches = (image: AuditedImage) =>
      image.role === 'pool' && image.source === label.source && image.label === label.datasetLabel;
    const pool = audit.images.filter(matches);
    for (const members of groups.values()) {
      const selected = members.filter(matches);
      if (!selected.length) {
        continue;
      }
      const reason = members.some((image) => image.role === 'test')
        ? 'Exact/perceptual copy of a reserved test image; whole pool group excluded.'
        : (rejected.get(members[0].group) ??
          (new Set(members.filter((image) => image.label !== null).map((image) => image.label))
            .size > 1
            ? 'Duplicate group has conflicting source labels.'
            : null));
      if (reason) {
        split.excluded.push(...selected.map((image) => ({ path: image.path, reason })));
        continue;
      }
      const priorValidation = selected.filter((image) => oldValidation.has(image.path));
      const destination = priorValidation.length ? split.validation : split.train;
      const options = priorValidation.length
        ? priorValidation
        : selected.filter((image) => oldTrain.has(image.path));
      const representative = [...(options.length ? options : selected)].sort((a, b) =>
        a.path.localeCompare(b.path, 'en'),
      )[0];
      destination.push(representative);
      split.excluded.push(
        ...selected
          .filter((image) => image !== representative)
          .map((image) => ({
            path: image.path,
            reason:
              'One development representative per exact/perceptual source-photo group; validation membership takes priority.',
          })),
      );
    }
    split.counts[label.id] = {
      available: pool.length,
      excluded: 0,
      train: split.train.filter(matches).length,
      validation: split.validation.filter(matches).length,
      test: split.test.filter(
        (image) => image.source === label.source && image.label === label.datasetLabel,
      ).length,
    };
  }
  if (
    Object.values(split.counts).some((count) => !count.train || !count.validation || !count.test)
  ) {
    throw new Error('Every corrected class needs non-empty train, validation and test.');
  }
  const minimum = Math.min(...Object.values(split.counts).map((count) => count.train));
  const balanced: AuditedImage[] = [];
  for (const label of split.classes) {
    const rows = shuffled(
      split.train.filter(
        (image) => image.source === label.source && image.label === label.datasetLabel,
      ),
      random,
    );
    balanced.push(...rows.slice(0, minimum));
    split.excluded.push(
      ...rows.slice(minimum).map((image) => ({
        path: image.path,
        reason: 'Deterministic training-only class balancing; no repeated minority images.',
      })),
    );
    split.counts[label.id].train = minimum;
    split.counts[label.id].excluded =
      split.counts[label.id].available - minimum - split.counts[label.id].validation;
  }
  split.train = shuffled(balanced, random);
  split.excluded.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assertNoLeakage(split);
  return split;
}
