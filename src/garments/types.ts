/**
 * Garment catalogue types. Anchors are normalized to the part image (0..1). "Left"/"right" are the
 * wearer's anatomical sides: in a front-view garment image the wearer's LEFT shoulder is on the
 * image's RIGHT. Replacing a demo asset with a real garment cutout only needs a transparent PNG/SVG
 * plus its anchors.
 */
export interface NormPoint {
  x: number;
  y: number;
}

export interface GarmentImage {
  /** Path relative to the app base URL (public/). */
  src: string;
  /** Intrinsic pixel size of the image. */
  width: number;
  height: number;
}

export interface SleevePart extends GarmentImage {
  /** Point of the sleeve image (normalized) attached to the body's shoulder anchor. */
  pivot: NormPoint;
  /** Direction (radians, image coordinates, y down) of the sleeve's long axis in the image. */
  axisAngle: number;
  /** Outward angle from the torso's "down" direction used when the elbow is not reliable (radians). */
  restOutward: number;
  /** Allowed outward range (radians); arms crossing inward are clamped at `minOutward`. */
  minOutward: number;
  maxOutward: number;
}

export type GarmentView = 'front';

export interface GarmentFitDefaults {
  /** Garment shoulder-seam span ÷ landmark shoulder width. Shoulder landmarks are joint centres,
   * so seams usually sit slightly outside them (> 1). */
  widthScale: number;
  /** Neck→hem distance ÷ estimated torso length. */
  lengthScale: number;
  /** Shift of the garment along the torso axis, in shoulder widths (+ = down). */
  verticalOffset: number;
}

export interface GarmentLicense {
  name: string;
  author: string;
  url?: string;
  notes?: string;
}

export interface GarmentDefinition {
  id: string;
  name: string;
  description: string;
  /** Thumbnail shown in the catalogue. */
  preview: string;
  body: GarmentImage;
  /** Optional separately articulated sleeves (demo assets). Real cutouts can bake sleeves in. */
  sleeves?: { left: SleevePart; right: SleevePart };
  anchors: {
    leftShoulder: NormPoint;
    rightShoulder: NormPoint;
    neck: NormPoint;
    hem: NormPoint;
  };
  fit: GarmentFitDefaults;
  supportedViews: GarmentView[];
  license: GarmentLicense;
  /** True for the original placeholder art shipped with this prototype. */
  demo: boolean;
}
