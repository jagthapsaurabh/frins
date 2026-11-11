import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'public_build',
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true
  },
  test: {
    // The test files share one SQLite file, so they must not run in parallel.
    // Two workers seeding the same database at once breaks on the unique email index.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
