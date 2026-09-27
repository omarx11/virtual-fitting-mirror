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
import './research.css';

/*
 * A short, visual summary of docs/RESEARCH.md, docs/TESTING.md and docs/LIMITATIONS.md, served at
 * /research. The numbers are copied from those files; update both together.
 */

type Tone = 'pink' | 'violet' | 'blue' | 'teal' | 'amber';

const STATS: { value: string; label: string; tone: Tone }[] = [
  { value: '218', label: 'automated tests', tone: 'pink' },
  { value: '28', label: 'browser tests on a real GPU', tone: 'violet' },
  { value: '30 fps', label: 'live tracking', tone: 'blue' },
  { value: '16 ms', label: 'to find a pose', tone: 'teal' },
  { value: '0', label: 'requests leave the device in 2D / 3D', tone: 'amber' },
  { value: '5 min', label: 'soak test, no memory growth', tone: 'pink' },
];

const PIPELINE: { icon: ReactNode; title: string; text: string; tone: Tone }[] = [
  { icon: <Camera size={20} />, title: 'Camera', text: 'Webcam or a video file', tone: 'pink' },
  {
    icon: <PersonStanding size={20} />,
    title: 'Pose model',
    text: '33 body points, in a background worker',
    tone: 'violet',
  },
  {
    icon: <BrainCircuit size={20} />,
    title: 'Interpreter',
    text: 'Facing me? Too close? Which person?',
    tone: 'blue',
  },
  { icon: <Shirt size={20} />, title: 'Garment', text: '2D art, rigged 3D shirt or cloth', tone: 'teal' },
  {
    icon: <FlipHorizontal2 size={20} />,
    title: 'Mirror',
    text: 'Drawn over the video, flipped',
    tone: 'amber',
  },
];

/** Median time per pose (ms) from docs/TESTING.md, 640×480 clip, Radeon RX 9070 XT. */
const BACKENDS = [
  { label: 'Lite model · GPU', ms: 14.9 },
  { label: 'Full model · GPU', ms: 16.4, chosen: true },
  { label: 'Lite model · CPU', ms: 37.8 },
  { label: 'Full model · CPU', ms: 47.1 },
];
const FRAME_BUDGET_MS = 33;
const CHART_MAX_MS = 60;

const CHOICES: { icon: ReactNode; title: string; why: string; tone: Tone }[] = [
  {
    icon: <Cpu size={18} />,
    title: 'Pose model: MediaPipe “Full” on the GPU',
    why: 'Keeps up with 30 fps video. The “Heavy” model is 3× larger (30.7 MB) and would gain nothing here.',
    tone: 'violet',
  },
  {
    icon: <Shirt size={18} />,
    title: 'Cloth: Jolt Physics',
    why: 'Passed all four trial tests: pinned points stay within 0.1 mm, stretch stays under 5%, and the cloth never passes through the body.',
    tone: 'teal',
  },
  {
    icon: <Cloud size={18} />,
    title: 'AI photo: FASHN cloud API',
    why: 'The strongest open models (CatVTON, IDM-VTON) are licensed for non-commercial use only. The cloud API also avoids a Python/GPU setup on the kiosk.',
    tone: 'pink',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'Privacy: block the tracker’s phone-home',
    why: 'MediaPipe quietly sends usage metrics to Google. We block them twice, and a test with the blocks removed proves the test really catches it.',
    tone: 'amber',
  },
];

const BUGS: { title: string; before: string; fix: string; tone: Tone }[] = [
  {
    title: 'The 35 cm blob',
    before: 'The 3D shirt loaded as a tiny crumpled ball: its bones had no resting pose.',
    fix: 'Rebuilt the rest pose from the bind matrices. It now matches the original model to within 0.1 mm.',
    tone: 'violet',
  },
  {
    title: 'A shirt on someone’s back',
    before: 'In a crowd clip, the shirt appeared on a man who was facing away.',
    fix: 'The face must now be visible before a shirt is drawn.',
    tone: 'pink',
  },
  {
    title: 'The burpee shirt',
    before: 'Bending over stretched a full-length shirt across the floor.',
    fix: 'Bending is now detected and the shirt politely hides.',
    tone: 'teal',
  },
  {
    title: 'Turning looked like bending',
    before: 'Starting already turned 45° was mistaken for leaning forward.',
    fix: 'Shoulder width is corrected for the turn before any check.',
    tone: 'blue',
  },
];

type Status = 'pass' | 'partial' | 'todo';
const STATUS: Record<Status, { icon: ReactNode; label: string }> = {
  pass: { icon: <CircleCheck size={16} />, label: 'Passed' },
  partial: { icon: <TriangleAlert size={16} />, label: 'Partly' },
  todo: { icon: <CircleX size={16} />, label: 'Not yet' },
};

