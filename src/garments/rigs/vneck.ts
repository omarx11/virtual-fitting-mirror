/**
 * Rig, calibration and simulation configuration for "Shirt V-neck with rolled sleeves" (male
 * source model, public/garments/3d/vneck/shirt-male.glb). Inspected with
 * `node scripts/inspect-garment.mjs public/garments/3d/vneck/shirt-male.glb`:
 *
 * - 130 nodes; one skin with 19 weighted joints (pelvis, spine_01..05, neck_01, clavicles, upper
 *   arms + two twist joints each, lower arms, thighs). Hands, fingers, calves, IK and helper nodes
 *   exist in the hierarchy but carry no weights.
 * - Every joint node has an IDENTITY local transform in the file; the bind pose exists only in the
 *   inverse bind matrices. The loader rebuilds bone rest transforms from them (modelLoader.ts).
 * - Skin space is metres, +Y up, +X = wearer's left, garment front toward +Z, so no rest rotation
 *   is needed. Upper-arm bone heads sit at x = ±0.190 m, y = 1.436 m (A-pose, arms ~55° down).
 *
 * All numbers below are visual calibration for this asset on the test clips (docs/TESTING.md), not
 * body measurements.
 */
import type { GarmentRigConfig, GarmentSimulationConfig } from '../types';

const suffix = '(?:_\\d+)*$';
const bone = (name: string) => new RegExp(`^${name}${suffix}`);

export const VNECK_RIG: GarmentRigConfig = {
  bones: {
    pelvis: bone('pelvis'),
    spine: [bone('spine_01'), bone('spine_02'), bone('spine_03'), bone('spine_04'), bone('spine_05')],
    neck: bone('neck_01'),
    clavicle: { left: bone('clavicle_l'), right: bone('clavicle_r') },
    upperArm: { left: bone('upperarm_l'), right: bone('upperarm_r') },
    lowerArm: { left: bone('lowerarm_l'), right: bone('lowerarm_r') },
    thigh: { left: bone('thigh_l'), right: bone('thigh_r') },
  },
  restRotationDeg: [0, 0, 0],
  fit: {
    shoulderWidthScale: 1.06,
    // The model has a stand collar: shifting the shoulder anchor slightly down keeps the collar at the
    // neck base instead of the chin (reviewed on the chest-up test clip).
    verticalOffset: 0.06,
    torsoLengthRange: [0.88, 1.15],
    lengthScale: 1,
  },
  limits: {
    yawFadeStartDeg: 50,
    yawHideDeg: 72,
    maxPitchDeg: 35,
    armMinOutward: -0.35,
    maxAngularSpeedDeg: 900,
  },
  clavicleLift: { startDeg: 70, factor: 0.25, maxDeg: 22 },
};

/**
 * Female source model (public/garments/3d/vneck/shirt-female.glb), converted from
 * SM_Shirt_01_woman.fbx with FBX2glTF and baked to the same layout as the male GLB by
 * scripts/bake-fbx-garment.mjs (metres, +Y up; rest-pose error < 0.1 mm). The skeleton uses the same
 * bone names (88 joints in the skin, the same 19 carry weights), so the male bone mapping applies.
 * Upper-arm heads sit at x = ±0.177 m, y = 1.319 m (shoulder span 0.354 m against 0.380 m).
 */
export const VNECK_FEMALE_RIG: GarmentRigConfig = VNECK_RIG;

export const VNECK_SIMULATION: GarmentSimulationConfig = {
  // ≈1,000 particles on this mesh (0.03 m ⇒ 1,354; 0.04 m ⇒ 791).
  voxelSize: 0.035,
  pinnedRadius: 0.1,
  freeRadius: 0.32,
  maxDeviation: 0.045,
  // Slightly compliant edges: linear-blend skinning compresses the target shape near joints; rigid
  // edges then fight the attachment limits (measured overshoot: 0.07 m at 0, 0.02 m at 1e-4). 5e-5 with
  // 8 iterations gave the lowest free-edge stretch (p99 1.17 median, 1.23 worst frame) in a ±40°,
  // 1.5 Hz turning stress test at the same cost (docs/TESTING.md).
  stretchCompliance: 5e-5,
  shearCompliance: 5e-5,
  bendCompliance: 2e-3,
  linearDamping: 0.35,
  iterations: 8,
  gravityFactor: 1,
  vertexRadius: 0.006,
  // The rest-pose shirt spans z −0.14…+0.16 m and x ±0.2 m at the chest; capsules stay inside it.
  colliders: { torsoRadius: 0.085, torsoLateral: 0.06, torsoForward: 0.015, armRadius: 0.04 },
};
