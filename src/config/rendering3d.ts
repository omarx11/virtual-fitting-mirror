/**
 * 3D garment rendering settings. The garment is rendered into its own transparent WebGL canvas in
 * SOURCE-FRAME proportions and composited into the visible 2D canvas with the same source→canvas
 * transform as the video (so mirroring, letterboxing, cropping and DPR apply exactly once).
 */
export const RENDER_3D = {
  /** Cap on the WebGL backing store (device px). Above this the garment is upscaled when drawn. */
  maxRenderPixels: 1920 * 1080,
  /** Multisampling on the garment canvas (edges against the video). */
  antialias: true,
  /**
   * What to show when WebGL cannot start. 'none' (default): a clear error and no garment.
   * 'legacy-2d': DEVELOPMENT fallback drawing the flat 2D V-neck image instead, always labelled
   * as a 2D fallback in the UI so it is never mistaken for 3D rendering.
   */
  webglFailureFallback: (import.meta.env.DEV ? 'legacy-2d' : 'none') as 'none' | 'legacy-2d',
  /** 2D garment used by the development fallback. */
  fallbackGarmentId: 'forest-v-neck',
  /** Lighting: soft hemisphere + one frontal key + a weak fill. No shadows, no tone mapping. */
  lights: {
    hemisphere: { sky: '#ffffff', ground: '#8f8a84', intensity: 1.15 },
    key: { color: '#ffffff', intensity: 1.55, direction: [0.35, 0.65, 1] as const },
    fill: { color: '#ffffff', intensity: 0.35, direction: [-0.7, 0.1, 0.6] as const },
  },
} as const;
