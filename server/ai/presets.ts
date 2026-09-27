/**
 * Generation presets → exact provider request bodies. The two FASHN models use DIFFERENT parameter
 * names (Max: product_image / generation_mode / num_images; v1.6: garment_image / mode / num_samples),
 * so each preset builds its own shape and never sends the other model's fields.
 *
 * Checked against the official docs on 2026-09-27:
 *   https://docs.fashn.ai/api-reference/tryon-max  — generation_mode fast|balanced|quality; unset is
 *     "automatic (currently billed as balanced)", so 'fast' is always sent explicitly. fast/1k = 1
 *     credit per image, ~10 s.
 *   https://docs.fashn.ai/api-reference/tryon-v1-6 — performance ≈ 5 s, 1 credit per image.
 * Provider safety settings are left at their defaults; no prompt is sent (no body/garment reshaping).
 */
import type { AiGarmentCategory, AiGarmentPhotoType, AiPresetId, AiPresetInfo } from '../../src/ai/types';

export interface PresetInputs {
  personDataUri: string;
  productDataUri: string;
  category: AiGarmentCategory;
  photoType: AiGarmentPhotoType;
  seed: number;
}

export interface ProviderRequest {
  model_name: 'tryon-max' | 'tryon-v1.6';
  inputs: Record<string, string | number | boolean>;
}

export interface PresetDefinition extends AiPresetInfo {
  build(inputs: PresetInputs): ProviderRequest;
}

export const PRESETS: Record<AiPresetId, PresetDefinition> = {
  'max-fast-1k': {
    id: 'max-fast-1k',
    label: 'Try-On Max · fast · 1K',
    model: 'tryon-max',
    credits: 1,
    build: ({ personDataUri, productDataUri, seed }) => ({
      model_name: 'tryon-max',
      inputs: {
        model_image: personDataUri,
        product_image: productDataUri,
        generation_mode: 'fast',
        resolution: '1k',
        num_images: 1,
        output_format: 'jpeg',
        return_base64: true,
        seed,
      },
    }),
  },
  'v16-performance': {
    id: 'v16-performance',
    label: 'Try-On v1.6 · performance (comparison)',
    model: 'tryon-v1.6',
    credits: 1,
    build: ({ personDataUri, productDataUri, category, photoType, seed }) => ({
      model_name: 'tryon-v1.6',
      inputs: {
        model_image: personDataUri,
        garment_image: productDataUri,
        category,
        garment_photo_type: photoType,
        mode: 'performance',
        num_samples: 1,
        output_format: 'jpeg',
        return_base64: true,
        seed,
      },
    }),
  },
};

export function presetInfo(id: AiPresetId): AiPresetInfo {
  const { build: _build, ...info } = PRESETS[id];
  return info;
}
