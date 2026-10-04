export const PHOTO_GUIDANCE = [
  {
    id: 'framing',
    title: 'Show the whole scene',
    summary: 'Step back so water, trees or dunes fill most of the frame.',
    description:
      'The model looks at the brightness of the entire photo. Step back so the sea, forest or desert fills most of the frame.',
  },
  {
    id: 'lighting',
    title: 'Use daylight',
    summary: 'Natural light works best. Night shots and heavy filters change the brightness.',
    description:
      'Soft, natural light works best. Night shots, flash and strong filters change the brightness pattern. Color is not measured: blue water and warm sand can still have similar brightness histograms.',
  },
  {
    id: 'foreground',
    title: 'Avoid close-ups',
    summary: 'People, objects or text in front of the view can change the result.',
    description:
      'Keep people, vehicles, signs and other objects out of the foreground where you can.',
  },
] as const;
