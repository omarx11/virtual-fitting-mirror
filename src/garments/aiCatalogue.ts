/**
 * AI-mode catalogue. Generative try-on needs a PRODUCT PHOTOGRAPH of each garment variant, not 2D
 * anchors or a rigged 3D model, so this is an independent list. `liveGarmentId` links an entry to the
 * same product in the live 2D/3D catalogue where one exists; items may support only some modes.
 *
 * This module is plain data (no DOM, no Node): the backend imports it to resolve catalogue IDs to an
 * allowlisted image file, so the browser can never name an arbitrary path.
 *
 * The dresses, jumpsuits and thobes are real garments in product-only photos with NO person in them
 * (an on-model photo lets the provider copy the model's face and accessories onto the user); the
 * V-necks are DEMO renders of the 3D model (sources in assets/garments/ai/SOURCE.md). Colour variants
 * need their own photo: changing a 3D material does not change an AI product photograph.
 */
import type { AiGarmentCategory, AiGarmentPhotoType } from '../ai/types';

/** Who a garment is cut for (shown as a small icon in the picker). */
export type AiGarmentAudience = 'women' | 'men';

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
  audience: AiGarmentAudience;
  /** Where the photo came from and what it may be used for. */
  provenance: string;
  /** True for placeholder/synthetic images that do not represent a real shop product. */
  demo: boolean;
  /** The same product in the live 2D/3D catalogue, if any. */
  liveGarmentId: string | null;
}

const RENDER_NOTE =
  'Synthetic render of the rigged 3D V-neck model (no fabric texture) — demo only, not a shop photo.';
const PRODUCT_NOTE = 'Product photo supplied by the project owner — a real garment, not a product sold here.';

type EntryOptions = Pick<
  AiGarmentDefinition,
  'category' | 'photoType' | 'audience' | 'demo' | 'liveGarmentId'
>;

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

/** A real one-piece garment in a product-only photo (flat-lay / ghost mannequin, no person). */
const ONE_PIECE = {
  category: 'one-pieces',
  photoType: 'flat-lay',
  demo: false,
  liveGarmentId: null,
} as const;
const WOMENS = { ...ONE_PIECE, audience: 'women' } as const;
const MENS = { ...ONE_PIECE, audience: 'men' } as const;
/** A render of the live 3D V-neck (the men's cut of the model, shirt-male.glb). */
const VNECK = {
  category: 'tops',
  photoType: 'flat-lay',
  audience: 'men',
  demo: true,
  liveGarmentId: 'vneck-3d',
} as const;

export const AI_GARMENTS: readonly AiGarmentDefinition[] = [
  // Women's
  entry(
    'dress-green-lace',
    'dress-lace',
    'green',
    'Green lace dress',
    'Women’s puff-sleeve lace dress',
    PRODUCT_NOTE,
    WOMENS,
  ),
  entry(
    'dress-teal-floral',
    'dress-wrap',
    'teal-floral',
    'Teal floral dress',
    'Women’s floral wrap midi dress',
    PRODUCT_NOTE,
    WOMENS,
  ),
  entry(
    'dress-cream-botanical',
    'dress-midi',
    'cream-botanical',
    'Cream botanical dress',
    'Women’s printed midi dress with gathered waist',
    PRODUCT_NOTE,
    WOMENS,
  ),
  entry(
    'jumpsuit-navy-sequin',
    'jumpsuit-sequin',
    'navy',
    'Navy sequin jumpsuit',
    'Women’s wrap jumpsuit with sequin top and tie belt',
    PRODUCT_NOTE,
    WOMENS,
  ),
  entry(
    'jumpsuit-black-dot',
    'jumpsuit-mesh',
    'black-dot',
    'Black polka-dot jumpsuit',
    'Women’s wide-leg jumpsuit with dotted mesh sleeves',
    PRODUCT_NOTE,
    WOMENS,
  ),
  // Men's
  entry('thobe-white', 'thobe', 'white', 'Saudi thobe', 'Men’s white collared thobe', PRODUCT_NOTE, MENS),
  entry(
    'thobe-gold-trim',
    'thobe-round-neck',
    'white-gold',
    'Gold-trim thobe',
    'Men’s white round-neck thobe with gold trim',
    PRODUCT_NOTE,
    MENS,
  ),
  entry('vneck-stone', 'vneck', 'stone', 'V-neck · Stone', 'Rolled-sleeve V-neck', RENDER_NOTE, VNECK),
  entry('vneck-navy', 'vneck', 'navy', 'V-neck · Navy', 'Rolled-sleeve V-neck', RENDER_NOTE, VNECK),
];

export const DEFAULT_AI_GARMENT_ID = AI_GARMENTS[0]?.id ?? '';

export function findAiGarment(id: string | null | undefined): AiGarmentDefinition | null {
  return AI_GARMENTS.find((g) => g.id === id) ?? null;
}
