#!/usr/bin/env node
// Reproducible local setup for the MediaPipe Pose Landmarker model files.
//
// - Downloads version-pinned model files (never the floating `latest` path) into public/models/.
// - Verifies each file against a pinned SHA-256; a corrupt or changed file is re-downloaded or rejected.
// - Skips files that are already present and valid, so it is safe to run before every `dev`/`build`.
//
// The WASM runtime is NOT downloaded here: it is imported from the installed, lockfile-pinned
// @mediapipe/tasks-vision package (see src/tracking/assets.ts), so JS and WASM versions always match.
//
// Usage:  npm run setup:assets            (download missing/invalid models)
//         npm run setup:assets -- --check (verify only; exit 1 if anything is missing)

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = join(root, 'public', 'models');

/** Source: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models (Apache-2.0). */
const MODELS = [
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5777746,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
  {
    file: 'pose_landmarker_full.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    bytes: 9398198,
    sha256: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  },
];

const checkOnly = process.argv.includes('--check');

function sha256Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function isValid(path, expected) {
  if (!existsSync(path)) return false;
  return (await sha256Of(path)) === expected;
}

async function download(model, dest) {
  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${model.url}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== model.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${model.file}: expected ${model.sha256}, got ${actual}. ` +
        'The upstream file changed; review it before updating the pinned hash in scripts/setup-assets.mjs.',
    );
  }
  const tmp = `${dest}.part`;
  await writeFile(tmp, data);
  renameSync(tmp, dest);
}

async function main() {
  mkdirSync(modelsDir, { recursive: true });
  const pkg = JSON.parse(
    readFileSync(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'), 'utf8'),
  );
  console.log(`[assets] @mediapipe/tasks-vision ${pkg.version} (WASM served from the installed package)`);

  let failures = 0;
  for (const model of MODELS) {
    const dest = join(modelsDir, model.file);
    if (await isValid(dest, model.sha256)) {
      console.log(`[assets] ok       ${model.file}`);
      continue;
    }
    if (checkOnly) {
      console.error(`[assets] MISSING  ${model.file} — run: npm run setup:assets`);
      failures++;
      continue;
    }
    if (existsSync(dest)) rmSync(dest);
    process.stdout.write(`[assets] fetching ${model.file} (${(model.bytes / 1e6).toFixed(1)} MB)… `);
    try {
      await download(model, dest);
      console.log('done');
    } catch (error) {
      console.log('failed');
      console.error(`[assets] ${error instanceof Error ? error.message : String(error)}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(
      `[assets] ${failures} model file(s) unavailable. The app will start, but tracking will show an ` +
        'error with a retry button until the files exist. Check your network connection and rerun ' +
        '`npm run setup:assets`, or download the URLs listed in scripts/setup-assets.mjs into public/models/ manually.',
    );
    process.exitCode = checkOnly ? 1 : 0;
  }
}

await main();
