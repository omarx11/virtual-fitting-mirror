import {
  CircleCheck,
  Info,
  LoaderCircle,
  RefreshCw,
  ScanFace,
  Shirt,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import type { EngineSnapshot } from '../app/MirrorEngine';
import { describeStatus, type StatusMessage } from '../app/statusMessages';
import { Accent } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { SourceControls } from './SourceControls';

function ToneIcon({ tone, loading }: { tone: StatusMessage['tone']; loading: boolean }) {
  if (loading) return <LoaderCircle aria-hidden size={18} className="spin" />;
  if (tone === 'ok') return <CircleCheck aria-hidden size={18} />;
  if (tone === 'info') return <Info aria-hidden size={18} />;
  return <TriangleAlert aria-hidden size={18} />;
}

/** Icon and colour of each welcome step; the text comes from `welcome.steps` in the same order. */
const STEPS = [
  { icon: <Video aria-hidden size={20} />, tone: 'blue' },
  { icon: <ScanFace aria-hidden size={20} />, tone: 'violet' },
  { icon: <Shirt aria-hidden size={20} />, tone: 'pink' },
] as const;

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

/** Slowly drifting colour glows behind the welcome screen (static with reduced motion). */
function Aurora() {
  return (
    <div className="aurora" aria-hidden>
      <motion.span
        className="blob blob-pink"
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="blob blob-violet"
        animate={{ x: [0, -50, 30, 0], y: [0, 30, -20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="blob blob-teal"
        animate={{ x: [0, 30, -40, 0], y: [0, 20, -30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

export function StageOverlay({
  snapshot,
  onRetryTracker,
  onOpenFile,
  onOpenCamera,
}: {
  snapshot: EngineSnapshot;
  onRetryTracker: () => void;
  onOpenFile: (file: File) => void;
  onOpenCamera: (deviceId?: string) => void;
}) {
  const { m } = useI18n();
  const status = describeStatus(snapshot, m.status);
  const loading = snapshot.tracker.state === 'loading' || snapshot.source.state === 'loading';
  const noSource = snapshot.source.state === 'none' || snapshot.source.state === 'error';
  return (
    <>
      <AnimatePresence>
        {status && (
          <motion.div
            key="status"
            className={`status-pill tone-${status.tone}`}
            role="status"
            aria-live="polite"
            data-testid="status"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <ToneIcon tone={status.tone} loading={loading} />
            <motion.div
              key={status.title}
              className="status-text"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <strong>{status.title}</strong>
              {status.detail && <span className="status-detail">{status.detail}</span>}
            </motion.div>
            {snapshot.tracker.state === 'error' && (
              <button type="button" className="button small" onClick={onRetryTracker}>
                <RefreshCw aria-hidden size={16} /> {m.common.retry}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* No exit animation: the welcome screen holds a file input and must leave immediately. */}
      {noSource && (
        <motion.div className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Aurora />
          <motion.div className="hero" variants={container} initial="hidden" animate="show">
            <motion.h1 variants={item}>
              <Accent text={m.welcome.title} />
            </motion.h1>
            <motion.p variants={item} className="hero-lead">
              {m.welcome.lead}
            </motion.p>
            <motion.div variants={item} className="hero-actions">
              <SourceControls status={snapshot.source} onOpenFile={onOpenFile} onOpenCamera={onOpenCamera} />
            </motion.div>
            {snapshot.tracker.state === 'error' && (
              <motion.p variants={item} className="error-text">
                {m.welcome.trackerFailed}{' '}
                {m.status.trackerError(snapshot.tracker.kind, snapshot.tracker.message)}{' '}
                <button type="button" className="text-button" onClick={onRetryTracker}>
                  {m.common.retry}
                </button>
              </motion.p>
            )}
            <motion.ol variants={item} className="hero-steps">
              {STEPS.map((s, i) => (
                <li key={s.tone} data-tone={s.tone}>
                  <span className="step-icon" aria-hidden>
                    <span className="section-icon">{s.icon}</span>
                    <span className="step-number">{i + 1}</span>
                  </span>
                  <span className="step-text">
                    <span className="step-title">{m.welcome.steps[i]?.title}</span>
                    <span className="step-detail">{m.welcome.steps[i]?.text}</span>
                  </span>
                </li>
              ))}
            </motion.ol>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
