/**
 * Deterministic OFFLINE test provider for development and automated tests. It makes no network
 * calls and performs no AI: its "result" is the submitted person photo with the product photo
 * inset and a large red TEST RESULT banner, so it can never be mistaken for a generated try-on.
 * Disabled in production unless AI_ALLOW_FAKE_PROVIDER=true (used only by the preview tests).
 * A passing fake-provider test proves the plumbing, not image quality or the paid integration.
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FakeScenario } from '../../config';
import type { ProviderRequest } from '../presets';
import { type ProviderStatus, ProviderSubmitError, type TryOnProvider } from './types';

interface FakeJob {
  scenario: FakeScenario;
  startedAt: number;
  person: string | null;
  product: string | null;
  output: string | null;
}

/** A request as recorded for assertions: image data URIs are replaced by their length. */
export interface RecordedRequest {
  model_name: string;
  inputs: Record<string, string | number | boolean>;
}

export interface FakeProviderOptions {
  scenario: FakeScenario;
  /** Time spent in each of starting / in_queue / processing. */
  stepMs: number;
  now?: () => number;
}

function redact(request: ProviderRequest): RecordedRequest {
  const inputs: RecordedRequest['inputs'] = {};
  for (const [k, v] of Object.entries(request.inputs)) {
    inputs[k] = typeof v === 'string' && v.startsWith('data:') ? `<data-uri ${v.length} chars>` : v;
  }
  return { model_name: request.model_name, inputs };
}

const BANNER = (width: number) => {
  const h = Math.max(48, Math.round(width * 0.09));
  const fs = Math.round(h * 0.42);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">
      <defs><pattern id="s" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="24" fill="#b00020"/><rect x="12" width="12" height="24" fill="#d81b3c"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#s)"/>
      <text x="50%" y="62%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${fs}" fill="#ffffff">TEST RESULT · FAKE PROVIDER · NOT AI</text>
    </svg>`,
  );
};

async function renderTestResult(personUri: string, productUri: string): Promise<string> {
  const person = Buffer.from(personUri.split(',')[1] ?? '', 'base64');
  const product = Buffer.from(productUri.split(',')[1] ?? '', 'base64');
  const meta = await sharp(person).metadata();
  const width = meta.width ?? 512;
  const height = meta.height ?? 512;
  const insetW = Math.max(64, Math.round(Math.min(width, height) * 0.32));
  const inset = await sharp(product)
    .resize(insetW, insetW, { fit: 'contain', background: '#ffffff' })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#b00020' })
    .toBuffer();
  const banner = BANNER(width);
  const out = await sharp(person)
    .composite([
      { input: banner, top: 0, left: 0 },
      { input: inset, gravity: 'southeast' },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

export class FakeProvider implements TryOnProvider {
  readonly name = 'fake' as const;
  readonly requests: RecordedRequest[] = [];
  submitCount = 0;
  statusCount = 0;
  private jobs = new Map<string, FakeJob>();
  private readonly now: () => number;

  constructor(private options: FakeProviderOptions) {
    this.now = options.now ?? Date.now;
  }

  setScenario(scenario: FakeScenario): void {
    this.options = { ...this.options, scenario };
  }

  async submit(request: ProviderRequest, signal: AbortSignal): Promise<{ providerJobId: string }> {
    this.submitCount++;
    this.requests.push(redact(request));
    const { scenario } = this.options;
    // Yield like a real network call, so concurrent callers interleave realistically.
    await new Promise((r) => setTimeout(r, 5));
    if (signal.aborted) throw new ProviderSubmitError('ambiguous', 'uncertain', 'aborted');
    if (scenario === 'submit-timeout') {
      throw new ProviderSubmitError('ambiguous', 'uncertain', 'Simulated timeout after sending.');
    }
    if (scenario === 'submit-rejected') {
      throw new ProviderSubmitError('rejected', 'provider-credits', 'Simulated out-of-credits response.');
    }
    const id = `fake-${randomUUID()}`;
    const person = request.inputs.model_image;
    const product = request.inputs.product_image ?? request.inputs.garment_image;
    this.jobs.set(id, {
      scenario,
      startedAt: this.now(),
      person: typeof person === 'string' ? person : null,
      product: typeof product === 'string' ? product : null,
      output: null,
    });
    return { providerJobId: id };
  }

  async status(providerJobId: string): Promise<ProviderStatus> {
    this.statusCount++;
    const job = this.jobs.get(providerJobId);
    const base = { output: [] as unknown[], errorName: null, creditsUsed: null };
    if (!job) return { ...base, state: 'failed', errorName: 'PipelineError' };
    const step = Math.floor((this.now() - job.startedAt) / this.options.stepMs);
    if (step < 1) return { ...base, state: 'starting' };
    if (step < 2) return { ...base, state: 'in_queue' };
    if (step < 3 || job.scenario === 'never-completes') return { ...base, state: 'processing' };
    switch (job.scenario) {
      case 'fail-pose':
        return { ...base, state: 'failed', errorName: 'PoseError' };
      case 'fail-moderation':
        return { ...base, state: 'failed', errorName: 'ContentModerationError' };
      case 'bad-output':
        return {
          ...base,
          state: 'completed',
          output: ['data:text/html;base64,PGgxPmhpPC9oMT4='],
          creditsUsed: 1,
        };
      case 'expired-output':
        return { ...base, state: 'completed', output: ['_expired'], creditsUsed: 1 };
      default: {
        if (!job.output && job.person && job.product) {
          job.output = await renderTestResult(job.person, job.product);
          job.person = null;
          job.product = null;
        }
        return { ...base, state: 'completed', output: job.output ? [job.output] : [], creditsUsed: 1 };
      }
    }
  }
}
