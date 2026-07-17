import { defineConfig } from 'vite';

// `base: './'` keeps all asset URLs relative so the build works both locally
// and under a GitHub Pages project subpath (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});