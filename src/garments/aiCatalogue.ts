/**
 * AI-mode catalogue. Generative try-on needs a PRODUCT PHOTOGRAPH of each garment variant, not 2D
 * anchors or a rigged 3D model, so this is an independent list. `liveGarmentId` links an entry to the
 * same product in the live 2D/3D catalogue where one exists; items may support only some modes.
 *
 * This module is plain data (no DOM, no Node): the backend imports it to resolve catalogue IDs to an
 * allowlisted image file, so the browser can never name an arbitrary path.
 *
 * Every current entry is a DEMO stand-in (see assets/garments/ai/SOURCE.md). Colour variants need
 * their own photo: changing a 3D material does not change an AI product photograph.
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
const ART_NOTE = 'Rasterized from this project’s own CC0 demo artwork — not a real product.';

function entry(
  id: string,
  productId: string,
  variantId: string,
  label: string,
  description: string,
  provenance: string,
  liveGarmentId: string | null,
): AiGarmentDefinition {
  return {
    id,
    productId,
    variantId,
    label,
    description,
    preview: `garments/ai/${id}/preview.jpg`,
    productImage: `garments/ai/${id}/product.jpg`,
    category: 'tops',
    photoType: 'flat-lay',
    provenance,
    demo: true,
    liveGarmentId,
  };
}

export const AI_GARMENTS: readonly AiGarmentDefinition[] = [
  entry('vneck-stone', 'vneck', 'stone', 'V-neck · Stone', 'Rolled-sleeve V-neck', RENDER_NOTE, 'vneck-3d'),
  entry('vneck-navy', 'vneck', 'navy', 'V-neck · Navy', 'Rolled-sleeve V-neck', RENDER_NOTE, 'vneck-3d'),
  entry(
    'coral-crew-tee',
    'coral-crew-tee',
    'coral',
    'Coral crew tee',
    'Crew-neck T-shirt',
    ART_NOTE,
    'coral-crew-tee',
  ),
  entry(
    'breton-stripe-tee',
    'breton-stripe-tee',
    'stripe',
    'Breton stripe',
    'Striped boat-neck top',
    ART_NOTE,
    'breton-stripe-tee',
  ),
  entry(
    'chambray-button-shirt',
    'chambray-button-shirt',
    'chambray',
    'Chambray shirt',
    'Short-sleeve button-up',
    ART_NOTE,
    'chambray-button-shirt',
  ),
  entry(
    'forest-v-neck',
    'forest-v-neck',
    'forest',
    'Forest V-neck',
    'V-neck T-shirt',
    ART_NOTE,
    'forest-v-neck',
  ),
];

export const DEFAULT_AI_GARMENT_ID = AI_GARMENTS[0]?.id ?? '';

export function findAiGarment(id: string | null | undefined): AiGarmentDefinition | null {
  return AI_GARMENTS.find((g) => g.id === id) ?? null;
}
