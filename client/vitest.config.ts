/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Vitest ignores vite.config.ts when a vitest.config.ts exists, so the path aliases have
  // to be repeated here — without them every test importing "@/…" or "@shared/…" fails to
  // resolve, which is what kept most of this suite red.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: false, // Optional: if you don't need to test CSS or have issues with CSS imports
  },
});
