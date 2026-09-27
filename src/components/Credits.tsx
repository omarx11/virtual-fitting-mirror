import { GraduationCap } from 'lucide-react';
import { motion } from 'motion/react';
import { BRAND } from '../app/brand';
import { useI18n } from '../i18n/I18nProvider';

/** Sidebar footer card: the university lockup and the builder's name. Opens the About dialog. */
export function CreditsCard({ onOpenAbout }: { onOpenAbout: () => void }) {
  const { m } = useI18n();
  const { brand } = m;
  return (
    <motion.button
      type="button"
      className="credits"
      onClick={onOpenAbout}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      aria-label={`${m.common.about}: ${brand.kindBy(brand.projectKind, brand.builder, brand.university)}`}
    >
      <span className="credits-logo">
        <img src={BRAND.universityLogo} alt="" width={360} height={107} decoding="async" />
      </span>
      <span className="credits-text">
        <span className="credits-kind">
          <GraduationCap aria-hidden size={15} /> {brand.projectKind}
        </span>
        <span className="credits-name">
          {brand.designedBy} <strong>{brand.builder}</strong>
        </span>
      </span>
    </motion.button>
  );
}
