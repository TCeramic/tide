// src/core/types.ts
// 从 folia src/types.ts 取出的歌词与主题类型子集（上游 commit 见 docs/vendor-manifest.json）。
import type { LineRenderHints } from './lyrics/renderHints';

export interface LyricRuby {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
}

export interface LyricSyllable {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  endsWithSpace?: boolean;
  ruby?: LyricRuby[];
  obscene?: boolean;
  emptyBeat?: number;
}

export interface LyricAlternateText {
  role: 'translation' | 'romanization' | string;
  language?: string;
  text: string;
  syllables?: LyricSyllable[];
}

export interface Word {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  syllables?: LyricSyllable[];
}

export interface LyricBackgroundVocal {
  text: string;
  startTime: number; // Seconds
  endTime: number; // Seconds
  words: Word[];
  agentId?: string;
  translation?: string;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
}

export interface LyricAgent {
  id: string;
  name?: string;
  type?: string;
}

export interface Line {
  words: Word[];
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  id?: string;
  agentId?: string;
  songPart?: string;
  blockIndex?: number;
  romanization?: string;
  alternateTexts?: LyricAlternateText[];
  backgroundVocal?: LyricBackgroundVocal;
  backgroundVocals?: LyricBackgroundVocal[];
  renderHints?: LineRenderHints;
  /**
   * lumisynth：歌词文件里这一行原来文字的哈希。改过字的行 fullText 变了，但锚点（编排、锁定、分段、
   * 素材片段都挂在行上）按它算，所以改字不会让任何东西失效。
   */
  sourceHash?: string;
  isChorus?: boolean;
  chorusEffect?: 'bars' | 'circles' | 'beams';
  // User-saved fine word boundaries for fullText, baked in upstream by the lyric setter.
  // join('') must equal fullText. When present it wins over Intl.Segmenter word segmentation.
  wordSegments?: string[];
}

export interface LyricData {
  lines: Line[];
  title?: string;
  artist?: string;
  isWordByWord?: boolean;
  ttml?: {
    timingMode?: 'Word' | 'Line';
    agents?: Record<string, LyricAgent>;
  };
}

export interface Theme {
  name: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: 'sans' | 'serif' | 'mono';
  fontFamily?: string;
  fontFamilyStack?: string[];
  fontWeight?: number;
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  wordColors?: { word: string; color: string; }[];
  lyricsIcons?: string[];
  provider?: string;
  description?: string;
}

export interface DualTheme {
  light: Theme;
  dark: Theme;
}
