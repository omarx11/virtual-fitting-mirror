import { Box, Shirt, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { TryOnMode } from '../app/preferences';

const MODES: { id: TryOnMode; label: string; hint: string; icon: ReactNode }[] = [
  { id: '2d', label: '2D', hint: 'Live · flat demo shirts', icon: <Shirt aria-hidden size={20} /> },
  { id: '3d', label: '3D', hint: 'Live · rigged 3D shirt', icon: <Box aria-hidden size={20} /> },
  { id: 'ai', label: 'AI', hint: 'Generated photo (cloud)', icon: <Sparkles aria-hidden size={20} /> },
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
  const groupRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<PillBox | null>(null);
  const placedMode = useRef<TryOnMode | null>(null);

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
  }, [mode]);

  return (
    <div
      ref={groupRef}
      className={compact ? 'mode-selector compact' : 'mode-selector'}
      role="radiogroup"
      aria-label="Try-on mode"
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
          {MODES.map((m) => (
            <span key={m.id} className="mode-pill-fill" data-mode={m.id} data-active={m.id === mode} />
          ))}
        </motion.span>
      )}
      {MODES.map((m) => (
        // biome-ignore lint/a11y/useSemanticElements: a large touch target with radio semantics.
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          aria-label={compact ? `${m.label} — ${m.hint}` : undefined}
          className="mode-option"
          data-mode={m.id}
          disabled={disabled}
          title={m.hint}
          onClick={() => {
            if (mode !== m.id) onChange(m.id);
          }}
        >
          <span className="mode-content">
            <span className="mode-icon">{m.icon}</span>
            <span className="mode-label">{m.label}</span>
            {!compact && <span className="mode-hint">{m.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
