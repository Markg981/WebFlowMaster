import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Exclude setupFiles to avoid loading broken native DB bindings
    setupFiles: [], 
    include: ['server/ai-automation-service.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
