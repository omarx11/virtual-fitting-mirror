import { VNECK_FEMALE_RIG, VNECK_RIG, VNECK_SIMULATION } from './rigs/vneck';
import type {
  Garment2DDefinition,
  Garment3DDefinition,
  GarmentDefinition,
  GarmentMaterialOption,
  SleevePart,
} from './types';

/**
 * Catalogue. The first entry is the rigged 3D V-neck (third-party asset, see
 * assets/garments/vneck/SOURCE.md). The four 2D garments are original placeholder artwork generated
 * by scripts/generate-garments.mjs (CC0-1.0), kept as a legacy comparison.
 */

const BODY = { width: 600, height: 720 };
const DEMO_LICENSE = {
  name: 'CC0-1.0',
  author: 'virtual-fitting-mirror project (original demo artwork)',
  notes: 'Placeholder garment drawn for this prototype; not a real product.',
};

/** Shared anchor geometry of the generated body images (see scripts/generate-garments.mjs). */
const DEMO_ANCHORS = {
  leftShoulder: { x: 425 / BODY.width, y: 120 / BODY.height },
  rightShoulder: { x: 175 / BODY.width, y: 120 / BODY.height },
  neck: { x: 300 / BODY.width, y: 95 / BODY.height },
  hem: { x: 300 / BODY.width, y: 680 / BODY.height },
};

const deg = (d: number) => (d * Math.PI) / 180;

function demoSleeves(id: string): { left: SleevePart; right: SleevePart } {
  const common = {
    width: 200,
    height: 170,
    pivot: { x: 100 / 200, y: 22 / 170 },
    axisAngle: Math.PI / 2,
    restOutward: deg(12),
    minOutward: deg(4),
    maxOutward: deg(150),
  };
  return {
    left: { ...common, src: `garments/${id}/sleeve-left.svg` },
    right: { ...common, src: `garments/${id}/sleeve-right.svg` },
  };
}

function demoGarment(
  id: string,
  name: string,
  description: string,
  swatch: Garment2DDefinition['swatch'],
  fit?: Partial<Garment2DDefinition['fit']>,
): Garment2DDefinition {
  return {
    kind: '2d',
    id,
    name,
    description,
    preview: `garments/${id}/preview.svg`,
    body: { src: `garments/${id}/body.svg`, ...BODY },
    sleeves: demoSleeves(id),
    anchors: DEMO_ANCHORS,
    fit: { widthScale: 1.18, lengthScale: 0.97, verticalOffset: -0.12, ...fit },
    supportedViews: ['front'],
    license: DEMO_LICENSE,
    demo: true,
    swatch,
  };
}

/** Neutral fabric colours. The model shipped without texture maps; see SOURCE.md. */
const FABRIC_COLOURS: readonly GarmentMaterialOption[] = [
  { id: 'stone', label: 'Stone', color: '#b9b2a6', roughness: 0.86, sheen: 0.25 },
  { id: 'navy', label: 'Navy', color: '#2c3a55', roughness: 0.86, sheen: 0.3 },
  { id: 'olive', label: 'Olive', color: '#5f6841', roughness: 0.88, sheen: 0.25 },
  { id: 'white', label: 'White', color: '#e8e6e1', roughness: 0.85, sheen: 0.2 },
];

export const VNECK_3D: Garment3DDefinition = {
  kind: '3d',
  id: 'vneck-3d',
  name: 'V-neck (3D)',
  description: 'V-neck shirt with rolled sleeves — rigged 3D model',
  preview: 'garments/3d/vneck/preview.png',
  model: 'garments/3d/vneck/shirt-male.glb',
  variant: 'Male source model (SM_Shirt_01_man), Fab conversion',
  rig: VNECK_RIG,
  materials: FABRIC_COLOURS,
  defaultMaterialId: 'stone',
  simulation: VNECK_SIMULATION,
  supportedViews: ['front', 'modest-turns'],
  license: {
    name: 'Third-party (Fab listing licence — see assets/garments/vneck/SOURCE.md)',
    author: 'Fab listing "Shirt V-neck with rolled sleeves"',
    url: 'https://www.fab.com/listings/c4079e06-cef5-440c-8963-e05fd9462828',
    notes: 'Not covered by the CC0 licence of the demo art. Redistribution terms follow the Fab licence.',
  },
  demo: false,
};

