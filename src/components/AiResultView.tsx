import {
  Camera,
  Columns2,
  LoaderCircle,
  LogOut,
  RotateCcw,
  Shirt,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { AiTryOnController, AiViewState } from '../ai/controller';
import { AI_PROVIDER_RETENTION_URL } from '../ai/types';

const STAGE_LABELS: Record<string, string> = {
  submitting: 'Uploading your photo to the AI service…',
  queued: 'Waiting in the AI service queue…',
  generating: 'Generating your preview…',
};

function Elapsed({ startedAt, now }: { startedAt: number; now: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  return <span data-testid="ai-elapsed">{Math.max(0, (now() - startedAt) / 1000).toFixed(0)} s</span>;
}

function Still({ src, mirror, alt, testId }: { src: string; mirror: boolean; alt: string; testId: string }) {
  return (
    <motion.img
      className={mirror ? 'ai-still mirrored' : 'ai-still'}
      src={src}
      alt={alt}
      data-testid={testId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}

/** Entrance for the floating action bar at the bottom of the stage. */
const barMotion = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring', stiffness: 320, damping: 30 },
} as const;

function ConsentDialog({
  testProvider,
  onAccept,
  onDecline,
}: {
  testProvider: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.div
      className="ai-consent"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <span className="ai-consent-icon" aria-hidden>
        <Sparkles size={22} />
      </span>
      <h2 id="ai-consent-title">Send your photo for an AI preview?</h2>
      {testProvider && (
        <p className="ai-test-note">
          Test mode: the offline fake provider is active. Nothing leaves this computer and the result is not
          AI.
        </p>
      )}
      <p>
        Your captured photo and the garment image are sent to <strong>FASHN</strong>, a cloud AI service, to
        generate one still image. Nothing is uploaded until you agree.
      </p>
      <details>
        <summary>What happens to the photo?</summary>
        <ul>
          <li>
            This device keeps the photo and result only in memory and deletes them when you end the session.
          </li>
          <li>
            FASHN deletes its temporary copy of the photo after processing; the generated image stays
            retrievable there for up to 60 minutes, and request records (without images) are kept. FASHN
            states it does not train on customer content.
          </li>
          <li>Ending the session here cannot delete data already held by FASHN.</li>
        </ul>
        <a href={AI_PROVIDER_RETENTION_URL} target="_blank" rel="noreferrer noopener">
          FASHN data retention &amp; privacy
        </a>
      </details>
      <div className="ai-actions">
        <button type="button" className="button" onClick={onDecline}>
          Not now
        </button>
        <button type="button" className="button primary" onClick={onAccept}>
          Agree &amp; generate
        </button>
      </div>
    </motion.div>
  );
}

/**
 * The AI stage: guidance + Capture over the plain live video, then the captured still, progress,
 * and the generated result with a before/after comparison. Both stills use the same box and the
 * same single mirror transform, so the comparison lines up without distorting either image.
 */
export function AiResultView({
  state,
  controller,
  mirror,
  canCapture,
  onCapture,
  onRetake,
  onEndSession,
  now,
}: {
  state: AiViewState;
  controller: AiTryOnController;
  mirror: boolean;
  canCapture: boolean;
  onCapture: () => void;
  onRetake: () => void;
  onEndSession: () => void;
  now: () => number;
}) {
  const [compare, setCompare] = useState<'after' | 'before' | 'split'>('after');
  const resultUrl = state.result?.url;
  // biome-ignore lint/correctness/useExhaustiveDependencies: every new result opens on the generated image.
  useEffect(() => setCompare('after'), [resultUrl]);

  const { phase, capture, result, job, error } = state;
  const active = phase === 'submitting' || phase === 'queued' || phase === 'generating';
  const garmentLabel = state.garment?.label ?? null;

  if (phase === 'inactive') return null;

  if (!capture) {
    // Live preview: plain video underneath, no garment drawn.
    return (
      <motion.div className="ai-bar" data-testid="ai-live-bar" {...barMotion}>
        {phase === 'checking' && <p className="hint">Checking the AI service…</p>}
        {phase === 'unconfigured' && (
          <p className="ai-bar-text">
            <TriangleAlert aria-hidden size={18} /> AI preview is unavailable on this device. See the panel
            for details.
          </p>
        )}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <p className="ai-bar-text">
              Face the camera with your upper body in view and your arms slightly away from your body, then
              take a photo.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error.message}
              </p>
            )}
            <button
              type="button"
              className="button primary large shutter"
              onClick={onCapture}
              disabled={!canCapture}
            >
              <Camera aria-hidden size={20} /> Capture photo
            </button>
          </>
        )}
      </motion.div>
    );
  }

  const showResult = phase === 'result' && result;
  return (
    <div className="ai-stage" data-testid="ai-stage">
      {/* A soft camera flash each time a new photo is taken. */}
      <motion.div
        key={capture.url}
        className="ai-flash"
        aria-hidden
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <div className={`ai-frame${showResult && compare === 'split' ? ' split' : ''}`}>
        {showResult ? (
          <>
            {(compare === 'before' || compare === 'split') && (
              <figure>
                <Still
                  src={capture.url}
                  mirror={mirror}
                  alt="Your photo before the AI preview"
                  testId="ai-before"
                />
                <figcaption>Before</figcaption>
              </figure>
            )}
            {(compare === 'after' || compare === 'split') && (
              <figure>
                <Still
                  src={result.url}
                  mirror={mirror}
                  alt={`AI-generated preview: ${result.garmentLabel}`}
                  testId="ai-result"
                />
                <figcaption>After</figcaption>
              </figure>
            )}
          </>
        ) : (
          <figure>
            <Still src={capture.url} mirror={mirror} alt="Your captured photo" testId="ai-capture" />
          </figure>
        )}
      </div>

      <div className="ai-label" data-testid="ai-label">
        {showResult ? (
          <>
            <Sparkles aria-hidden size={16} /> <strong>AI-generated preview</strong> · {result.garmentLabel}
            {result.testResult && <span className="badge badge-test">TEST RESULT · not AI</span>}
          </>
        ) : (
          <>
            <Camera aria-hidden size={16} /> Your photo{garmentLabel ? ` · ${garmentLabel}` : ''}
          </>
        )}
      </div>

      <AnimatePresence>
        {phase === 'consent' && (
          <ConsentDialog
            key="consent"
            testProvider={state.capabilities?.testProvider ?? false}
            onAccept={() => controller.acceptConsent()}
            onDecline={() => controller.declineConsent()}
          />
        )}
      </AnimatePresence>

      <motion.div className="ai-bar" {...barMotion}>
        {active && job && (
          <p className="ai-progress" role="status" aria-live="polite" data-testid="ai-progress">
            <LoaderCircle aria-hidden size={18} className="spin" /> {STAGE_LABELS[phase]}{' '}
            <Elapsed startedAt={job.startedAt} now={now} />
          </p>
        )}
        {active && <span className="progress-track" aria-hidden />}
        {state.notice && <p className="hint">{state.notice}</p>}
        {phase === 'error' && error && (
          <p className="error-text" role="alert" data-testid="ai-error">
            {error.message}
          </p>
        )}
        {showResult && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Compare">
              {(['before', 'after', 'split'] as const).map((v) => (
                // biome-ignore lint/a11y/useSemanticElements: a segmented control with radio semantics.
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={compare === v}
                  onClick={() => setCompare(v)}
                >
                  {compare === v && (
                    <motion.span
                      className="segment-pill"
                      layoutId="compare-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      aria-hidden
                    />
                  )}
                  <span className="segment-content">
                    {v === 'split' ? <Columns2 aria-hidden size={16} /> : null}
                    {v === 'before' ? 'Before' : v === 'after' ? 'After' : 'Side by side'}
                  </span>
                </button>
              ))}
            </div>
            <p className="hint">
              AI-generated: colours, logos, fit and details may differ from the real garment. Not a size
              guide.
            </p>
          </>
        )}
        <div className="ai-actions">
          <button type="button" className="button" onClick={onRetake}>
            <RotateCcw aria-hidden size={18} /> Retake
          </button>
          {showResult || phase === 'error' ? (
            <button type="button" className="button" onClick={() => controller.tryAnother()}>
              <Shirt aria-hidden size={18} /> Try another garment
            </button>
          ) : null}
          {!showResult && (
            <button
              type="button"
              className="button primary large"
              onClick={() => controller.requestGenerate()}
              disabled={active || phase === 'consent' || !controller.readyToGenerate()}
              title={garmentLabel ? undefined : 'Choose a garment first'}
            >
              <Sparkles aria-hidden size={20} /> {phase === 'error' ? 'Generate again' : 'Generate preview'}
            </button>
          )}
          {showResult && (
            <button type="button" className="button" onClick={onEndSession}>
              <LogOut aria-hidden size={18} /> End session
            </button>
          )}
        </div>
        {active && (
          <p className="hint">
            Retake stops waiting here; a request already sent may still be processed and counted.
          </p>
        )}
        {!showResult && !active && !garmentLabel && <p className="hint">Choose a garment in the panel.</p>}
      </motion.div>
    </div>
  );
}
