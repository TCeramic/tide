// src/project/session.ts
// 不进工程文件的运行时数据：解码后的音频、特征轨、对象 URL、封面取色、编辑器选区。
// 都可以从工程 + 资源重新算出来。
import { create } from 'zustand';
import type { AudioAnalysis } from '@/core/audio/analysis';
import type { EditOp } from '@/compiler/types';
import type { Diagnostic } from '@/script/diagnostics';

export type Selection =
    | { type: 'none' }
    | { type: 'paragraph'; paragraphId: string }
    | { type: 'shot'; paragraphId: string; shotId: string }
    | { type: 'line'; lineIndex: number }
    | { type: 'clip'; clipId: string }
    | { type: 'background'; clipId: string };

export interface SessionState {
    audioBuffer: AudioBuffer | null;
    audioUrl: string | null;
    analysis: AudioAnalysis | null;
    analysisProgress: number | null;
    coverUrl: string | null;
    coverBlob: Blob | null;
    coverColors: string[];
    /** 素材库：素材 id → 文件。 */
    assetBlobs: Map<string, Blob>;
    selection: Selection;
    /**
     * 试看（VS Code 的 peek）：鼠标停在某个风格 / 组件上时临时套用的修改，只影响预览，不进工程。
     * 同一锚点、同一类型的工程修改在试看期间被它取代。
     */
    peek: EditOp[] | null;
    /** 最近一次应用剧本时的错误与提示（列进「问题」面板）。 */
    scriptProblems: Diagnostic[];
    status: string | null;
    error: string | null;
}

export const useSession = create<SessionState>(() => ({
    audioBuffer: null,
    audioUrl: null,
    analysis: null,
    analysisProgress: null,
    coverUrl: null,
    coverBlob: null,
    coverColors: [],
    assetBlobs: new Map(),
    selection: { type: 'none' },
    peek: null,
    scriptProblems: [],
    status: null,
    error: null,
}));

export const setSession = (patch: Partial<SessionState>) => useSession.setState(patch);

export const replaceObjectUrl = (key: 'audioUrl' | 'coverUrl', blob: Blob | null) => {
    const previous = useSession.getState()[key];
    if (previous) URL.revokeObjectURL(previous);
    const url = blob ? URL.createObjectURL(blob) : null;
    setSession({ [key]: url });
    return url;
};

let peekTimer: ReturnType<typeof setTimeout> | null = null;

/** 试看：稍等一下再套用，鼠标扫过一排卡片时不会逐个重编。传 null 立即结束。 */
export const setPeek = (ops: EditOp[] | null, delay = 140) => {
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = null;
    if (!ops) {
        if (useSession.getState().peek) setSession({ peek: null });
        return;
    }
    peekTimer = setTimeout(() => setSession({ peek: ops }), delay);
};
