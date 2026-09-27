import { Box, FlaskConical, GraduationCap, Info, ShieldCheck, Shirt, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';
import { Modal } from './ui/Modal';

const MODES = [
  {
    icon: <Shirt aria-hidden size={18} />,
    tone: 'pink',
    title: '2D live',
    text: 'Flat demo shirts follow your shoulders in real time.',
  },
  {
    icon: <Box aria-hidden size={18} />,
    tone: 'violet',
    title: '3D live',
    text: 'A rigged 3D shirt moves with your tracked skeleton, with optional fabric motion.',
  },
  {
    icon: <Sparkles aria-hidden size={18} />,
    tone: 'teal',
    title: 'AI photo',
    text: 'Take one photo and a cloud AI generates a still preview — only after you agree.',
  },
] as const;

const STACK = ['React', 'MediaPipe Pose', 'Three.js', 'Jolt Physics', 'Motion', 'FASHN AI'];

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="About this project" icon={<Info size={20} />} wide>
      <div className="about-hero">
        <div className="about-logo">
          <img src={BRAND.universityLogo} alt={BRAND.university} width={360} height={107} />
        </div>
        <p className="about-kind">
          <GraduationCap aria-hidden size={16} /> {BRAND.projectKind} · {BRAND.university}
        </p>
        <p className="about-title">
          Virtual <span className="gradient-text">Fitting Mirror</span>
        </p>
        <p className="about-builder">
          Designed &amp; built by <strong>{BRAND.builder}</strong>
        </p>
      </div>
      <ul className="about-modes">
        {MODES.map((m, i) => (
          <motion.li
            key={m.title}
            data-tone={m.tone}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.06 }}
          >
            <span className="section-icon" aria-hidden>
              {m.icon}
            </span>
            <span>
              <strong>{m.title}</strong>
              <span className="hint">{m.text}</span>
            </span>
          </motion.li>
        ))}
      </ul>
      <p className="about-privacy">
        <ShieldCheck aria-hidden size={18} />
        <span>
          2D and 3D run entirely on this device — video is never uploaded. Only AI mode sends one photo to the
          cloud, and only after you agree.
        </span>
      </p>
      <ul className="about-stack" aria-label="Built with">
        {STACK.map((s) => (
          <li key={s} className="tag">
            {s}
          </li>
        ))}
      </ul>
      <a className="button about-research" href="/research">
        <FlaskConical aria-hidden size={18} /> Research, testing &amp; limits
      </a>
    </Modal>
  );
}
