import { Box, Shirt, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TryOnMode } from '../app/preferences';

const MODES: { id: TryOnMode; label: string; hint: string; icon: ReactNode }[] = [
  { id: '2d', label: '2D', hint: 'Live · flat demo shirts', icon: <Shirt aria-hidden size={18} /> },
  { id: '3d', label: '3D', hint: 'Live · rigged 3D shirt', icon: <Box aria-hidden size={18} /> },
  { id: 'ai', label: 'AI', hint: 'Generated photo (cloud)', icon: <Sparkles aria-hidden size={18} /> },
];

/** The explicit try-on mode selector. 2D and 3D are live previews; AI generates a still photo. */
export function TryOnModeSelector({
  mode,
  onChange,
  disabled = false,
}: {
  mode: TryOnMode;
  onChange: (mode: TryOnMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mode-selector" role="radiogroup" aria-label="Try-on mode">
      {MODES.map((m) => (
        // biome-ignore lint/a11y/useSemanticElements: a large touch target with radio semantics.
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          className="mode-option"
          disabled={disabled}
          title={m.hint}
          onClick={() => {
            if (mode !== m.id) onChange(m.id);
          }}
        >
          {m.icon}
          <span className="mode-label">{m.label}</span>
          <span className="mode-hint">{m.hint}</span>
        </button>
      ))}
    </div>
  );
}
