// src/packs/tempera/temperaTuning.ts
// 搬自 folia src/types.ts。

/**
 * `gradient` fills every tone shape with a four-colour ramp built from the cover art's
 * extracted colours mixed with the theme, instead of a flat tone.
 * `colorful` selects a coordinated four-stop gradient per shot while keeping themed paper
 * and ink. Its visual hue path is independent of the monotonic screentone ladder.
 */
export type TemperaColorMode = 'duo' | 'mono' | 'gradient' | 'colorful';

/** Where an image tends to sit; the exact spot is picked per shot from the seed. */
export type TemperaLayerImageAlign = 'left' | 'center' | 'right' | 'free';

/** Vertical counterpart to `TemperaLayerImageAlign`; `free` lets each shot choose a band. */
export type TemperaLayerImageVerticalAlign = 'top' | 'center' | 'bottom' | 'free';

/**
 * One image in the user's Tempera pool - character art, a logo, a texture. Each shot picks one
 * of them and places it itself, so an image carries a *tendency* rather than coordinates:
 * hand-placing every picture would defeat the point of a pool. The file itself sits in
 * IndexedDB under the same `id`, keeping the tuning small enough to sync.
 */
export interface TemperaLayerImage {
  id: string;
  name: string;
  align: TemperaLayerImageAlign;
  verticalAlign: TemperaLayerImageVerticalAlign;
  /** Height as a fraction of the viewport height; width follows the source aspect. */
  scale: number;
  opacity: number;
}

export const TEMPERA_MAX_LAYER_IMAGES = 16;

export const DEFAULT_TEMPERA_LAYER_IMAGE: Omit<TemperaLayerImage, 'id' | 'name'> = {
  align: 'free',
  // Preserve the original character-art composition, which placed images low in the frame.
  verticalAlign: 'bottom',
  scale: 0.7,
  opacity: 1,
};

export interface TemperaTuning {
  cameraIntensity: number;
  /** Per-glyph entrance motion strength, 0..2. */
  glyphMotion: number;
  /** Keep each source lyric line in one shot instead of slicing it into half-phrases. */
  wholeLineLyrics: boolean;
  /**
   * 逐字入场时序, 0..1. How much of the way to the shot's lyric end each glyph's entrance
   * stretches, past its 0.34s floor. 0 gives every glyph the same short window - percussive,
   * and the shot is fully at rest well before it cuts. 1 lands the whole shot exactly on its
   * lyric end - continuous, but nothing is ever still. See temperaLayout for the measurements.
   */
  glyphSettleStretch: number;
  /** duo uses theme hues; mono is grayscale; colorful assigns coordinated gradients per shot. */
  colorMode: TemperaColorMode;
  /**
   * 色彩饱和度 (lumisynth), 0..3. 1 is the original (folia) look; lumisynth defaults to 2.5,
   * since the original mixes the theme hues far into the paper and reads almost grey. Scales how far the derived colours
   * (blocks, screentone steps, gradient ramps) sit from grey while keeping each one's luminance,
   * so the tonal ladder, hatch density and text inversion are untouched. The theme's own paper,
   * ink stay as authored; theme accent stays as authored except in colorful. Colorful calibrates
   * 2.5 to its designed palette (0 is grey, 3 slightly more vivid). Mono ignores it.
   */
  colorSaturation: number;
  showBlocks: boolean;
  showDecor: boolean;
  /** 边角线框: the two registration marks in the top-left and bottom-right corners. */
  showCornerMarks: boolean;
  /**
   * 文字动态反色: the lyric samples the artwork under it and picks whichever of ink/paper
   * contrasts more, per pixel. This is how the mode colours type, not a post-process, so it
   * has its own switch rather than riding `postProcessEnabled`.
   */
  textInversion: boolean;
  /** Pool of user images; each shot picks one. The files themselves live in IndexedDB. */
  layerImages: TemperaLayerImage[];
  /** `back` lets the lyric invert against the picture; `front` puts it over the lyric. */
  layerImageDepth: 'back' | 'front';
  /** 0..1 chance that a given shot shows an image at all. */
  layerImageFrequency: number;
  enableTransitions: boolean;
  textureResolution: number;
  /** Master switch for the scene-wide post-process stack (grain + contrast + print passes). */
  postProcessEnabled: boolean;
  /**
   * 后处理纹理压缩: renders the post-process pass at 1x and stretches it onto the canvas
   * instead of running it at `textureResolution`. Costs sharpness on hatch, screentone and
   * type; buys back the fill rate a full-resolution full-screen pass costs.
   */
  postProcessTextureCompression: boolean;
  /** Film grain amount, 0..1. */
  postProcessGrain: number;
  /** Contrast boost, 0..1. */
  postProcessContrast: number;
  /** RGB shift pass strength, 0..1 (0 disables the pass). */
  postProcessRgbShift: number;
  /** Vignette strength, 0..2 (2 = double the base darkening). */
  postProcessVignette: number;
  /** Radial lens curvature amount, 0..2. */
  postProcessLensDistortion: number;
}

export const DEFAULT_TEMPERA_TUNING: TemperaTuning = {
  cameraIntensity: 1,
  glyphMotion: 1,
  wholeLineLyrics: false,
  glyphSettleStretch: 0.5,
  colorMode: 'colorful',
  colorSaturation: 2.5,
  showBlocks: true,
  showDecor: true,
  showCornerMarks: true,
  textInversion: true,
  layerImages: [],
  layerImageDepth: 'back',
  layerImageFrequency: 0.6,
  enableTransitions: true,
  textureResolution: 1.5,
  postProcessEnabled: true,
  postProcessTextureCompression: false,
  postProcessGrain: 0.2,
  postProcessContrast: 0,
  postProcessRgbShift: 0,
  postProcessVignette: 0.85,
  postProcessLensDistortion: 0.3,
};
