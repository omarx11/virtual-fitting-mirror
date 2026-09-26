/** Loads the real runtime GLB from public/ for Node-side tests (no WebGL needed). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VNECK_3D } from '../../src/garments/catalogue';
import { type PreparedGarmentModel, parseGarmentModel } from '../../src/garments/modelLoader';

export const VNECK_GLB_PATH = join(process.cwd(), 'public', VNECK_3D.model);

let cached: Promise<PreparedGarmentModel> | null = null;

export function loadVneck(): Promise<PreparedGarmentModel> {
  if (!cached) {
    const buf = readFileSync(VNECK_GLB_PATH);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    cached = parseGarmentModel(bytes, VNECK_3D.rig);
  }
  return cached;
}
