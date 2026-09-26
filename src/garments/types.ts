/**
 * Garment catalogue types: an explicit discriminated union of legacy 2D image garments and rigged
 * 3D garments. "Left"/"right" are always the wearer's anatomical sides.
 *
 * 2D: anchors are normalized to the part image (0..1). In a front-view garment image the wearer's
 * LEFT shoulder is on the image's RIGHT.
 * 3D: a skinned glTF model plus a typed rig/calibration config (src/garments/rigs/*.ts).
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

/** 'front': only front-facing poses. 'modest-turns': validated partial turns (3D garments). */
export type GarmentView = 'front' | 'modest-turns';

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

interface GarmentBase {
  id: string;
  name: string;
  description: string;
  /** Thumbnail shown in the catalogue (path relative to the app base URL). */
  preview: string;
  supportedViews: GarmentView[];
  license: GarmentLicense;
  /** True for the original placeholder art shipped with this prototype. */
  demo: boolean;
}

export interface Garment2DDefinition extends GarmentBase {
  kind: '2d';
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
}

/** Selectable fabric colour/finish. No texture maps: none matching the model were supplied. */
export interface GarmentMaterialOption {
  id: string;
  label: string;
  /** sRGB hex colour of the fabric. */
  color: string;
  /** PBR roughness (fabric: high). */
  roughness: number;
  /** Subtle sheen for cotton-like fabric (0 = none). */
  sheen: number;
}

/** Per-side bone pair. */
export interface SidePair<T> {
  left: T;
  right: T;
}

/**
 * How a rigged garment's skeleton is found and driven. Bone names are matched with regular
 * expressions because exporters add numeric suffixes (e.g. `upperarm_l_010`).
 */
export interface GarmentRigConfig {
  bones: {
    pelvis: RegExp;
    /** Ordered from the pelvis upwards; the torso rotation is distributed over these. */
    spine: RegExp[];
    neck: RegExp | null;
    clavicle: SidePair<RegExp>;
    upperArm: SidePair<RegExp>;
    lowerArm: SidePair<RegExp>;
    /** Kept anatomically stable (follow the pelvis only); legs are not driven. */
    thigh: SidePair<RegExp>;
  };
  /**
   * Garment rest space: metres, +Y up, +X = wearer's LEFT, +Z = garment front. `restRotationDeg`
   * is a documented fixed rotation (XYZ Euler, degrees) from the model's skin space into that
   * convention, applied once at load. Identity when the asset already matches.
   */
  restRotationDeg: readonly [number, number, number];
  fit: {
    /** Garment shoulder span (between upper-arm bone heads) ÷ tracked shoulder width. */
    shoulderWidthScale: number;
    /** Shift along the image torso axis, in tracked shoulder widths (+ = down). */
    verticalOffset: number;
    /** Allowed torso stretch (spine bone offsets × factor) to follow the learned torso length. */
    torsoLengthRange: readonly [number, number];
    /** Garment neck-to-hem ÷ tracked torso length at factor 1 (visual target). */
    lengthScale: number;
  };
  limits: {
    /** Torso yaw beyond which the garment fades (degrees) and is hidden. */
    yawFadeStartDeg: number;
    yawHideDeg: number;
    /** Forward/back lean clamp (degrees). */
    maxPitchDeg: number;
    /** Largest allowed across-the-body upper-arm direction (dot with the outward axis). */
    armMinOutward: number;
    /** Angular speed bound for smoothed bone targets (degrees/second). */
    maxAngularSpeedDeg: number;
  };
  /** Clavicles lift a little when the upper arm rises above `startDeg` from hanging. */
  clavicleLift: { startDeg: number; factor: number; maxDeg: number };
}

/** Coarse cloth-proxy and solver settings for the optional physics mode. */
export interface GarmentSimulationConfig {
  /** Voxel edge (metres) for topology-aware clustering of render vertices into particles. */
  voxelSize: number;
  /** Rest distance (metres) from the neck/shoulder anchors within which particles are pinned. */
  pinnedRadius: number;
  /** Distance over which particles become free (smoothstep from pinnedRadius). */
  freeRadius: number;
  /** Maximum distance (metres) a fully free particle may deviate from its skinned position. */
  maxDeviation: number;
  /** XPBD compliances (0 = rigid). */
  stretchCompliance: number;
  shearCompliance: number;
  bendCompliance: number;
  linearDamping: number;
  iterations: number;
  gravityFactor: number;
  /** Particle collision radius (metres). */
  vertexRadius: number;
  /**
   * Invisible body colliders (rest-space metres), positioned from the posed garment bones every
   * step: two torso capsules side by side along the spine, and one capsule per upper arm.
   */
  colliders: { torsoRadius: number; torsoLateral: number; torsoForward: number; armRadius: number };
}

export interface Garment3DDefinition extends GarmentBase {
  kind: '3d';
  /** Runtime glTF binary (path relative to the app base URL). */
  model: string;
  /** Description of the source variant, shown in diagnostics (never as a sizing claim). */
  variant: string;
  rig: GarmentRigConfig;
  materials: readonly GarmentMaterialOption[];
  defaultMaterialId: string;
  /** Present when the garment supports the experimental cloth mode. */
  simulation?: GarmentSimulationConfig;
}

export type GarmentDefinition = Garment2DDefinition | Garment3DDefinition;
