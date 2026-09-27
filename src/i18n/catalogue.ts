/**
 * Translated catalogue text. The catalogues (src/garments/) stay plain data shared with the engine and
 * the backend; their English fields are the fallback for an ID the messages do not list.
 */
import type { AiGarmentChoice } from '../ai/controller';
import { type AiGarmentDefinition, findAiGarment } from '../garments/aiCatalogue';
import type { Garment2DDefinition, GarmentMaterialOption } from '../garments/types';
import type { Messages } from './en';

export function garmentText(m: Messages, g: { id: string; name: string; description: string }) {
  return m.garments.items[g.id] ?? { name: g.name, description: g.description };
}

export function swatchLabel(m: Messages, g: Garment2DDefinition): string {
  return m.garments.items[g.id]?.swatch ?? g.swatch.label;
}

export function materialLabel(m: Messages, material: GarmentMaterialOption): string {
  return m.garments.materials[material.id] ?? material.label;
}

export function aiGarmentText(m: Messages, g: AiGarmentDefinition) {
  return m.ai.items[g.id] ?? { label: g.label, description: g.description, provenance: g.provenance };
}

/** The shown name of the chosen AI garment (catalogue entries follow the language; uploads keep theirs). */
export function aiChoiceLabel(m: Messages, choice: AiGarmentChoice | null): string | null {
  if (!choice) return null;
  if (choice.kind === 'upload') return choice.label;
  const g = findAiGarment(choice.id);
  return g ? aiGarmentText(m, g).label : choice.label;
}
