import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Bug,
  Camera,
  CircleCheck,
  CircleX,
  Cloud,
  Cpu,
  FlipHorizontal2,
  Hand,
  Layers,
  ListChecks,
  PersonStanding,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Shirt,
  Sparkles,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { BRAND } from '../app/brand';
import inspectionPoses from '../assets/research/3d-inspection-poses.webp';
import kioskOverlay from '../assets/research/3d-kiosk-mirrored-overlay.webp';
import armsRaised from '../assets/research/3d-upper-body-arms.webp';
import backView from '../assets/research/back-view-hidden.webp';
import { LanguageToggle } from '../components/LanguageToggle';
import { Accent, withCode } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { RESEARCH_MESSAGES, type ScoreStatus } from './messages';
import './research.css';

/*
 * A short, visual summary of docs/RESEARCH.md, docs/TESTING.md and docs/LIMITATIONS.md, served at
 * /research. The text is in ./messages.ts; the lists below hold the icons, colours and numbers in the
 * same order.
 */

type Tone = 'pink' | 'violet' | 'blue' | 'teal' | 'amber';

const STAT_TONES: Tone[] = ['pink', 'violet', 'blue', 'teal', 'amber', 'pink'];

const PIPELINE: { icon: ReactNode; tone: Tone }[] = [
  { icon: <Camera size={20} />, tone: 'pink' },
  { icon: <PersonStanding size={20} />, tone: 'violet' },
  { icon: <BrainCircuit size={20} />, tone: 'blue' },
  { icon: <Shirt size={20} />, tone: 'teal' },
  { icon: <FlipHorizontal2 size={20} />, tone: 'amber' },
];

/** Median time per pose (ms) from docs/TESTING.md, 640×480 clip, Radeon RX 9070 XT. */
const BACKEND_MS: { ms: number; chosen?: boolean }[] = [
  { ms: 14.9 },
  { ms: 16.4, chosen: true },
  { ms: 37.8 },
  { ms: 47.1 },
];
const FRAME_BUDGET_MS = 33;
const CHART_MAX_MS = 60;

const CHOICES: { icon: ReactNode; tone: Tone }[] = [
  { icon: <Cpu size={18} />, tone: 'violet' },
  { icon: <Shirt size={18} />, tone: 'teal' },
  { icon: <Cloud size={18} />, tone: 'pink' },
  { icon: <ShieldCheck size={18} />, tone: 'amber' },
];

const BUG_TONES: Tone[] = ['violet', 'pink', 'teal', 'blue'];

const STATUS_ICONS: Record<ScoreStatus, ReactNode> = {
  pass: <CircleCheck size={16} />,
  partial: <TriangleAlert size={16} />,
  todo: <CircleX size={16} />,
};

/** Result of each scorecard row, in the order of `scorecard` in the messages. */
const SCORECARD: ScoreStatus[] = [
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'pass',
  'partial',
  'partial',
  'partial',
  'partial',
  'todo',
  'todo',
];

const LIMITS: { icon: ReactNode; tone: Tone }[] = [
  { icon: <Ruler size={18} />, tone: 'pink' },
  { icon: <Layers size={18} />, tone: 'violet' },
  { icon: <RotateCcw size={18} />, tone: 'blue' },
  { icon: <Hand size={18} />, tone: 'teal' },
  { icon: <Users size={18} />, tone: 'amber' },
  { icon: <Sparkles size={18} />, tone: 'pink' },
];

const GALLERY: { src: string; w: number; h: number; wide?: boolean }[] = [
  { src: armsRaised, w: 1120, h: 477, wide: true },
  { src: kioskOverlay, w: 840, h: 467 },
  { src: backView, w: 1000, h: 396 },
  { src: inspectionPoses, w: 1500, h: 234, wide: true },
];

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.45, ease: 'easeOut' },
} as const;

function Section({ text, children }: { text: { kicker: string; title: string }; children: ReactNode }) {
  return (
    <motion.section className="rs-section" {...reveal}>
      <p className="rs-kicker">{text.kicker}</p>
      <h2>{text.title}</h2>
      {children}
    </motion.section>
  );
}

