import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../server/ai/presets';

const inputs = {
  personDataUri: 'data:image/jpeg;base64,PERSON',
  productDataUri: 'data:image/jpeg;base64,PRODUCT',
  category: 'tops' as const,
  photoType: 'flat-lay' as const,
  seed: 1234,
};

describe('provider request schemas', () => {
  it('Try-On Max: fast, 1K, one JPEG output as base64, explicit generation mode', () => {
    const req = PRESETS['max-fast-1k'].build(inputs);
    expect(req).toEqual({
      model_name: 'tryon-max',
      inputs: {
        model_image: inputs.personDataUri,
        product_image: inputs.productDataUri,
        generation_mode: 'fast',
        resolution: '1k',
        num_images: 1,
        output_format: 'jpeg',
        return_base64: true,
        seed: 1234,
      },
    });
    // v1.6 parameter names must never be sent to Max; no prompt reshaping bodies/garments.
    for (const key of ['garment_image', 'mode', 'num_samples', 'category', 'garment_photo_type', 'prompt']) {
      expect(req.inputs).not.toHaveProperty(key);
    }
  });

  it('Try-On v1.6: performance, one sample, category and photo type from product metadata', () => {
    const req = PRESETS['v16-performance'].build({ ...inputs, category: 'one-pieces', photoType: 'model' });
    expect(req).toEqual({
      model_name: 'tryon-v1.6',
      inputs: {
        model_image: inputs.personDataUri,
        garment_image: inputs.productDataUri,
        category: 'one-pieces',
        garment_photo_type: 'model',
        mode: 'performance',
        num_samples: 1,
        output_format: 'jpeg',
        return_base64: true,
        seed: 1234,
      },
    });
    for (const key of ['product_image', 'generation_mode', 'num_images', 'resolution', 'moderation_level']) {
      expect(req.inputs).not.toHaveProperty(key);
    }
  });

  it('every preset reserves one credit for its single output', () => {
    for (const p of Object.values(PRESETS)) expect(p.credits).toBe(1);
  });
});
