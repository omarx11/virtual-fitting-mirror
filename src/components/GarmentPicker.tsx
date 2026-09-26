import type { GarmentDefinition } from '../garments/types';

export function GarmentPicker({
  garments,
  selectedId,
  onSelect,
}: {
  garments: readonly GarmentDefinition[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
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
          </button>
        ))}
      </div>
      <p className="hint">Demo artwork — replace with real garment cutouts.</p>
    </fieldset>
  );
}