export function ResearchPage() {
  const { locale, m: app } = useI18n();
  const m = RESEARCH_MESSAGES[locale];
  const { brand } = app;
  return (
    <MotionConfig reducedMotion="user">
      <div className="research">
        <header className="rs-top">
          <a className="rs-back" href="/">
            <ArrowLeft aria-hidden size={18} className="rtl-flip" /> {m.back}
          </a>
          <span className="rs-top-end">
            <LanguageToggle className="button small lang-toggle" withIcon />
            <img src={BRAND.universityMark} alt={brand.university} width={40} height={25} />
          </span>
        </header>

        <main className="rs-main">
          <motion.div className="rs-hero" {...reveal}>
            <p className="rs-kicker">{m.kicker}</p>
            <h1>
              <Accent text={m.title} />
            </h1>
            <p className="rs-lede">{m.lede}</p>
          </motion.div>

          <ul className="rs-stats">
            {m.stats.map((s, i) => (
              <motion.li
                key={s.label}
                data-tone={STAT_TONES[i]}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.06 }}
              >
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </motion.li>
            ))}
          </ul>

          <Section text={m.sections.how}>
            <ol className="rs-pipeline">
              {PIPELINE.map((p, i) => (
                <li key={p.tone} data-tone={p.tone}>
                  <span className="section-icon" aria-hidden>
                    {p.icon}
                  </span>
                  <strong>{m.pipeline[i]?.title}</strong>
                  <span>{m.pipeline[i]?.text}</span>
                </li>
              ))}
            </ol>
            <p className="rs-note">
              <ShieldCheck aria-hidden size={16} /> {m.pipelineNote}
            </p>
          </Section>

          <Section text={m.sections.research}>
            <figure className="rs-chart">
              <figcaption>
                <strong>{m.chart.title}</strong>
                <span>{m.chart.subtitle}</span>
              </figcaption>
              <div className="rs-bars">
                <ul aria-label={m.chart.label}>
                  {BACKEND_MS.map((b, i) => {
                    const label = m.backends[i] ?? '';
                    return (
                      <li key={label} className="rs-bar-row" data-chosen={b.chosen || undefined}>
                        <span>
                          {label}
                          {b.chosen && <em className="rs-pick">{m.chart.pick}</em>}
                        </span>
                        <span className="rs-bar-track" title={`${label}: ${m.chart.ms(b.ms)}`}>
                          <motion.span
                            className="rs-bar"
                            initial={{ width: 0 }}
                            whileInView={{ width: `${(b.ms / CHART_MAX_MS) * 100}%` }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.7, ease: 'easeOut' }}
                          />
                          <span className="rs-bar-value">{m.chart.ms(b.ms)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <span
                  className="rs-budget"
                  style={{ '--at': FRAME_BUDGET_MS / CHART_MAX_MS } as CSSProperties}
                  aria-hidden
                >
                  <span className="rs-budget-label">{m.chart.budget}</span>
                </span>
              </div>
            </figure>
            <ul className="rs-cards">
              {CHOICES.map((c, i) => (
                <li key={c.tone} data-tone={c.tone}>
                  <span className="section-icon" aria-hidden>
                    {c.icon}
                  </span>
                  <div>
                    <strong>{m.choices[i]?.title}</strong>
                    <p>{m.choices[i]?.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section text={m.sections.testing}>
            <ul className="rs-bugs">
              {m.bugs.map((b, i) => (
                <li key={b.title} data-tone={BUG_TONES[i]}>
                  <span className="rs-stamp">{m.fixed}</span>
                  <strong>
                    <Bug className="rs-bug-icon" aria-hidden size={17} /> {b.title}
                  </strong>
                  <p>{b.before}</p>
                  <p className="rs-fix">
                    <Wrench aria-hidden size={15} />
                    <span>{b.fix}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section text={m.sections.pictures}>
            <div className="rs-gallery">
              {GALLERY.map((g, i) => (
                <figure key={g.src} className={g.wide ? 'wide' : undefined}>
                  <img
                    src={g.src}
                    alt={m.gallery[i]?.alt ?? ''}
                    width={g.w}
                    height={g.h}
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>{m.gallery[i]?.caption}</figcaption>
                </figure>
              ))}
            </div>
          </Section>

          <Section text={m.sections.scorecard}>
            <ul className="rs-legend" aria-label={m.legend}>
              {(Object.keys(STATUS_ICONS) as ScoreStatus[]).map((k) => (
                <li key={k} data-status={k}>
                  {STATUS_ICONS[k]} {m.status[k]}
                </li>
              ))}
            </ul>
            <ul className="rs-score">
              {m.scorecard.map((row, i) => {
                const status = SCORECARD[i] ?? 'todo';
                return (
                  <li key={row.name} data-status={status}>
                    <span className="rs-status" title={m.status[status]}>
                      {STATUS_ICONS[status]}
                      <span className="visually-hidden">{m.status[status]}:</span>
                    </span>
                    <span>
                      {row.name}
                      {row.note && <em> · {row.note}</em>}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="rs-small">{m.hardware}</p>
          </Section>

          <Section text={m.sections.limits}>
            <ul className="rs-limits">
              {LIMITS.map((l, i) => (
                <li key={m.limits[i]?.title} data-tone={l.tone}>
                  <span className="section-icon" aria-hidden>
                    {l.icon}
                  </span>
                  <strong>{m.limits[i]?.title}</strong>
                  <span>{m.limits[i]?.text}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section text={m.sections.next}>
            <ul className="rs-next">
              {m.next.map((n) => (
                <li key={n}>
                  <ListChecks aria-hidden size={17} /> {n}
                </li>
              ))}
            </ul>
          </Section>

          <footer className="rs-footer">
            <a className="button primary" href="/">
              {m.tryMirror} <ArrowRight aria-hidden size={18} className="rtl-flip" />
            </a>
            <p>
              {m.footerBy(brand.projectKind)} <strong>{brand.builder}</strong> · {brand.university}.{' '}
              {withCode(m.footerNotes)}
            </p>
            <p className="rs-small">{withCode(m.attribution)}</p>
          </footer>
        </main>
      </div>
    </MotionConfig>
  );
}
