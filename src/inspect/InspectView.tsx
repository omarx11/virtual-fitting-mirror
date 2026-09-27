/**
 * DEVELOPMENT-ONLY 3D garment inspection (open `/?inspect=3d` on the dev server).
 *
 * Renders the real runtime model through the same GarmentRenderer, retargeter and placement code as
 * the mirror, but from deterministic synthetic poses instead of tracking: neutral, each arm raised,
 * both arms raised, crossed forearms, turns and a lean, with skeleton / axes / bounding-box helpers.
 * Used to verify scale, axes, rest pose and bone influence, by e2e tests, and (with `&thumbnail`)
 * to render the catalogue thumbnail from the actual model.
 */

import { useEffect, useRef, useState } from 'react';
import { Quaternion, Vector3 } from 'three';
import type { SmoothedFit3D } from '../fitting/fit3d';
import { DEFAULT_USER_FIT } from '../fitting/garmentFit';
import { type BodyPose3D, neutralPose } from '../fitting/retargeter';
import { findMaterial, VNECK_3D } from '../garments/catalogue';
import { GarmentModelCache, type PreparedGarmentModel } from '../garments/modelLoader';
import type { RigModel } from '../garments/rigModel';
import { GarmentRenderer } from '../rendering/three/GarmentRenderer';

const W = 900;
const H = 1100;
const DEG = Math.PI / 180;

type PoseName =
  | 'rest (bind)'
  | 'neutral'
  | 'left arm raised'
  | 'right arm raised'
  | 'both arms raised'
  | 'arms forward, crossed'
  | 'turn left 30°'
  | 'turn right 30°'
  | 'lean 15°';

export const INSPECT_POSES: readonly PoseName[] = [
  'rest (bind)',
  'neutral',
  'left arm raised',
  'right arm raised',
  'both arms raised',
  'arms forward, crossed',
  'turn left 30°',
  'turn right 30°',
  'lean 15°',
];

const dir = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

/** Deterministic synthetic poses in rest space (+X = wearer's left). */
export function inspectPose(rig: RigModel, name: PoseName): BodyPose3D {
  const p = neutralPose(rig);
  const hang = (side: 'left' | 'right') => dir(side === 'left' ? 0.2 : -0.2, -1, 0.05);
  if (name !== 'rest (bind)') {
    for (const side of ['left', 'right'] as const) {
      p.arms[side].upper.copy(hang(side));
      p.arms[side].lower.copy(hang(side));
    }
  }
  const raise = (side: 'left' | 'right') => {
    const s = side === 'left' ? 1 : -1;
    p.arms[side].upper.copy(dir(s * 0.9, 0.35, 0.1));
    p.arms[side].lower.copy(dir(s * 0.5, 0.85, 0.05));
  };
  switch (name) {
    case 'left arm raised':
      raise('left');
      break;
    case 'right arm raised':
      raise('right');
      break;
    case 'both arms raised':
      raise('left');
      raise('right');
      break;
    case 'arms forward, crossed':
      p.arms.left.upper.copy(dir(0.15, -0.55, 0.8));
      p.arms.left.lower.copy(dir(-0.95, 0.05, 0.2));
      p.arms.right.upper.copy(dir(-0.15, -0.55, 0.8));
      p.arms.right.lower.copy(dir(0.95, 0.12, 0.2));
      break;
    case 'turn left 30°':
    case 'turn right 30°': {
      const q = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        (name.includes('left') ? 30 : -30) * DEG,
      );
      p.chest.copy(q);
      p.hips.copy(new Quaternion().slerp(q, 0.5));
      for (const side of ['left', 'right'] as const) {
        p.arms[side].upper.applyQuaternion(q);
        p.arms[side].lower.applyQuaternion(q);
      }
      break;
    }
    case 'lean 15°': {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 15 * DEG);
      p.chest.copy(q);
      p.hips.copy(new Quaternion().slerp(q, 0.4));
      for (const side of ['left', 'right'] as const) p.arms[side].upper.applyQuaternion(q);
      break;
    }
    default:
      break;
  }
  return p;
}