const SCORECARD: { name: string; status: Status; note?: string }[] = [
  { name: 'Facing the camera, arms up and down', status: 'pass' },
  { name: 'Starting with hips out of frame', status: 'pass' },
  { name: 'Facing away: shirt hides', status: 'pass' },
  { name: 'Bending over: shirt hides', status: 'pass' },
  { name: 'Leaving and coming back', status: 'pass' },
  { name: 'Several people: keeps the right one', status: 'pass' },
  { name: 'Portrait kiosk, landscape, phone', status: 'pass' },
  { name: 'Nothing sent to the internet (2D / 3D)', status: 'pass' },
  { name: 'Walking closer and farther', status: 'partial', note: 'cropped clips only' },
  { name: 'Crossed arms in front of the chest', status: 'partial', note: 'simulated poses only' },
  { name: 'AI photo flow', status: 'partial', note: 'with a fake provider' },
  { name: 'A real webcam', status: 'todo' },
  { name: 'A real AI generation', status: 'todo', note: 'needs an API key' },
  { name: 'Firefox, Safari, other GPUs', status: 'todo' },
];

const LIMITS: { icon: ReactNode; title: string; text: string; tone: Tone }[] = [
  {
    icon: <Ruler size={18} />,
    title: 'Not a size tool',
    text: 'The shirt is scaled to look right, not measured.',
    tone: 'pink',
  },
  {
    icon: <Layers size={18} />,
    title: 'Your clothes can peek out',
    text: 'Long sleeves, collars and loose hems stay visible.',
    tone: 'violet',
  },
  {
    icon: <RotateCcw size={18} />,
    title: 'Face the mirror',
    text: 'Fades from about 50° of turn, hides past 72° and from behind.',
    tone: 'blue',
  },
  {
    icon: <Hand size={18} />,
    title: 'Arms overhead',
    text: 'Armpits stretch and sleeves bunch up.',
    tone: 'teal',
  },
  {
    icon: <Users size={18} />,
    title: 'One person at a time',
    text: 'In a crowd it fades out rather than jump to someone else.',
    tone: 'amber',
  },
  {
    icon: <Sparkles size={18} />,
    title: 'AI photo is a still',
    text: 'About 10 s per image, and it may change faces, logos or body shape.',
    tone: 'pink',
  },
];

const NEXT = [
  'Try a real webcam at the kiosk’s distance and lighting',
  'Measure speed on the actual kiosk PC',
  'Run one real AI generation and review it by eye',
  'Film crossed arms and slow full turns',
  'Test Firefox, Safari and other graphics cards',
];

const GALLERY: { src: string; w: number; h: number; alt: string; caption: string; wide?: boolean }[] = [
  {
    src: armsRaised,
    w: 1120,
    h: 477,
    alt: 'Two video frames: a man before tracking starts, then the same man wearing a blue 3D shirt with both arms raised',
    caption: 'Before the tracker locks on, and after: the sleeves follow raised arms.',
    wide: true,
  },
  {
    src: kioskOverlay,
    w: 840,
    h: 467,
    alt: 'Mirrored kiosk view with the tracked skeleton drawn over the 3D shirt',
    caption: 'Portrait kiosk, mirrored. The shirt’s shoulders (magenta) sit on the tracked ones.',
  },
  {
    src: backView,
    w: 1000,
    h: 396,
    alt: 'Eight frames of a man squatting with his back to the camera and no shirt drawn',
    caption: 'Back to the camera? The shirt stays hidden for the whole clip.',
  },
  {
    src: inspectionPoses,
    w: 1500,
    h: 234,
    alt: 'The 3D shirt in five poses: rest, left arm raised, both arms raised, arms forward, turned 30 degrees',
    caption: 'The real 3D model in five test poses: rest, left arm up, both up, arms forward, 30° turn.',
    wide: true,
  },
];

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.45, ease: 'easeOut' },
} as const;

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <motion.section className="rs-section" {...reveal}>
      <p className="rs-kicker">{kicker}</p>
      <h2>{title}</h2>
      {children}
    </motion.section>
  );
}

