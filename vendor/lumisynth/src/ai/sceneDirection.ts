// src/ai/sceneDirection.ts
// AI 场景编排（SceneDirection）的契约、提示词与校验。调用方给出可用的风格包目录与段落摘要，
// 模型为每段给出 Direction（包、energy、允许的族）与出场转场；结果只落在工程的
// paragraphDirections / 转场 EditOp 上（source = 'ai'），和用户手动设置走同一条路。

export interface SceneDirectionPack {
    id: string;
    label: string;
    description: string;
    families: Array<{ id: string; label: string; description?: string; moods: string[] }>;
    transitions: Array<{ id: string; label: string }>;
}

export interface SceneDirectionParagraph {
    index: number;
    /** breath / verse / lift / chorus / break / outro */
    kind: string;
    startTime: number;
    endTime: number;
    text: string;
    /** 该段的平均响度 0..1（离线音频分析）；没有音频时为 null。 */
    loudness: number | null;
}

export interface SceneDirectionRequest {
    song: { title: string; artist: string };
    packs: SceneDirectionPack[];
    paragraphs: SceneDirectionParagraph[];
}

export interface SceneDirectionItem {
    index: number;
    pack: string;
    energy: number;
    families: string[];
    /** 转场 id；'auto' 交给包自动选，'none' 不要转场。最后一段忽略。 */
    transition: string;
    reason: string;
}

export interface SceneDirectionResponse {
    paragraphs: SceneDirectionItem[];
    summary: string;
}

export const SCENE_DIRECTION_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string', description: '一句话说明整首歌的编排思路（中文，40 字以内）' },
        paragraphs: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    index: { type: 'integer' },
                    pack: { type: 'string', description: 'id of one of the provided packs' },
                    energy: { type: 'number', description: '0 (calm) .. 1 (explosive)' },
                    families: { type: 'array', items: { type: 'string' }, description: 'allowed family ids of the chosen pack; empty = any' },
                    transition: { type: 'string', description: "outgoing transition id, 'auto' or 'none'" },
                    reason: { type: 'string', description: '中文，20 字以内' },
                },
                required: ['index', 'pack', 'energy', 'families', 'transition', 'reason'],
            },
        },
    },
    required: ['summary', 'paragraphs'],
};

export const SCENE_DIRECTION_SYSTEM_PROMPT = `You are the director of a lyric music video (PV). The video is generated automatically from the lyrics; you decide, for every paragraph of the song, which visual style pack renders it, how energetic it should feel, which composition families it may use, and how it transitions into the next paragraph.

GOALS
1. Follow the song's arc: verses breathe, pre-choruses lift, choruses hit hardest, bridges and instrumental breaks change colour, the outro settles.
2. Keep a consistent language: do not switch packs on every paragraph. Switch packs where the song itself changes section (e.g. verse -> chorus), and let repeated sections (every chorus) use the same pack and similar families so the video has recognisable motifs.
3. Energy 0..1 controls how loud the compositions are (0 = quiet, sparse; 1 = massive, dense). Use the paragraph kind, the lyric text and the measured loudness (when given) together; loudness is relative within this song.
4. Families: pick 1-4 family ids of the chosen pack that fit the mood, or an empty list to allow all. Prefer a small, coherent set for choruses.
5. Transitions: use the transition ids provided. Stronger transitions (wipes, carries, glitches) into choruses; soft ones inside a verse. Use 'auto' when you have no preference, 'none' only for a deliberate hard cut. The last paragraph's transition is ignored.
6. Only use pack ids, family ids and transition ids from the provided catalog.

Return one JSON object that matches the schema, with exactly one entry per paragraph index given.`;

export const buildSceneDirectionPrompt = (request: SceneDirectionRequest) => {
    const packs = request.packs.map(pack => [
        `- pack "${pack.id}" (${pack.label}): ${pack.description}`,
        `  families: ${pack.families.map(family => `${family.id} (${family.label}${family.description ? ` — ${family.description}` : ''}; moods: ${family.moods.join('/')})`).join(', ')}`,
        `  transitions: ${pack.transitions.map(transition => `${transition.id} (${transition.label})`).join(', ')}`,
    ].join('\n')).join('\n');
    const paragraphs = request.paragraphs.map(paragraph => (
        `#${paragraph.index} [${paragraph.kind}] ${paragraph.startTime.toFixed(1)}s-${paragraph.endTime.toFixed(1)}s`
        + `${paragraph.loudness === null ? '' : ` loudness ${paragraph.loudness.toFixed(2)}`}\n${paragraph.text.slice(0, 400)}`
    )).join('\n\n');
    return `Song: ${request.song.title || '(untitled)'}${request.song.artist ? ` — ${request.song.artist}` : ''}

STYLE PACKS
${packs}

PARAGRAPHS
${paragraphs}`;
};

const clamp01 = (value: unknown) => {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
};

/**
 * 只留下目录里存在的 id；缺的段落不补（客户端保持自动）。服务端与客户端都跑一遍——
 * 客户端的目录才是权威的（包是在浏览器里注册的）。
 */
export const sanitizeSceneDirection = (raw: unknown, request: SceneDirectionRequest): SceneDirectionResponse => {
    const source = (raw ?? {}) as { paragraphs?: unknown[]; summary?: unknown };
    const packs = new Map(request.packs.map(pack => [pack.id, pack]));
    const transitions = new Set(request.packs.flatMap(pack => pack.transitions.map(transition => transition.id)));
    const indices = new Set(request.paragraphs.map(paragraph => paragraph.index));
    const seen = new Set<number>();
    const items: SceneDirectionItem[] = [];
    for (const entry of Array.isArray(source.paragraphs) ? source.paragraphs : []) {
        const item = (entry ?? {}) as Record<string, unknown>;
        const index = Number(item.index);
        if (!Number.isInteger(index) || !indices.has(index) || seen.has(index)) continue;
        const pack = packs.get(String(item.pack));
        if (!pack) continue;
        seen.add(index);
        const familyIds = new Set(pack.families.map(family => family.id));
        const families = Array.isArray(item.families)
            ? [...new Set(item.families.map(String).filter(id => familyIds.has(id)))]
            : [];
        const transition = String(item.transition ?? 'auto');
        items.push({
            index,
            pack: pack.id,
            energy: clamp01(item.energy),
            families,
            transition: transition === 'none' || transitions.has(transition) ? transition : 'auto',
            reason: String(item.reason ?? '').slice(0, 60),
        });
    }
    items.sort((a, b) => a.index - b.index);
    return { paragraphs: items, summary: String(source.summary ?? '').slice(0, 120) };
};
