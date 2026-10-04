export const RECOGNITION_COPY = {
  failed: 'Something went wrong. Please try again.',
  loadModel: 'Load local model',
  prepareCamera: 'Prepare camera photo',
  prepareImage: 'Prepare image',
  cameraReady: 'Photo captured. Ready to analyze.',
  imageReady: 'Image ready to analyze.',
  noImage: 'Choose an image or take a photo before analyzing.',
  analyze: 'Analyze image',
  complete: 'Analysis complete. Your photo stayed on this device.',
  reset: 'Reset workspace',
  version: (version: string) => `Version ${version}`,
} as const;
