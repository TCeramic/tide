// src/packs/sonnet/sonnetTuning.ts
// 搬自 folia src/types.ts。

export type SonnetOuterFrameMode = 'none' | 'frame' | 'full';

export interface SonnetTuning {
  cameraIntensity: number;
  typographyMotion: number;
  mgDensity: number;
  showOnlyText: boolean;
  showGuide: boolean;
  showBackgroundMg: boolean;
  showFixedGeo: boolean;
  showGiantDecorativeText: boolean;
  showBackgroundDecor: boolean;
  enableTransitions: boolean;
  outerFrameMode: SonnetOuterFrameMode;
  textureResolution: number;
  /** Master switch for the scene-wide post-process stack (grain + contrast). */
  postProcessEnabled: boolean;
  /** Film grain amount, 0..1. */
  postProcessGrain: number;
  /** Contrast boost, 0..1. */
  postProcessContrast: number;
  /** Fixed print-style passes riding the master switch; strength sliders, 0 disables the pass. */
  postProcessRgbShift: number;
  postProcessHalftone: number;
  /** Vignette strength, 0..2 (2 = double the base darkening). */
  postProcessVignette: number;
  /** Radial lens curvature amount, 0..2. */
  postProcessLensDistortion: number;
  /** Radial chromatic dispersion amount, 0..1. */
  postProcessLensDispersion: number;
}

export const DEFAULT_SONNET_TUNING: SonnetTuning = {
  cameraIntensity: 1,
  typographyMotion: 1,
  mgDensity: 1,
  showOnlyText: false,
  showGuide: true,
  showBackgroundMg: true,
  showFixedGeo: true,
  showGiantDecorativeText: true,
  showBackgroundDecor: true,
  enableTransitions: true,
  outerFrameMode: 'full',
  textureResolution: 1.5,
  postProcessEnabled: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessHalftone: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3,
  postProcessLensDispersion: 0.6,
};
