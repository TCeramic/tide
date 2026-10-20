// src/core/lyrics/load.ts
// 一个字幕文件 → LyricData。对应 folia LocalFileLyricAdapter 的判定顺序，外加 SRT / ASS：
//   .fia（folia 导出的 LyricData）→ awlrc 容器 → SRT/ASS → 其他格式（非 TTML 先拆混排的译文/罗马音）。
import type { Line, LyricData } from '@/core/types';
import { extractAwlrcContainer } from './awlrcContainer';
import { parseFoliaLyricDocument } from './foliaLyricDocument';
import { detectTimedLyricFormat, resolveExplicitFileTimedLyricFormat } from './formatDetection';
import { parseLyricsByFormat, type LyricParseFormat } from './parserCore';
import { detectSubtitleFormat, parseASS, parseSRT } from './subtitleFormats';
import { splitCombinedTimeline } from './timelineSplitter';

export type LoadedLyricFormat = LyricParseFormat | 'srt' | 'ass' | 'fia';

export interface LyricFileInput {
    fileName?: string;
    content: string;
    /** 单独上传的译文文件内容。 */
    translation?: string;
}

export interface LoadedLyrics {
    data: LyricData;
    format: LoadedLyricFormat;
}

export const loadLyricFile = ({ fileName, content, translation = '' }: LyricFileInput): LoadedLyrics => {
    const fia = parseFoliaLyricDocument(content);
    if (fia) return { data: fia, format: 'fia' };

    const container = extractAwlrcContainer(content);
    if (container?.awlrc || container?.lrc) {
        const tr = translation || container.tlrc || '';
        return container.awlrc
            ? { data: parseLyricsByFormat('awlrc', container.awlrc, tr, {}, container.rlrc || ''), format: 'awlrc' }
            : { data: parseLyricsByFormat('lrc', container.lrc!, tr, {}, container.rlrc || ''), format: 'lrc' };
    }

    const subtitle = detectSubtitleFormat(fileName, content);
    if (subtitle === 'srt') return { data: parseSRT(content, translation), format: 'srt' };
    if (subtitle === 'ass') return { data: parseASS(content, translation), format: 'ass' };

    const hint = resolveExplicitFileTimedLyricFormat(fileName);
    const format: LyricParseFormat = hint ?? detectTimedLyricFormat(content);
    if (format === 'ttml') return { data: parseLyricsByFormat('ttml', content), format };

    const { main, trans, romanization } = splitCombinedTimeline(content);
    const resolved: LyricParseFormat = hint ?? detectTimedLyricFormat(main);
    return {
        data: parseLyricsByFormat(resolved, main, translation || trans, {}, romanization),
        format: resolved,
    };
};

/** 纯音乐时的虚拟歌词：60 行 ♪，每 8 秒一行，持续 6 秒（同 folia）。 */
export const buildInstrumentalLines = (duration?: number | null): Line[] => {
    const count = duration && duration > 0 ? Math.max(1, Math.ceil(duration / 8)) : 60;
    return Array.from({ length: count }, (_, i) => ({
        id: `virtual-staff-${i}`,
        startTime: i * 8,
        endTime: i * 8 + 6,
        fullText: '♪',
        words: [],
        isChorus: false,
    }));
};

export const LYRIC_FILE_ACCEPT = '.lrc,.yrc,.qrc,.krc,.vtt,.ttml,.xml,.txt,.awlrc,.srt,.ass,.ssa,.fia';
