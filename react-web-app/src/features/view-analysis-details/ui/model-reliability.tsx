import type { ModelManifest } from '@horizon/brain/core';
import { formatPercent } from '@/shared/lib/format';
import { DetailsSection } from '@/shared/ui';
import { isHistogramFiltered, mostConfused, testCohort } from '../model/quality';

const COPY = {
  label: 'Model reliability',
  title: 'How reliable is this?',
  summary: (correct: number, total: number, cohort: string) =>
    `${correct} of ${total} ${cohort} test photos`,
  accuracy: (value: number, recalls: string) =>
    `were identified correctly (${formatPercent(value)}). Recall by scene: ${recalls}.`,
  coverage: (histogram: boolean, coverage: number, curated: boolean) =>
    `These selected ${histogram ? 'histogram patterns' : 'palettes'} cover ${formatPercent(coverage)} of the ${curated ? 'candidate test groups after manual exclusions' : 'original test partition'}.`,
  population: (total: number, accuracy: number) =>
    `Across all ${total} test photos, accuracy was ${formatPercent(accuracy)}.`,
  sampling: (counts: string) =>
    `Training, validation and test use the same palette and histogram rule. Test examples by scene: ${counts}. Class imbalance and reused source photos limit this evidence.`,
  warning: 'A high confidence can still be wrong.',
  confusion: (names: readonly string[], count: number) =>
    `${names.join(' and ')} photos are mistaken for each other most often (${count} test photos).`,
  caveat:
    'Related source photos and differences between datasets can make this score optimistic. Performance on independent photos may be lower.',
} as const;

export function ModelReliability({ model }: { model: ModelManifest }) {
  const test = model.testMetrics;
  const histogram = isHistogramFiltered(model);
  const correct = test.confusionMatrix.reduce((total, row, index) => total + row[index], 0);
  const recalls = test.perClass
    .map(
      (item, index) =>
        `${model.classes[index]?.displayName ?? item.id} ${formatPercent(item.recall)}`,
    )
    .join(' · ');
  const counts = test.perClass
    .map((item, index) => `${model.classes[index].displayName} ${item.count}`)
    .join(' · ');
  const confused = mostConfused(model);
  const population = model.domain?.populationTestMetrics;
  return (
    <DetailsSection title={COPY.title} className="model-quality" aria-label={COPY.label}>
      <p>
        <strong>{COPY.summary(correct, test.total, testCohort(model))}</strong>{' '}
        {COPY.accuracy(test.accuracy, recalls)}
      </p>
      {model.domain && (
        <p>
          {COPY.coverage(
            histogram,
            model.domain.paletteTestCoverage,
            model.domain.id === 'curated-histogram-v2',
          )}{' '}
          {population && COPY.population(population.total, population.accuracy)}{' '}
          {histogram && COPY.sampling(counts)}
        </p>
      )}
      <p>
        {COPY.warning} {confused.count > 0 && COPY.confusion(confused.names, confused.count)}
      </p>
      <p className="fine-print">{COPY.caveat}</p>
    </DetailsSection>
  );
}
