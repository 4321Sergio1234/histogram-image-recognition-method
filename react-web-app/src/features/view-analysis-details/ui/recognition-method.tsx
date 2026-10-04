import { ShieldCheck } from 'lucide-react';
import { InstructionList } from '@/shared/ui';

const COPY = {
  privacyTitle: 'Made to stay on your device.',
  privacy: 'Your photo is processed in your browser. No account, image uploads, or tracking.',
  brightnessTitle: 'A photo becomes a brightness pattern',
  brightness:
    'Horizon counts how many pixels fall on each of 256 brightness levels across the whole photo.',
  encodingTitle: 'The pattern becomes a compact input',
  encoding: 'Each count is scaled to 0–15 and written as four bits, giving 1,024 input values.',
  networkTitle: 'A small neural network names the scene',
  network: (scenes: string) =>
    `A locally trained Brain.js network compares the pattern with ${scenes} scenes.`,
} as const;

export function RecognitionMethod({ scenes }: { scenes: string }) {
  const instructions = [
    { title: COPY.brightnessTitle, description: COPY.brightness },
    { title: COPY.encodingTitle, description: COPY.encoding },
    { title: COPY.networkTitle, description: COPY.network(scenes) },
  ];
  return (
    <>
      <div className="local-callout">
        <ShieldCheck size={24} />
        <p>
          <strong>{COPY.privacyTitle}</strong>
          {COPY.privacy}
        </p>
      </div>
      <InstructionList items={instructions} />
    </>
  );
}
