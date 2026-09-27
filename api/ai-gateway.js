// Vercel Function for /api/ai/* (vercel.json rewrites to it). The code lives in server/vercel.ts;
// `npm run build:vercel` bundles it into dist-vercel/ before Vercel packages this function, because
// the server's TypeScript sources cannot run in Node as they are.
export { default } from '../dist-vercel/vercel.js';
