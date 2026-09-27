import { Box, FlaskConical, GraduationCap, Info, ShieldCheck, Shirt, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';
import { Accent } from '../i18n/format';
import { useI18n } from '../i18n/I18nProvider';
import { Modal } from './ui/Modal';

/** Icon and colour of each mode card; the text comes from `about.modes` in the same order. */
const MODES = [
  { icon: <Shirt aria-hidden size={18} />, tone: 'pink' },
  { icon: <Box aria-hidden size={18} />, tone: 'violet' },
  { icon: <Sparkles aria-hidden size={18} />, tone: 'teal' },
] as const;

const STACK = ['React', 'MediaPipe Pose', 'Three.js', 'Jolt Physics', 'Motion', 'FASHN AI'];

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { m } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={m.common.about} icon={<Info size={20} />} wide>
      <div className="about-hero">
        <div className="about-logo">
          <img src={BRAND.universityLogo} alt={m.brand.university} width={360} height={107} />
        </div>
        <p className="about-kind">
          <GraduationCap aria-hidden size={16} /> {m.brand.projectKind} · {m.brand.university}
        </p>
        <p className="about-title">
          <Accent text={m.brand.fullName} />
        </p>
        <p className="about-builder">
          {m.brand.designedBy} <strong>{m.brand.builder}</strong>
        </p>
      </div>
      <ul className="about-modes">
        {MODES.map((mode, i) => {
          const text = m.about.modes[i];
          return (
            <motion.li
              key={mode.tone}
              data-tone={mode.tone}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06 }}
            >
              <span className="section-icon" aria-hidden>
                {mode.icon}
              </span>
              <span>
                <strong>{text?.title}</strong>
                <span className="hint">{text?.text}</span>
              </span>
            </motion.li>
          );
        })}
      </ul>
      <p className="about-privacy">
        <ShieldCheck aria-hidden size={18} />
        <span>{m.about.privacy}</span>
      </p>
      <ul className="about-stack" aria-label={m.about.builtWith}>
        {STACK.map((s) => (
          <li key={s} className="tag" lang="en">
            {s}
          </li>
        ))}
      </ul>
      <a className="button about-research" href="/research">
        <FlaskConical aria-hidden size={18} /> {m.about.research}
      </a>
    </Modal>
  );
}
