import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./react-web-app/src', import.meta.url)) } },
  test: {
    include: [
      'brain-js/tests/**/*.test.ts',
      'react-web-app/src/**/*.test.{ts,tsx}',
      'react-web-app/tests/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
