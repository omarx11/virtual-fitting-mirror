/**
 * OPT-IN real-provider smoke test: ONE paid FASHN generation (one output) for ONE explicitly
 * approved image pair. Never part of `npm test`, `npm run check` or CI, and never run just because
 * a key exists.
 *
 *   npm run smoke:ai -- --person path\to\approved-person.jpg --garment vneck-stone --confirm-paid-generation
 *   npm run smoke:ai -- --person me.jpg --garment path\to\product.jpg --category tops --photo-type flat-lay \
 *                       --confirm-paid-generation --save-result test-results\ai-smoke\result.jpg
 *
 * Uses the same image normalization, preset request shapes, FASHN adapter (no retries) and daily
 * credit ledger as the server. Writes a JSON report (timings, dimensions, credits — no images) to
 * test-results/ai-smoke/. The generated image is saved only when --save-result is given.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { decodeProviderOutput, normalizeImage } from '../server/ai/images';
import { FileLedger } from '../server/ai/ledger';
import { PRESETS } from '../server/ai/presets';
import { FashnProvider } from '../server/ai/providers/fashn';
import { mapRuntimeError, ProviderSubmitError } from '../server/ai/providers/types';
import { loadConfig } from '../server/config';
import {
  AI_PRESET_IDS,
  type AiGarmentCategory,
  type AiGarmentPhotoType,
  type AiPresetId,
} from '../src/ai/types';
import { findAiGarment } from '../src/garments/aiCatalogue';

const root = resolve(import.meta.dirname, '..');
const envFile = process.env.AI_ENV_FILE ?? join(root, '.env');
if (envFile !== 'none' && existsSync(envFile)) process.loadEnvFile(envFile);

const { values } = parseArgs({
  options: {
    person: { type: 'string' },
    garment: { type: 'string' },
    preset: { type: 'string' },
    category: { type: 'string', default: 'tops' },
    'photo-type': { type: 'string', default: 'flat-lay' },
    'save-result': { type: 'string' },
    'confirm-paid-generation': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(`[smoke:ai] ${message}`);
  process.exit(1);
}

const config = loadConfig(process.env, { production: false, root });
const { ai } = config;
if (!values.person || !values.garment) {
  fail(
    'Usage: npm run smoke:ai -- --person <approved photo> --garment <catalogue id | product photo> --confirm-paid-generation',
  );
}
if (ai.provider !== 'fashn') fail('AI_PROVIDER must be "fashn" for the real-provider smoke test.');
if (!ai.apiKey) fail('FASHN_API_KEY is not set in .env (enter it locally; never paste it into chat).');
const preset = (values.preset ?? ai.defaultPreset) as AiPresetId;
if (!AI_PRESET_IDS.includes(preset)) fail(`Unknown preset "${preset}".`);
const definition = PRESETS[preset];
if (!values['confirm-paid-generation']) {
  fail(
    `This sends ONE paid request (${definition.model}, ~${definition.credits} credit ≈ $${(definition.credits * 0.075).toFixed(3)} ` +
      'at the on-demand price listed on 2026-09-27). Re-run with --confirm-paid-generation to proceed.',
  );
}

const limits = { maxBytes: ai.maxUploadBytes, maxPixels: ai.maxInputPixels, longSide: ai.maxUploadLongSide };
const t0 = performance.now();
const personRaw = readFileSync(resolve(values.person));
const catalogue = findAiGarment(values.garment);
const productRaw = readFileSync(
  catalogue ? join(root, 'public', catalogue.productImage) : resolve(values.garment),
);
const person = await normalizeImage(personRaw, limits);
const product = await normalizeImage(productRaw, limits);
const category = (catalogue?.category ?? values.category) as AiGarmentCategory;
const photoType = (catalogue?.photoType ?? values['photo-type']) as AiGarmentPhotoType;
const tNormalized = performance.now();

const ledger = new FileLedger(ai.ledgerPath, ai.maxDailyCredits);
const jobId = `smoke-${new Date().toISOString()}`;
if (ledger.loadError) fail(ledger.loadError);
if (!(await ledger.reserve(jobId, definition.credits))) {
  fail(
    `Daily credit cap reached (AI_MAX_DAILY_CREDITS=${ai.maxDailyCredits}, used ${(await ledger.today()).used}).`,
  );
}

const provider = new FashnProvider({ apiKey: ai.apiKey, submitTimeoutMs: ai.submitTimeoutSeconds * 1000 });
const request = definition.build({
  personDataUri: `data:image/jpeg;base64,${person.buffer.toString('base64')}`,
  productDataUri: `data:image/jpeg;base64,${product.buffer.toString('base64')}`,
  category,
  photoType,
  seed: 42,
});

console.log(`[smoke:ai] submitting ONE ${preset} request (${person.width}×${person.height} photo)…`);
const tSubmit = performance.now();
let providerJobId: string;
try {
  ({ providerJobId } = await provider.submit(request, AbortSignal.timeout(ai.submitTimeoutSeconds * 1000)));
} catch (error) {
  const e = error instanceof ProviderSubmitError ? error : null;
  if (e?.kind === 'rejected') await ledger.release(jobId);
  else await ledger.markUncertain(jobId);
  fail(
    e?.kind === 'rejected'
      ? `Provider rejected the request (${e.code}). Nothing was charged.`
      : 'Submission outcome unknown (timeout/connection). NOT retried; it may still be charged — check the FASHN dashboard.',
  );
}
const tAccepted = performance.now();

let status = await provider.status(providerJobId, AbortSignal.timeout(20_000));
const states = [status.state];
const deadline = Date.now() + ai.jobDeadlineSeconds * 1000;
while (!['completed', 'failed', 'canceled', 'time_out'].includes(status.state) && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    status = await provider.status(providerJobId, AbortSignal.timeout(20_000));
    if (states.at(-1) !== status.state) states.push(status.state);
  } catch {
    // Transient read failure: keep polling the SAME prediction.
  }
}
const tDone = performance.now();

const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  preset,
  model: definition.model,
  personInput: { width: person.width, height: person.height, bytes: person.buffer.length },
  productInput: {
    width: product.width,
    height: product.height,
    bytes: product.buffer.length,
    garment: values.garment,
  },
  states,
  finalState: status.state,
  creditsReported: status.creditsUsed,
  timingsMs: {
    normalize: Math.round(tNormalized - t0),
    submitRoundTrip: Math.round(tAccepted - tSubmit),
    acceptedToTerminal: Math.round(tDone - tAccepted),
    total: Math.round(tDone - t0),
  },
};

if (status.state === 'completed') {
  await ledger.charge(jobId, status.creditsUsed ?? definition.credits);
  const image = await decodeProviderOutput(status.output[0], {
    maxBytes: 3 * ai.maxUploadBytes,
    maxPixels: ai.maxInputPixels,
  });
  report.output = { width: image.width, height: image.height, bytes: image.buffer.length };
  if (values['save-result']) {
    const out = resolve(values['save-result']);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, image.buffer);
    report.savedTo = out;
  }
} else if (status.state === 'failed') {
  await ledger.release(jobId);
  report.error = mapRuntimeError(status.errorName);
} else {
  await ledger.markUncertain(jobId);
  report.error = 'deadline or unknown terminal state; not retried';
}

const dir = join(root, 'test-results', 'ai-smoke');
mkdirSync(dir, { recursive: true });
const reportPath = join(dir, `${report.date as string}.json`.replace(/:/g, '-'));
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`[smoke:ai] report: ${reportPath}`);
console.log(
  '[smoke:ai] Review the image by eye: face/identity, garment colour, text/logos, seams, sleeves, crossed arms, ' +
    'background preservation, body shape, and loose/long → fitted/short clothing transitions. Record findings in docs/TESTING.md.',
);
if (status.state !== 'completed') process.exit(2);
