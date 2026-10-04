/** Formats display values without changing the underlying measured values. */
export const formatPercent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
export const formatDuration = (value: number, digits = 1) => `${value.toFixed(digits)} ms`;
export const formatDimensions = (width: number, height: number) =>
  `${width.toLocaleString()} × ${height.toLocaleString()} px`;
export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
