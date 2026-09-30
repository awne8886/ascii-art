import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Path the site is served under: `/` normally, `/<repo>/` for a GitHub Pages
 * project site (the Pages workflow sets BASE_PATH).
 */
function basePath(): string {
  const raw = process.env.BASE_PATH?.trim();
  if (!raw) return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

export default defineConfig({
  base: basePath(),
  plugins: [react()],
  // onnxruntime-web locates its .wasm next to its own module; pre-bundling would break that in dev.
  optimizeDeps: { exclude: ['onnxruntime-web', 'onnxruntime-web/webgpu'] },
  worker: { format: 'es' },
  build: {
    outDir: process.env.OUT_DIR || 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
});
