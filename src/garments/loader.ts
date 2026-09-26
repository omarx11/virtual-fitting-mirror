/**
 * Preloads garment images into ImageBitmaps (decoded once, cheap to draw every frame). SVGs are
 * rasterised at 2× their intrinsic size so they stay crisp when scaled up on large screens.
 */
import type { GarmentDefinition, GarmentImage } from './types';

export const RASTER_SCALE = 2;

export interface LoadedPart {
  bitmap: ImageBitmap;
  /** Intrinsic size used by the anchor math (bitmap may be larger by RASTER_SCALE). */
  width: number;
  height: number;
}

export interface LoadedGarment {
  definition: GarmentDefinition;
  body: LoadedPart;
  leftSleeve: LoadedPart | null;
  rightSleeve: LoadedPart | null;
}

async function loadPart(part: GarmentImage): Promise<LoadedPart> {
  const url = `${import.meta.env.BASE_URL}${part.src}`;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(`Could not decode garment image ${part.src}`);
  }
  const bitmap = await createImageBitmap(img, {
    resizeWidth: Math.round(part.width * RASTER_SCALE),
    resizeHeight: Math.round(part.height * RASTER_SCALE),
    resizeQuality: 'high',
  });
  return { bitmap, width: part.width, height: part.height };
}

export async function loadGarment(definition: GarmentDefinition): Promise<LoadedGarment> {
  const [body, leftSleeve, rightSleeve] = await Promise.all([
    loadPart(definition.body),
    definition.sleeves ? loadPart(definition.sleeves.left) : Promise.resolve(null),
    definition.sleeves ? loadPart(definition.sleeves.right) : Promise.resolve(null),
  ]);
  return { definition, body, leftSleeve, rightSleeve };
}

export function releaseGarment(garment: LoadedGarment): void {
  garment.body.bitmap.close();
  garment.leftSleeve?.bitmap.close();
  garment.rightSleeve?.bitmap.close();
}

/** Loads every catalogue garment; failures are reported per garment instead of failing all. */
export class GarmentLibrary {
  private loaded = new Map<string, LoadedGarment>();
  private errors = new Map<string, string>();
  private disposed = false;

  async preload(definitions: readonly GarmentDefinition[], onUpdate?: () => void): Promise<void> {
    await Promise.all(
      definitions.map(async (def) => {
        try {
          const garment = await loadGarment(def);
          if (this.disposed) {
            releaseGarment(garment);
            return;
          }
          this.loaded.set(def.id, garment);
          this.errors.delete(def.id);
        } catch (error) {
          this.errors.set(def.id, error instanceof Error ? error.message : String(error));
        }
        onUpdate?.();
      }),
    );
  }

  get(id: string): LoadedGarment | null {
    return this.loaded.get(id) ?? null;
  }

  error(id: string): string | null {
    return this.errors.get(id) ?? null;
  }

  dispose(): void {
    this.disposed = true;
    for (const garment of this.loaded.values()) releaseGarment(garment);
    this.loaded.clear();
  }
}