/** A fit that places the garment's shoulder midpoint at (cx, cy) with `pxPerMetre` scale. */
function syntheticFit(
  model: PreparedGarmentModel,
  pose: BodyPose3D,
  pxPerMetre: number,
  cx: number,
  cy: number,
) {
  const fit: SmoothedFit3D = {
    anchor: { x: cx, y: cy },
    down: { x: 0, y: 1 },
    pxPerMetre,
    bodyShoulderM: model.rig.shoulderSpan / VNECK_3D.rig.fit.shoulderWidthScale,
    pose,
    yawDeg: 0,
    confidence: 1,
    orientation: 'world',
    armState: { left: 'tracked', right: 'tracked' },
  };
  return fit;
}

export function InspectView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pose, setPose] = useState<PoseName>('neutral');
  const [helpers, setHelpers] = useState(true);
  // `&material=<id>` lets the asset scripts render each fabric colour from the actual model.
  const [material, setMaterial] = useState(
    () => findMaterial(VNECK_3D, new URLSearchParams(location.search).get('material')).id,
  );
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PreparedGarmentModel['stats'] | null>(null);
  const thumbnail = new URLSearchParams(location.search).has('thumbnail');
  const state = useRef<{ renderer: GarmentRenderer; model: PreparedGarmentModel } | null>(null);

  useEffect(() => {
    const cache = new GarmentModelCache();
    let renderer: GarmentRenderer | null = null;
    let cancelled = false;
    try {
      renderer = new GarmentRenderer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const r = renderer;
    cache
      .load(`${import.meta.env.BASE_URL}${VNECK_3D.model}`, VNECK_3D.rig)
      .then((model) => {
        if (cancelled) return;
        r.setGarment(
          VNECK_3D,
          model,
          findMaterial(VNECK_3D, new URLSearchParams(location.search).get('material')),
        );
        state.current = { renderer: r, model };
        setStats(model.stats);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      state.current = null;
      r.dispose();
      cache.dispose();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-render whenever the inspection inputs or the loaded model change.
  useEffect(() => {
    const s = state.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    s.renderer.setDebugHelpers(helpers && !thumbnail);
    s.renderer.setMaterial(findMaterial(VNECK_3D, material));
    const ppm = thumbnail ? 1150 : 900;
    const cy = thumbnail ? 130 : 260;
    const result = s.renderer.render({
      sourceWidth: W,
      sourceHeight: H,
      renderWidth: W,
      renderHeight: H,
      fit: syntheticFit(s.model, inspectPose(s.model.rig, pose), ppm, W / 2, cy),
      user: DEFAULT_USER_FIT,
      deformer: null,
    });
    const ctx = canvas.getContext('2d');
    if (!ctx || !result) return;
    ctx.clearRect(0, 0, W, H);
    if (!thumbnail) {
      ctx.fillStyle = '#3a3f47';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(result.canvas as CanvasImageSource, 0, 0, W, H);
    canvas.dataset.pose = pose;
    canvas.dataset.rendered = String(Number(canvas.dataset.rendered ?? '0') + 1);
  }, [pose, helpers, material, stats, thumbnail]);

  return (
    <div className="inspect">
      <canvas ref={canvasRef} width={W} height={H} className="inspect-canvas" data-testid="inspect-canvas" />
      {!thumbnail && (
        <aside className="panel inspect-panel">
          <h1>3D garment inspection (dev)</h1>
          {error && <p className="error-text">{error}</p>}
          {stats && (
            <p className="hint">
              {stats.triangles} triangles · {stats.vertices} vertices · {stats.joints} joints · {stats.nodes}{' '}
              nodes · rest error {(stats.restError * 1000).toFixed(3)} mm
            </p>
          )}
          <p className="hint">
            Rest space: metres, +Y up, +X = wearer's left (red axis), +Z = garment front (blue). The view is
            unmirrored: the wearer's left appears on the image right.
          </p>
          <div className="toggle-grid">
            {INSPECT_POSES.map((name) => (
              <button
                key={name}
                type="button"
                className="toggle"
                aria-pressed={name === pose}
                onClick={() => setPose(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={helpers} onChange={() => setHelpers(!helpers)} /> Skeleton, axes,
            bounds
          </label>
          <label className="inline-select">
            <span>Fabric</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value)}>
              {VNECK_3D.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </aside>
      )}
    </div>
  );
}
