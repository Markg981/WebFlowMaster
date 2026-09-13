import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Where the API server is listening. Both the port and the whole target are configurable so
// `PORT=5100 npm run dev` in one terminal and `VITE_API_PORT=5100 npm run dev:client` in the
// other actually talk to each other — the port used to be hard-coded here as well as in
// server/index.ts, which meant changing it required editing two files and knowing to.
const apiPort = process.env.VITE_API_PORT ?? process.env.PORT ?? '5000';
const apiTarget = process.env.VITE_API_TARGET ?? `http://localhost:${apiPort}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: apiTarget,
        ws: true,
      },
    },
  },
});
