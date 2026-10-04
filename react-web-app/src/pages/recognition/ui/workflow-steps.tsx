import { Check } from 'lucide-react';

const COPY = {
  label: 'Recognition steps',
  steps: ['Choose a photo', 'Analyze on your device', 'See the scene'],
} as const;

export function WorkflowSteps({ currentStep }: { currentStep: number }) {
  return (
    <ol className="workflow-steps" aria-label={COPY.label}>
      {COPY.steps.map((label, index) => (
        <li
          key={label}
          className={
            index === currentStep ? 'is-current' : index < currentStep ? 'is-complete' : ''
          }
          aria-current={index === currentStep ? 'step' : undefined}
        >
          <span>{index < currentStep ? <Check size={13} /> : `0${index + 1}`}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
