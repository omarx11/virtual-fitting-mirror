import { defineConfig } from 'vite';

/**
 * Production bundle of the Node server (`npm run build:server` → dist-server/index.js). Dependencies
 * (fastify, sharp, fashn, …) stay external and load from node_modules; nothing here reaches the
 * browser bundle, which is built separately by vite.config.ts.
 */
export default defineConfig({
  publicDir: false,
  define: { __VFM_SERVER_BUILD__: 'true' },
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
  },
});
