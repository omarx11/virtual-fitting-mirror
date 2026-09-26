import type { Garment3DStatus } from '../app/MirrorEngine';
import { findMaterial } from '../garments/catalogue';
import type { GarmentDefinition } from '../garments/types';

export function GarmentPicker({
  garments,
  selectedId,
  onSelect,
  materialId,
  onMaterial,
  status3d,
  onRetry3d,
}: {
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
  return (
    <fieldset className="garments">
      <legend className="section-title">Shirts</legend>
      <div className="garment-grid">
        {garments.map((g) => (
          <button
            key={g.id}
            type="button"
            className="garment"
            aria-pressed={g.id === selectedId}
            onClick={() => onSelect(g.id)}
            title={g.description}
          >
            <img src={`${import.meta.env.BASE_URL}${g.preview}`} alt="" width={72} height={72} />
            <span>{g.name}</span>
            {g.kind === '3d' && <span className="badge">3D</span>}
          </button>
        ))}
      </div>
      {selected?.kind === '3d' && (
        <div className="swatches" role="radiogroup" aria-label="Fabric colour">
          {selected.materials.map((m) => (
            // biome-ignore lint/a11y/useSemanticElements: a styled swatch button with radio semantics.
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === material?.id}
              className="swatch"
              title={m.label}
              onClick={() => onMaterial(m.id)}
            >
              <span className="swatch-chip" style={{ background: m.color }} aria-hidden />
              <span>{m.label}</span>
            </button>
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
