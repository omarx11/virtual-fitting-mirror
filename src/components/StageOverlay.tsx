import {
  ArrowRight,
  CircleCheck,
  FlaskConical,
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

/** Landmark dots the figure in the mirror is "tracked" with (viewBox units), and the bones between. */
const JOINTS = {
  nose: [100, 62],
  lShoulder: [72, 104],
  rShoulder: [128, 104],
  lElbow: [60, 160],
  rElbow: [140, 160],
  lWrist: [56, 208],
  rWrist: [144, 208],
  lHip: [82, 210],
  rHip: [118, 210],
} as const;
type Joint = keyof typeof JOINTS;
const BONES: readonly [Joint, Joint][] = [
  ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'],
  ['lElbow', 'lWrist'],
  ['rShoulder', 'rElbow'],
  ['rElbow', 'rWrist'],
  ['lShoulder', 'lHip'],
  ['rShoulder', 'rHip'],
  ['lHip', 'rHip'],
];

/**
 * The welcome screen's backdrop: a fitting room. Curtains and warm spotlights frame a tall arched
 * mirror with vanity bulbs; in the glass, a figure wears a shirt outline and is followed by pose
 * landmarks, as the app does. Decorative only (static with reduced motion).
 */
function FittingRoom() {
  return (
    <div className="fitting-room" aria-hidden>
      <span className="room-spot room-spot-a" />
      <span className="room-spot room-spot-b" />
      <span className="curtain curtain-left" />
      <span className="curtain curtain-right" />
      <span className="curtain-rod" />
      <div className="mirror">
        <span className="bulbs bulbs-left">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.6}s` }} />
          ))}
        </span>
        <span className="bulbs bulbs-right">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.6 + 0.3}s` }} />
          ))}
        </span>
        <div className="mirror-glass">
          <svg
            className="mirror-figure"
            viewBox="0 0 200 300"
            preserveAspectRatio="xMidYMax meet"
            aria-hidden
          >
            <defs>
              <linearGradient id="fitting-shirt" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff6fa5" />
                <stop offset="0.5" stopColor="#a07cff" />
                <stop offset="1" stopColor="#2fd6c1" />
              </linearGradient>
            </defs>
            <circle className="figure-body" cx="100" cy="62" r="22" />
            <path
              className="figure-body"
              d="M100 88c-10 0-14 6-30 12-12 5-16 14-17 28l-7 84c-1 7 9 9 11 2l9-74 4 88v72h60v-72l4-88 9 74c2 7 12 5 11-2l-7-84c-1-14-5-23-17-28-16-6-20-12-30-12z"
            />
            <path
              className="figure-shirt"
              d="M72 102c10-4 17-8 20-12 2 8 14 8 16 0 3 4 10 8 20 12l24 44-16 9-8-12v86H72v-86l-8 12-16-9z"
            />
            {BONES.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                className="figure-bone"
                x1={JOINTS[a][0]}
                y1={JOINTS[a][1]}
                x2={JOINTS[b][0]}
                y2={JOINTS[b][1]}
              />
            ))}
            {(Object.keys(JOINTS) as Joint[]).map((j, i) => (
              <circle
                key={j}
                className="figure-joint"
                cx={JOINTS[j][0]}
                cy={JOINTS[j][1]}
                r="3.2"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
          </svg>
          <motion.span
            className="mirror-sheen"
            initial={{ x: '-160%' }}
            animate={{ x: ['-160%', '260%'] }}
            transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 5, ease: 'easeInOut' }}
          />
        </div>
      </div>
      <span className="room-floor" />
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
          <FittingRoom />
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
            <motion.a variants={item} className="hero-research" href="/research">
              <FlaskConical aria-hidden size={16} /> {m.welcome.research}
              <ArrowRight aria-hidden size={16} className="rtl-flip" />
            </motion.a>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
