/**
 * Resolves AI catalogue IDs to product photos. Only IDs listed in src/garments/aiCatalogue.ts are
 * accepted, each maps to a fixed file under the catalogue root (public/ in development, the built
 * dist/ in production), and the resolved path must stay inside that root. The browser can never
 * name a file path or URL, and the server never fetches remote images.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { type AiGarmentDefinition, findAiGarment } from '../../src/garments/aiCatalogue';
import { AppError } from './errors';
import { type ImageLimits, type NormalizedImage, normalizeImage } from './images';

export class CatalogueStore {
  private cache = new Map<string, Promise<NormalizedImage>>();

  constructor(
    private readonly root: string,
    private readonly limits: ImageLimits,
  ) {}

  garment(id: string): AiGarmentDefinition {
    const garment = findAiGarment(id);
    if (!garment) throw new AppError('unknown-garment', 400, 'That garment is not in the AI catalogue.');
    return garment;
  }

  /** Normalized product image for a catalogue ID (shop assets, not customer data: cached). */
  async productImage(id: string): Promise<NormalizedImage> {
    const garment = this.garment(id);
    let pending = this.cache.get(garment.id);
    if (!pending) {
      pending = this.load(garment);
      this.cache.set(garment.id, pending);
      pending.catch(() => this.cache.delete(garment.id));
    }
    return pending;
  }

  private async load(garment: AiGarmentDefinition): Promise<NormalizedImage> {
    const path = resolve(this.root, garment.productImage);
    const rel = relative(this.root, path);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
      throw new AppError('unknown-garment', 400, 'That garment image is not available.');
    }
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      throw new AppError('unknown-garment', 503, 'That garment image is missing on this device.');
    }
    return normalizeImage(data, this.limits);
  }
}