export function ResearchPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="research">
        <header className="rs-top">
          <a className="rs-back" href="/">
            <ArrowLeft aria-hidden size={18} /> Back to the mirror
          </a>
          <img src={BRAND.universityMark} alt={BRAND.university} width={40} height={25} />
        </header>

        <main className="rs-main">
          <motion.div className="rs-hero" {...reveal}>
            <p className="rs-kicker">Research · Testing · Limits</p>
            <h1>
              Behind the <span className="gradient-text">mirror</span>
            </h1>
            <p className="rs-lede">
              What we built, how we put it to the test, and where it still falls short. The honest, short
              version.
            </p>
          </motion.div>

          <ul className="rs-stats">
            {STATS.map((s, i) => (
              <motion.li
                key={s.label}
                data-tone={s.tone}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.06 }}
              >
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </motion.li>
            ))}
          </ul>

          <Section kicker="01 · How it works" title="From camera to mirror in five steps">
            <ol className="rs-pipeline">
              {PIPELINE.map((p) => (
                <li key={p.title} data-tone={p.tone}>
                  <span className="section-icon" aria-hidden>
                    {p.icon}
                  </span>
                  <strong>{p.title}</strong>
                  <span>{p.text}</span>
                </li>
              ))}
            </ol>
            <p className="rs-note">
              <ShieldCheck aria-hidden size={16} /> Everything above runs in the browser. Only the optional AI
              photo mode sends a picture to the cloud, and only after the shopper agrees.
            </p>
          </Section>

          <Section kicker="02 · Research" title="Choices we made, and why">
            <figure className="rs-chart">
              <figcaption>
                <strong>Time to find a pose</strong>
                <span>median milliseconds per frame · lower is better</span>
              </figcaption>
              <div className="rs-bars">
                <ul aria-label="Median time to find a pose">
                  {BACKENDS.map((b) => (
                    <li key={b.label} className="rs-bar-row" data-chosen={b.chosen || undefined}>
                      <span>
                        {b.label}
                        {b.chosen && <em className="rs-pick">our pick</em>}
                      </span>
                      <span className="rs-bar-track" title={`${b.label}: ${b.ms} ms`}>
                        <motion.span
                          className="rs-bar"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${(b.ms / CHART_MAX_MS) * 100}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                        />
                        <span className="rs-bar-value">{b.ms} ms</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <span
                  className="rs-budget"
                  style={{ '--at': FRAME_BUDGET_MS / CHART_MAX_MS } as CSSProperties}
                  aria-hidden
                >
                  <span className="rs-budget-label">33 ms = one video frame</span>
                </span>
              </div>
            </figure>
            <ul className="rs-cards">
              {CHOICES.map((c) => (
                <li key={c.title} data-tone={c.tone}>
                  <span className="section-icon" aria-hidden>
                    {c.icon}
                  </span>
                  <div>
                    <strong>{c.title}</strong>
                    <p>{c.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section kicker="03 · Testing" title="Bugs the tests caught">
            <ul className="rs-bugs">
              {BUGS.map((b) => (
                <li key={b.title} data-tone={b.tone}>
                  <span className="rs-stamp">Fixed</span>
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

          <Section kicker="04 · In pictures" title="What the tests looked like">
            <div className="rs-gallery">
              {GALLERY.map((g) => (
                <figure key={g.src} className={g.wide ? 'wide' : undefined}>
                  <img src={g.src} alt={g.alt} width={g.w} height={g.h} loading="lazy" decoding="async" />
                  <figcaption>{g.caption}</figcaption>
                </figure>
              ))}
            </div>
          </Section>

          <Section kicker="05 · Scorecard" title="What we checked on real footage">
            <ul className="rs-legend" aria-label="Legend">
              {(Object.keys(STATUS) as Status[]).map((k) => (
                <li key={k} data-status={k}>
                  {STATUS[k].icon} {STATUS[k].label}
                </li>
              ))}
            </ul>
            <ul className="rs-score">
              {SCORECARD.map((row) => (
                <li key={row.name} data-status={row.status}>
                  <span className="rs-status" title={STATUS[row.status].label}>
                    {STATUS[row.status].icon}
                    <span className="visually-hidden">{STATUS[row.status].label}:</span>
                  </span>
                  <span>
                    {row.name}
                    {row.note && <em> · {row.note}</em>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="rs-small">
              Windows 10 · Ryzen 9 5900X · Radeon RX 9070 XT · Chromium 153. Real footage: openly licensed
              clips from Wikimedia Commons.
            </p>
          </Section>

          <Section kicker="06 · Limitations" title="What it can’t do (yet)">
            <ul className="rs-limits">
              {LIMITS.map((l) => (
                <li key={l.title} data-tone={l.tone}>
                  <span className="section-icon" aria-hidden>
                    {l.icon}
                  </span>
                  <strong>{l.title}</strong>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section kicker="07 · Next" title="Still on the to-do list">
            <ul className="rs-next">
              {NEXT.map((n) => (
                <li key={n}>
                  <ListChecks aria-hidden size={17} /> {n}
                </li>
              ))}
            </ul>
          </Section>

          <footer className="rs-footer">
            <a className="button primary" href="/">
              Try the mirror <ArrowRight aria-hidden size={18} />
            </a>
            <p>
              {BRAND.projectKind} by <strong>{BRAND.builder}</strong> · {BRAND.university}. The full notes
              live in <code>docs/RESEARCH.md</code>, <code>docs/TESTING.md</code> and{' '}
              <code>docs/LIMITATIONS.md</code>.
            </p>
            <p className="rs-small">
              Screenshots adapt “Jumping jacks and burpees” by Taco fleur (CC BY-SA 4.0) and “Squat – exercise
              demonstration video” by FitnessScape (CC BY 3.0), both from Wikimedia Commons; the 3D shirt is a
              third-party Fab model. Details in <code>docs/images/ATTRIBUTION.md</code>.
            </p>
          </footer>
        </main>
      </div>
    </MotionConfig>
  );
}
