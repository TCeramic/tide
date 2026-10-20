// src/packs/_compat/foliaTypes.ts
// 搬入的包里原本指向 folia 全局 types.ts 的 import 都改到这里。
import type { MotionValue } from './motion';

export type {
  LyricRuby,
  LyricSyllable,
  LyricAlternateText,
  Word,
  LyricBackgroundVocal,
  LyricAgent,
  Line,
  LyricData,
  Theme,
  DualTheme,
} from '@/core/types';
export * from '../sonnet/sonnetTuning';
export * from '../tempera/temperaTuning';

// folia 的音频频段形状；M4 由音频特征 provider 取代。
export interface AudioBands {
  bass: MotionValue<number>; // 20-150Hz
  lowMid: MotionValue<number>; // 150-400Hz
  mid: MotionValue<number>; // 400-1200Hz
  vocal: MotionValue<number>; // 1000-3500Hz
  treble: MotionValue<number>; // 3500Hz+
  spectrum?: MotionValue<Uint8Array<ArrayBuffer>>;
}
