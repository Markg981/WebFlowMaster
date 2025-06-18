import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // To use describe, it, expect, etc. globally
    environment: 'node', // Crucial for backend testing
    include: ['server/**/*.test.ts'], // Pattern to find test files
    // setupFiles: ['./server/tests/setup.ts'], // Optional: for global test setup
    // reporters: ['default', 'html'], // Optional: for UI reporting via @vitest/ui
    // coverage: { // Optional: configure coverage
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
  },
});
