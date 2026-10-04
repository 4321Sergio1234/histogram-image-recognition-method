import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

/** Counts completed work. JSONL remains useful in redirected/non-interactive runs. */
export class OperationLog {
  private started = performance.now();
  constructor(
    readonly file: string,
    private quiet = false,
  ) {
    mkdirSync(dirname(file), { recursive: true });
  }
  event(operation: string, details: Record<string, unknown> = {}) {
    const row = {
      at: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - this.started),
      operation,
      ...details,
    };
    appendFileSync(this.file, JSON.stringify(row) + '\n');
    if (!this.quiet) {
      console.log(JSON.stringify(row));
    }
  }
  progress(
    operation: string,
    completed: number,
    total: number,
    details: Record<string, unknown> = {},
  ) {
    const percent = total ? Math.floor((100 * completed) / total) : 0;
    const filled = Math.min(20, Math.floor(percent / 5));
    this.event(operation, { completed, total, percent, ...details });
    if (process.stderr.isTTY && !this.quiet) {
      process.stderr.write(
        `\r[${'='.repeat(filled)}${' '.repeat(20 - filled)}] ${percent}% ${operation} ${completed}/${total}${completed === total ? '\n' : ''}`,
      );
    }
  }
}
