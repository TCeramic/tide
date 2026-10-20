// 路线 A：两个包各跑各的 runtime，这里只做统一的挂载外壳（原 folia React 外壳的职责）。
// 引擎经 `@pack-src` 加载，截基线时它被 vite 指到 folia 原版目录（见 vite.config.ts）。
import type { Line, Theme } from '@/core/types';
import type { MotionValue } from '@/packs/_compat/motion';
import { DEFAULT_SONNET_TUNING, type SonnetTuning } from '@/packs/sonnet/sonnetTuning';
import { DEFAULT_TEMPERA_TUNING, type TemperaTuning } from '@/packs/tempera/temperaTuning';

export type PackId = 'sonnet' | 'tempera';

export interface PackRuntimeHandle {
  setPaused(paused: boolean): void;
  renderOnce(): void;
  destroy(): void;
}

export interface MountPackOptions {
  host: HTMLDivElement;
  lines: Line[];
  seed: string;
  theme: Theme;
  currentTime: MotionValue<number>;
  paused: boolean;
  title?: string | null;
  artist?: string | null;
  sonnetTuning?: SonnetTuning;
  temperaTuning?: TemperaTuning;
  coverColors?: string[];
  imageBlobs?: Map<string, Blob>;
  signal?: AbortSignal;
}

export async function mountPack(pack: PackId, options: MountPackOptions): Promise<PackRuntimeHandle> {
  const common = {
    host: options.host,
    songSeed: options.seed,
    theme: options.theme,
    currentTime: options.currentTime,
    lyricsFontScale: 1,
    staticMode: false,
    paused: options.paused,
    songTitle: options.title,
    songArtist: options.artist,
    signal: options.signal,
  };

  if (pack === 'sonnet') {
    const [{ SonnetPixiRuntime }, { compileSonnetProgram }] = await Promise.all([
      import('@pack-src/sonnet/createSonnetPixiRuntime'),
      import('@pack-src/sonnet/sonnetProgram'),
    ]);
    return SonnetPixiRuntime.create({
      ...common,
      program: compileSonnetProgram(options.lines, options.seed),
      tuning: options.sonnetTuning ?? DEFAULT_SONNET_TUNING,
      transparentBackground: false,
    });
  }

  const [{ TemperaPixiRuntime }, { compileTemperaProgram }] = await Promise.all([
    import('@pack-src/tempera/createTemperaPixiRuntime'),
    import('@pack-src/tempera/temperaProgram'),
  ]);
  const tuning = options.temperaTuning ?? DEFAULT_TEMPERA_TUNING;
  return TemperaPixiRuntime.create({
    ...common,
    program: compileTemperaProgram(options.lines, options.seed, { wholeLineLyrics: tuning.wholeLineLyrics }),
    tuning,
    coverColors: options.coverColors,
    imageBlobs: options.imageBlobs,
  });
}
