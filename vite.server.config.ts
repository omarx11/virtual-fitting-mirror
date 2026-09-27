import { defineConfig } from 'vite';

/**
 * Production bundles of the Node server. Dependencies (fastify, sharp, fashn, @upstash/redis, …)
 * stay external and load from node_modules; nothing here reaches the browser bundle, which is built
 * separately by vite.config.ts.
 *   - default: the kiosk server (`npm run build:server` → dist-server/index.js, `npm start`);
 *   - `--mode vercel`: the Vercel Function (`npm run build:vercel` → dist-vercel/vercel.js, exported
 *     by api/ai-gateway.js).
 */
export default defineConfig(({ mode }) => {
  const vercel = mode === 'vercel';
  return {
    publicDir: false,
    define: { __VFM_SERVER_BUILD__: 'true' },
    build: {
      ssr: vercel ? 'server/vercel.ts' : 'server/index.ts',
      outDir: vercel ? 'dist-vercel' : 'dist-server',
      emptyOutDir: true,
      target: 'node22',
      sourcemap: true,
    },
  };
});
