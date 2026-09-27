import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { Garment3DStatus } from '../app/MirrorEngine';
import { findCard, findMaterial, GARMENT_CARDS } from '../garments/catalogue';
import type { Garment2DDefinition, GarmentDefinition } from '../garments/types';

/** The accent ring on the selected card; it glides between cards when the selection changes. */
export function SelectedRing({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      className="garment-ring"
      layoutId={layoutId}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      aria-hidden
    >
      <span className="garment-check">
        <Check size={12} strokeWidth={3} />
      </span>
    </motion.span>
  );
}

function SwatchChip({ color, checked }: { color: string; checked: boolean }) {
  return (
    <span className="swatch-chip" style={{ background: color }} aria-hidden>
      {checked && (
        <motion.span
          className="swatch-dot"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 24 }}
        />
      )}
    </span>
  );
}

export function GarmentPicker({
  kind,
  garments,
  selectedId,
  onSelect,
  materialId,
  onMaterial,
  status3d,
  onRetry3d,
}: {
  /** The live mode: only this kind's shirts are listed. */
  kind: GarmentDefinition['kind'];
  garments: readonly GarmentDefinition[];
  selectedId: string;
  onSelect: (id: string) => void;
  materialId: string;
  onMaterial: (id: string) => void;
  status3d: Garment3DStatus;
  onRetry3d: () => void;
}) {
  const selected = garments.find((g) => g.id === selectedId);
  const material = selected?.kind === '3d' ? findMaterial(selected, materialId) : null;
  const selectedCard = findCard(selectedId);
  // Remember the last colour chosen on a multi-colour card so re-selecting the card restores it.
  const lastChoice = useRef(new Map<string, string>());
  useEffect(() => {
    lastChoice.current.set(selectedCard.id, selectedId);
  }, [selectedCard.id, selectedId]);
  const flatVariants =
    selected?.kind === '2d'
      ? selectedCard.garmentIds
          .map((id) => garments.find((g) => g.id === id))
          .filter((g): g is Garment2DDefinition => g?.kind === '2d')
      : [];
  return (
    <fieldset className="garments">
      <legend className="visually-hidden">Shirts</legend>
      <div className="garment-grid">
        {GARMENT_CARDS.filter((card) => card.kind === kind).map((card) => {
          const active = card.id === selectedCard.id;
          const shownId = active ? selectedId : (lastChoice.current.get(card.id) ?? card.garmentIds[0]);
          const shown = garments.find((g) => g.id === shownId);
          if (!shown) return null;
          return (
            <motion.button
              key={card.id}
              type="button"
              className="garment"
              aria-pressed={active}
              onClick={() => {
                if (!active) onSelect(shown.id);
              }}
              title={card.description}
              whileTap={{ scale: 0.95 }}
            >
              {active && <SelectedRing layoutId="garment-ring" />}
              <span className="garment-thumb">
                <img src={`${import.meta.env.BASE_URL}${shown.preview}`} alt="" width={72} height={72} />
              </span>
              <span className="garment-name">{card.name}</span>
            </motion.button>
          );
        })}
      </div>
      {selected?.kind === '3d' && (
        <div className="swatches" role="radiogroup" aria-label="Fabric colour">
          {selected.materials.map((m) => (
            <motion.button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === material?.id}
              className="swatch"
              title={m.label}
              onClick={() => onMaterial(m.id)}
              whileTap={{ scale: 0.94 }}
            >
              <SwatchChip color={m.color} checked={m.id === material?.id} />
              <span>{m.label}</span>
            </motion.button>
          ))}
        </div>
      )}
      {flatVariants.length > 1 && (
        <div className="swatches" role="radiogroup" aria-label="Shirt colour">
          {flatVariants.map((g) => (
            <motion.button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={g.id === selectedId}
              className="swatch"
              title={`${g.name} — ${g.description}`}
              onClick={() => onSelect(g.id)}
              whileTap={{ scale: 0.94 }}
            >
              <SwatchChip color={g.swatch.color} checked={g.id === selectedId} />
              <span>{g.swatch.label}</span>
            </motion.button>
          ))}
        </div>
      )}
      {status3d.state === 'loading' && (
        <p className="hint" role="status">
          Loading 3D shirt…
        </p>
      )}
      {status3d.state === 'error' && (
        <p className="error-text" role="alert">
          {status3d.fallback === 'legacy-2d'
            ? `3D unavailable (${status3d.message}). Showing a flat 2D fallback image — not 3D.`
            : `3D shirt unavailable: ${status3d.message}`}{' '}
          <button type="button" className="text-button" onClick={onRetry3d}>
            Retry
          </button>
        </p>
      )}
      <p className="hint">
        {selected?.kind === '3d'
          ? 'Neutral fabric colours; the model has no matching fabric texture yet.'
          : 'Flat demo artwork (legacy 2D comparison).'}
      </p>
    </fieldset>
  );
}
