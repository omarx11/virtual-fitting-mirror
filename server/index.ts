/**
 * Server entry. Development: `npm run dev` (tsx watch, alongside Vite, which proxies /api here).
 * Production: `npm run build` then `npm start` (serves dist/ and /api at one origin).
 *
 * A local `.env` (see .env.example) is loaded if present; variables already set in the environment
 * win. Set AI_ENV_FILE=none to skip it (the automated tests do, so a real key is never picked up).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';

declare const __VFM_SERVER_BUILD__: boolean | undefined;

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = process.env.AI_ENV_FILE ?? join(root, '.env');
if (envFile !== 'none' && existsSync(envFile)) process.loadEnvFile(envFile);

const production =
  (typeof __VFM_SERVER_BUILD__ !== 'undefined' && __VFM_SERVER_BUILD__) ||
  process.env.NODE_ENV === 'production';

try {
  const config = loadConfig(process.env, { production, root });
  const { app, services } = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  const ai = config.ai.unavailableReason
    ? `AI unavailable - ${config.ai.unavailableReason}`
    : `AI enabled (provider: ${services.providerName}, preset: ${config.ai.defaultPreset}, daily cap: ${config.ai.maxDailyCredits === null ? 'none' : `${config.ai.maxDailyCredits} credits`})`;
  console.log(
    `[server] ${production ? 'production' : 'development'} - http://${config.host}:${config.port} - ${ai}`,
  );
  if (services.ledger.loadError) console.error(`[server] ${services.ledger.loadError}`);
  const shutdown = () => void app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[server] configuration error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
