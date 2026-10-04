export const EXPORT_COPY = {
  format: 'Export format',
  preparing: 'Preparing…',
  export: 'Export result',
  original: 'Save original photo',
  json: 'Save result JSON',
  originalOperation: 'Download original photo',
  jsonOperation: 'Download JSON result',
  imageOperation: 'Export analysis image',
  failed: 'The image could not be exported. Try again.',
  downloaded: (format: string) => `${format.toUpperCase()} analysis image downloaded.`,
} as const;

export const EXPORT_FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'bmp', label: 'BMP' },
] as const;