/** The same V-neck cut for women (female source model of the same Fab asset). */
export const VNECK_FEMALE_3D: Garment3DDefinition = {
  ...VNECK_3D,
  id: 'vneck-women-3d',
  name: 'V-neck women (3D)',
  description: 'Women’s V-neck with rolled sleeves — rigged 3D model',
  preview: 'garments/3d/vneck/preview-female.png',
  model: 'garments/3d/vneck/shirt-female.glb',
  variant: 'Female source model (SM_Shirt_01_woman), converted with FBX2glTF',
  rig: VNECK_FEMALE_RIG,
};

export const GARMENTS: readonly GarmentDefinition[] = [
  VNECK_3D,
  VNECK_FEMALE_3D,
  demoGarment('coral-crew-tee', 'Coral crew tee', 'Solid crew-neck T-shirt', {
    label: 'Coral',
    color: '#e8735f',
  }),
  demoGarment('breton-stripe-tee', 'Breton stripe', 'Striped boat-neck top', {
    label: 'Breton stripe',
    color: 'repeating-linear-gradient(180deg, #f4f1e8 0 4px, #1f2e5a 4px 7px)',
  }),
  demoGarment('chambray-button-shirt', 'Chambray shirt', 'Short-sleeve button-up with collar', {
    label: 'Chambray',
    color: '#6f95c2',
  }),
  demoGarment('forest-v-neck', 'Forest V-neck', 'V-neck T-shirt', { label: 'Forest', color: '#3f6b4f' }),
];

/**
 * Picker cards. Each 3D garment is its own card; the 2D demo garments are folded into a single
 * "Shirt (2D)" card whose colour swatches choose between their artworks.
 */
export interface GarmentCard {
  id: string;
  kind: GarmentDefinition['kind'];
  name: string;
  description: string;
  /** Catalogue garments selectable from this card (the first is the card's default). */
  garmentIds: readonly string[];
}

const FLAT_GARMENTS = GARMENTS.filter((g): g is Garment2DDefinition => g.kind === '2d');

export const GARMENT_CARDS: readonly GarmentCard[] = [
  ...GARMENTS.filter(isGarment3D).map((g) => ({
    id: g.id,
    kind: g.kind,
    name: g.name,
    description: g.description,
    garmentIds: [g.id],
  })),
  ...(FLAT_GARMENTS.length
    ? [
        {
          id: 'shirt-2d',
          kind: '2d' as const,
          name: 'Shirt (2D)',
          description: 'Flat demo artwork in several colours (legacy 2D comparison)',
          garmentIds: FLAT_GARMENTS.map((g) => g.id),
        },
      ]
    : []),
];

/** The picker card that contains a catalogue garment. */
export function findCard(garmentId: string): GarmentCard {
  const id = findGarment(garmentId).id;
  const card = GARMENT_CARDS.find((c) => c.garmentIds.includes(id)) ?? GARMENT_CARDS[0];
  if (!card) throw new Error('Garment catalogue is empty');
  return card;
}

export const DEFAULT_GARMENT_ID = GARMENTS[0]?.id ?? '';

export function findGarment(id: string | null | undefined): GarmentDefinition {
  const first = GARMENTS[0];
  if (!first) throw new Error('Garment catalogue is empty');
  return GARMENTS.find((g) => g.id === id) ?? first;
}

export function isGarment3D(g: GarmentDefinition): g is Garment3DDefinition {
  return g.kind === '3d';
}

export function findMaterial(garment: Garment3DDefinition, id: string | null | undefined) {
  const fallback = garment.materials.find((m) => m.id === garment.defaultMaterialId) ?? garment.materials[0];
  if (!fallback) throw new Error(`Garment ${garment.id} has no material options`);
  return garment.materials.find((m) => m.id === id) ?? fallback;
}
