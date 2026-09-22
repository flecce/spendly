import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, Netlify, …).
  base: './',
  server: { port: 5173, strictPort: true },
});
