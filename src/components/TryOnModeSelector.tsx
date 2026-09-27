import { Box, Shirt, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { TryOnMode } from '../app/preferences';
import { useI18n } from '../i18n/I18nProvider';

/** Mode labels stay 2D / 3D / AI in every language; the hints are translated. */
const MODES: { id: TryOnMode; label: string; icon: ReactNode }[] = [
  { id: '2d', label: '2D', icon: <Shirt aria-hidden size={20} /> },
  { id: '3d', label: '3D', icon: <Box aria-hidden size={20} /> },
  { id: 'ai', label: 'AI', icon: <Sparkles aria-hidden size={20} /> },
];

interface PillBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Jump without animating (first placement, or the selector itself was resized). */
  instant: boolean;
}

/**
 * The explicit try-on mode selector. 2D and 3D are live previews; AI generates a still photo.
 * `compact` renders icon-only buttons for the folded sidebar rail / bar.
 *
 * The highlight is positioned inside the selector (offsets of the chosen button), not by a shared
 * layout animation: switching modes changes the sidebar's content, which can move the whole
 * selector on screen, and a screen-space animation would then drift in from the old position.
 */
export function TryOnModeSelector({
  mode,
  onChange,
  disabled = false,
  compact = false,
}: {
  mode: TryOnMode;
  onChange: (mode: TryOnMode) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { m, dir } = useI18n();
  const groupRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<PillBox | null>(null);
  const placedMode = useRef<TryOnMode | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `dir` too — switching language mirrors the buttons, so the highlight is placed again.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const measure = () => {
      const button = group.querySelector<HTMLElement>(`.mode-option[data-mode="${mode}"]`);
      if (!button) return;
      // Animate only when the selection changed; a resize just re-places the highlight.
      const instant = placedMode.current === null || placedMode.current === mode;
      placedMode.current = mode;
      // Sub-pixel box relative to the group (offsetLeft/offsetWidth round to whole pixels).
      const b = button.getBoundingClientRect();
      const g = group.getBoundingClientRect();
      setPill({
        x: b.left - g.left - group.clientLeft,
        y: b.top - g.top - group.clientTop,
        width: b.width,
        height: b.height,
        instant,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [mode, dir]);

  return (
    <div
      ref={groupRef}
      className={compact ? 'mode-selector compact' : 'mode-selector'}
      role="radiogroup"
      aria-label={m.modes.label}
    >
      {pill && (
        <motion.span
          className="mode-pill"
          aria-hidden
          initial={false}
          animate={{ x: pill.x, y: pill.y, width: pill.width, height: pill.height }}
          transition={pill.instant ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
        >
          {/* One fill per mode, cross-faded, so the colour blends while the highlight slides. */}
          {MODES.map((option) => (
            <span
              key={option.id}
              className="mode-pill-fill"
              data-mode={option.id}
              data-active={option.id === mode}
            />
          ))}
        </motion.span>
      )}
      {MODES.map((option) => {
        const hint = m.modes.hints[option.id];
        return (
          // biome-ignore lint/a11y/useSemanticElements: a large touch target with radio semantics.
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            aria-label={compact ? `${option.label} — ${hint}` : undefined}
            className="mode-option"
            data-mode={option.id}
            disabled={disabled}
            title={hint}
            onClick={() => {
              if (mode !== option.id) onChange(option.id);
            }}
          >
            <span className="mode-content">
              <span className="mode-icon">{option.icon}</span>
              <span className="mode-label">{option.label}</span>
              {!compact && <span className="mode-hint">{hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
