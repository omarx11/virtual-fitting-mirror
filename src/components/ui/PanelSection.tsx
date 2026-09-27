import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useId } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

export type SectionTone = 'pink' | 'violet' | 'blue' | 'teal' | 'amber';

/**
 * A sidebar card with a coloured icon chip and a title. Foldable sections use the accordion pattern
 * (a heading containing a button with aria-expanded) and animate their body height.
 */
export function PanelSection({
  title,
  icon,
  tone,
  collapsed = false,
  onToggle,
  aside,
  children,
}: {
  title: string;
  icon: ReactNode;
  tone: SectionTone;
  collapsed?: boolean;
  /** Omit for a section that cannot be folded. */
  onToggle?: () => void;
  /** Extra content on the right of the header (e.g. a status chip). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { rtl } = useI18n();
  const bodyId = useId();
  const open = !onToggle || !collapsed;
  const heading = (
    <>
      <span className="section-icon" aria-hidden>
        {icon}
      </span>
      <span className="section-name">{title}</span>
    </>
  );
  return (
    <section className="card" data-tone={tone} data-collapsed={!open}>
      <div className="card-header">
        <h2 className="card-title">
          {onToggle ? (
            <button
              type="button"
              className="card-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={onToggle}
            >
              {heading}
              <motion.span
                className="card-chevron"
                aria-hidden
                // Folded, the chevron points along the reading direction.
                animate={{ rotate: open ? 0 : rtl ? 90 : -90 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <ChevronDown size={18} />
              </motion.span>
            </button>
          ) : (
            <span className="card-toggle static">{heading}</span>
          )}
        </h2>
        {aside}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            className="card-body-clip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="card-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
