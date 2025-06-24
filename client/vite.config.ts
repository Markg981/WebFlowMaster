import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'), // Adjusted path for shared
    },
  },
  // If your Vitest config needs to be separate, keep it that way.
  // Otherwise, you could merge parts of vitest.config.ts here if desired.
});
