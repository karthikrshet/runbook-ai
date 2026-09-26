import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the built client works under any path prefix
  // (e.g. https://host/runbook/ behind a path-routed ingress on TrueFoundry).
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
});
