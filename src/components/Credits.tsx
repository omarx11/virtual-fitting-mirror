import { GraduationCap } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';

/** Sidebar footer card: the university lockup and the builder's name. Opens the About dialog. */
export function CreditsCard({ onOpenAbout }: { onOpenAbout: () => void }) {
  return (
    <motion.button
      type="button"
      className="credits"
      onClick={onOpenAbout}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      aria-label={`About this project: ${BRAND.projectKind} by ${BRAND.builder}, ${BRAND.university}`}
    >
      <span className="credits-logo">
        <img src={BRAND.universityLogo} alt="" width={360} height={107} decoding="async" />
      </span>
      <span className="credits-text">
        <span className="credits-kind">
          <GraduationCap aria-hidden size={15} /> {BRAND.projectKind}
        </span>
        <span className="credits-name">
          Designed &amp; built by <strong>{BRAND.builder}</strong>
        </span>
      </span>
    </motion.button>
  );
}
