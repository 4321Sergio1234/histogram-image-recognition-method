const COPY = {
  eyebrow: 'NATURAL SCENE RECOGNITION',
  title: 'Recognize a',
  emphasis: 'natural scene.',
  local: 'On-device analysis.',
  privacy: 'Nothing is uploaded.',
  description: (scenes: string) =>
    `Take a photo or choose an image to identify whether it shows a ${scenes} scene.`,
} as const;

export function RecognitionHero({ scenes }: { scenes: string }) {
  return (
    <div className="hero">
      <div>
        <p className="eyebrow">
          <span /> {COPY.eyebrow}
        </p>
        <h1>
          {COPY.title}
          <br className="mobile-break" /> <em>{COPY.emphasis}</em>
        </h1>
        <p className="hero-description">{COPY.description(scenes)}</p>
      </div>
      <span className="hero-aside">
        {COPY.local}
        <br />
        {COPY.privacy}
      </span>
    </div>
  );
}
