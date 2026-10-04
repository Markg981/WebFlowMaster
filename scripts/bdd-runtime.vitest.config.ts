import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { include: ['scripts/bdd-runtime.test.ts'], environment: 'node', testTimeout: 20000 },
  resolve: { alias: { '@shared': path.resolve('shared') } },
});
