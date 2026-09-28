/**
 * AI-mode catalogue. Generative try-on needs a PRODUCT PHOTOGRAPH of each garment variant, not 2D
 * anchors or a rigged 3D model, so this is an independent list. `liveGarmentId` links an entry to the
 * same product in the live 2D/3D catalogue where one exists; items may support only some modes.
 *
 * This module is plain data (no DOM, no Node): the backend imports it to resolve catalogue IDs to an
 * allowlisted image file, so the browser can never name an arbitrary path.
 *
 * The dresses, thobe and fanila are real garments worn by models in free-licence stock photos; the
 * V-necks are DEMO renders of the 3D model (sources in assets/garments/ai/SOURCE.md). Colour variants
 * need their own photo: changing a 3D material does not change an AI product photograph.
 */
import type { AiGarmentCategory, AiGarmentPhotoType } from '../ai/types';

export interface AiGarmentDefinition {
  /** Catalogue entry ID (product + variant). Also the folder under public/garments/ai/. */
  id: string;
  productId: string;
  variantId: string;
  label: string;
  description: string;
  /** Thumbnail for the picker (path relative to the app base URL). */
  preview: string;
  /** Product photo sent to the provider (path relative to public/ and the built dist/). */
  productImage: string;
  category: AiGarmentCategory;
  photoType: AiGarmentPhotoType;
  /** Where the photo came from and what it may be used for. */
  provenance: string;
  /** True for placeholder/synthetic images that do not represent a real shop product. */
  demo: boolean;
  /** The same product in the live 2D/3D catalogue, if any. */
  liveGarmentId: string | null;
}

const RENDER_NOTE =
  'Synthetic render of the rigged 3D V-neck model (no fabric texture) — demo only, not a shop photo.';
const PHOTO_NOTE = (site: string, photographer: string) =>
  `Stock photo by ${photographer} (${site} licence) — a real garment, not a product sold here.`;

type EntryOptions = Pick<AiGarmentDefinition, 'category' | 'photoType' | 'demo' | 'liveGarmentId'>;

function entry(
  id: string,
  productId: string,
  variantId: string,
  label: string,
  description: string,
  provenance: string,
  options: EntryOptions,
): AiGarmentDefinition {
  return {
    id,
    productId,
    variantId,
    label,
    description,
    preview: `garments/ai/${id}/preview.jpg`,
    productImage: `garments/ai/${id}/product.jpg`,
    provenance,
    ...options,
  };
}

/** A real garment worn by a model in a stock photo. */
const ON_MODEL = { photoType: 'model', demo: false, liveGarmentId: null } as const;
/** A render of the live 3D V-neck. */
const VNECK = { category: 'tops', photoType: 'flat-lay', demo: true, liveGarmentId: 'vneck-3d' } as const;

export const AI_GARMENTS: readonly AiGarmentDefinition[] = [
  entry(
    'dress-green',
    'dress-green',
    'green',
    'Green dress',
    'Long-sleeve ruched midi dress',
    PHOTO_NOTE('Pexels', 'Vika Kirillova'),
    {
      ...ON_MODEL,
      category: 'one-pieces',
    },
  ),
  entry(
    'dress-purple',
    'dress-purple',
    'purple',
    'Purple gown',
    'Long gown with flared sleeves',
    PHOTO_NOTE('Pexels', 'abubakar mamman'),
    {
      ...ON_MODEL,
      category: 'one-pieces',
    },
  ),
  entry(
    'thobe-white',
    'thobe',
    'white',
    'Saudi thobe',
    'White men’s thobe',
    PHOTO_NOTE('Unsplash', 'Abdulrhman Alkhnaifer'),
    {
      ...ON_MODEL,
      category: 'one-pieces',
    },
  ),
  entry(
    'fanila-white',
    'fanila',
    'white',
    'Fanila',
    'White sleeveless undershirt',
    PHOTO_NOTE('Pexels', 'Sharon Snider'),
    {
      ...ON_MODEL,
      category: 'tops',
    },
  ),
  entry('vneck-stone', 'vneck', 'stone', 'V-neck · Stone', 'Rolled-sleeve V-neck', RENDER_NOTE, VNECK),
  entry('vneck-navy', 'vneck', 'navy', 'V-neck · Navy', 'Rolled-sleeve V-neck', RENDER_NOTE, VNECK),
];

export const DEFAULT_AI_GARMENT_ID = AI_GARMENTS[0]?.id ?? '';

export function findAiGarment(id: string | null | undefined): AiGarmentDefinition | null {
  return AI_GARMENTS.find((g) => g.id === id) ?? null;
}
