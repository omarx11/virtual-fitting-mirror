import {
  Camera,
  Columns2,
  Download,
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
import { aiChoiceLabel } from '../i18n/catalogue';
import { useI18n } from '../i18n/I18nProvider';

function Elapsed({ startedAt, now }: { startedAt: number; now: () => number }) {
  const { m } = useI18n();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span data-testid="ai-elapsed">{m.ai.seconds(Math.max(0, Math.round((now() - startedAt) / 1000)))}</span>
  );
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

/**
 * File name for a downloaded result, e.g. "fitting-mirror-white-thobe-2026-09-28-1412.jpg". The
 * server always re-encodes results as JPEG. Arabic letters are kept; only filename-unsafe characters go.
 */
function resultFileName(garment: string, at = new Date()): string {
  const slug = garment
    .toLowerCase()
    .replace(/[\\/:*?"<>|\s]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `fitting-mirror-${slug ? `${slug}-` : ''}${stamp}.jpg`;
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
  const { m } = useI18n();
  const body = m.ai.consentBody;
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
      <h2 id="ai-consent-title">{m.ai.consentTitle}</h2>
      {testProvider && <p className="ai-test-note">{m.ai.consentTest}</p>}
      <p>
        {body.pre}
        <strong>{body.accent}</strong>
        {body.post}
      </p>
      <details>
        <summary>{m.ai.consentMore}</summary>
        <ul>
          {m.ai.consentPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <a href={AI_PROVIDER_RETENTION_URL} target="_blank" rel="noreferrer noopener">
          {m.ai.consentLink}
        </a>
      </details>
      <div className="ai-actions">
        <button type="button" className="button" onClick={onDecline}>
          {m.ai.notNow}
        </button>
        <button type="button" className="button primary" onClick={onAccept}>
          {m.ai.agree}
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
  captureError = null,
  controller,
  mirror,
  canCapture,
  onCapture,
  onRetake,
  onEndSession,
  now,
}: {
  state: AiViewState;
  /** A capture problem found before anything reached the controller (shown in the live bar). */
  captureError?: string | null;
  controller: AiTryOnController;
  mirror: boolean;
  canCapture: boolean;
  onCapture: () => void;
  onRetake: () => void;
  onEndSession: () => void;
  now: () => number;
}) {
  const { m } = useI18n();
  const [compare, setCompare] = useState<'after' | 'before' | 'split'>('after');
  const resultUrl = state.result?.url;
  // biome-ignore lint/correctness/useExhaustiveDependencies: every new result opens on the generated image.
  useEffect(() => setCompare('after'), [resultUrl]);

  const { phase, capture, result, job, error } = state;
  const active = phase === 'submitting' || phase === 'queued' || phase === 'generating';
  // Changing the garment drops any result, so the current choice also names the shown result.
  const garmentLabel = aiChoiceLabel(m, state.garment);
  const errorText = error ? m.ai.error(error.code, error.message) : null;
  const payment = controller.payment();

  if (phase === 'inactive') return null;

  if (!capture) {
    const liveError = captureError ?? errorText;
    // Live preview: plain video underneath, no garment drawn.
    return (
      <motion.div className="ai-bar" data-testid="ai-live-bar" {...barMotion}>
        {phase === 'checking' && <p className="hint">{m.ai.checking}</p>}
        {phase === 'unconfigured' && (
          <p className="ai-bar-text">
            <TriangleAlert aria-hidden size={18} />{' '}
            {state.unavailable?.cause === 'not-deployed' ? m.ai.notDeployed : m.ai.unconfigured}
          </p>
        )}
        {(phase === 'ready' || phase === 'error') && (
          <>
            <p className="ai-bar-text">{m.ai.instructions}</p>
            {liveError && (
              <p className="error-text" role="alert">
                {liveError}
              </p>
            )}
            <button
              type="button"
              className="button primary large shutter"
              onClick={onCapture}
              disabled={!canCapture}
            >
              <Camera aria-hidden size={20} /> {m.ai.capture}
            </button>
          </>
        )}
      </motion.div>
    );
  }

  const showResult = phase === 'result' && result;
  const resultLabel = garmentLabel ?? result?.garmentLabel ?? '';
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
                <Still src={capture.url} mirror={mirror} alt={m.ai.beforeAlt} testId="ai-before" />
                <figcaption>{m.ai.before}</figcaption>
              </figure>
            )}
            {(compare === 'after' || compare === 'split') && (
              <figure>
                <Still src={result.url} mirror={mirror} alt={m.ai.afterAlt(resultLabel)} testId="ai-result" />
                <figcaption>{m.ai.after}</figcaption>
              </figure>
            )}
          </>
        ) : (
          <figure>
            <Still src={capture.url} mirror={mirror} alt={m.ai.captureAlt} testId="ai-capture" />
          </figure>
        )}
      </div>

      <div className="ai-label" data-testid="ai-label">
        {showResult ? (
          <>
            <Sparkles aria-hidden size={16} /> <strong>{m.ai.generatedLabel}</strong> · {resultLabel}
            {result.testResult && <span className="badge badge-test">{m.ai.testBadge}</span>}
          </>
        ) : (
          <>
            <Camera aria-hidden size={16} /> {m.ai.yourPhoto}
            {garmentLabel ? ` · ${garmentLabel}` : ''}
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
            <LoaderCircle aria-hidden size={18} className="spin" /> {m.ai.stages[phase]}{' '}
            <Elapsed startedAt={job.startedAt} now={now} />
          </p>
        )}
        {active && <span className="progress-track" aria-hidden />}
        {/* The controller's only notice is the reconnect message. */}
        {state.notice && <p className="hint">{m.ai.reconnecting}</p>}
        {phase === 'error' && errorText && (
          <p className="error-text" role="alert" data-testid="ai-error">
            {errorText}
          </p>
        )}
        {showResult && (
          <>
            <div className="segmented" role="radiogroup" aria-label={m.ai.compare}>
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
                    {v === 'before' ? m.ai.before : v === 'after' ? m.ai.after : m.ai.sideBySide}
                  </span>
                </button>
              ))}
            </div>
            <p className="hint">{m.ai.disclaimer}</p>
          </>
        )}
        <div className="ai-actions">
          <button type="button" className="button" onClick={onRetake}>
            <RotateCcw aria-hidden size={18} /> {m.ai.retake}
          </button>
          {showResult || phase === 'error' ? (
            <button type="button" className="button" onClick={() => controller.tryAnother()}>
              <Shirt aria-hidden size={18} /> {m.ai.tryAnother}
            </button>
          ) : null}
          {!showResult && (
            <button
              type="button"
              className="button primary large"
              onClick={() => controller.requestGenerate()}
              disabled={active || phase === 'consent' || !controller.readyToGenerate()}
              title={
                payment === 'key'
                  ? m.ai.keyFirst
                  : payment === 'access'
                    ? m.ai.accessFirst
                    : garmentLabel
                      ? undefined
                      : m.ai.chooseFirst
              }
            >
              <Sparkles aria-hidden size={20} /> {phase === 'error' ? m.ai.generateAgain : m.ai.generate}
            </button>
          )}
          {showResult && (
            <a
              className="button"
              href={result.url}
              download={resultFileName(resultLabel)}
              title={m.ai.downloadTitle}
              data-testid="ai-download"
            >
              <Download aria-hidden size={18} /> {m.ai.download}
            </a>
          )}
          {showResult && (
            <button type="button" className="button" onClick={onEndSession}>
              <LogOut aria-hidden size={18} className="rtl-flip" /> {m.common.endSession}
            </button>
          )}
        </div>
        {active && <p className="hint">{m.ai.retakeNote}</p>}
        {!showResult && !active && payment !== 'ok' && (
          <p className="hint">{payment === 'key' ? m.ai.keyFirst : m.ai.accessFirst}.</p>
        )}
        {!showResult && !active && payment === 'ok' && !garmentLabel && (
          <p className="hint">{m.ai.choosePanel}</p>
        )}
      </motion.div>
    </div>
  );
}
