// src/packs/sonnet/sonnetStyleNotes.ts
// 商籁 7 种镜头、4 个族与组件槽的画面描述（给 AI 编排与 agent 的 list_styles 看），按 sonnetTypographyLayout /
// sonnetShotFlowLayouts / sonnetShotMg / sonnetMotion 的实际行为写。
import type { ComponentSlotDef, StyleDef } from '@/packs/contract';
import type { SonnetAccent, SonnetShotKind } from './types';

type StyleNote = Required<Pick<StyleDef, 'label' | 'description' | 'keywords'>>;

export const SONNET_STYLE_NOTES: Record<SonnetShotKind, StyleNote> = {
    'editorial-column': {
        label: '编辑栏',
        description: '杂志版式：强调词做成巨大竖排字柱或大标题，其余词按阅读顺序排成分栏、双行阶梯或徽标块；背景细网格线加粗方框，镜头缓推。适合主歌与叙事。',
        keywords: ['杂志', '分栏', '竖排字柱', '网格', '大标题', '叙事'],
    },
    'type-impact': {
        label: '冲击大字',
        description: '强调词放到约五倍的巨字、从缩小状态弹大，其余词按上列、左行、右行、下列围成十字；背后大号几何图形与更多漂浮粒子，开场镜头从特写急收。适合副歌与重拍。',
        keywords: ['巨字', '冲击', '十字构图', '几何图形', '重拍', '副歌'],
    },
    'fragment-collage': {
        label: '碎片拼贴',
        description: '强调词居中，其余词按时间顺时针绕成一圈（圆环、双环或螺旋），部分词竖排；背后大号几何图形，镜头弧线漂移并微转。适合节奏密、情绪上扬的段落。',
        keywords: ['环形', '拼贴', '螺旋', '几何图形', '碎片', '上扬'],
    },
    'tracking-ribbon': {
        label: '字距飘带',
        description: '整句排成一条横向长带，强调词在中间放大，前面的词往左、后面的词往右延伸；镜头沿字带大幅横移。适合长句与流动感的主歌。',
        keywords: ['横带', '单行', '横移', '长句', '流动', '追踪'],
    },
    'mask-reveal': {
        label: '遮罩揭示',
        description: '强调词竖排大字居中，其余词在上下左右围成十字，随演唱逐字显现；背景只散几个小方块，镜头纵向缓移。适合过渡、蓄力与副歌前。',
        keywords: ['竖排大字', '逐字显现', '十字构图', '极简', '蓄力', '过渡'],
    },
    'poster-blocks': {
        label: '海报块',
        description: '海报分区：强调词各占一块大区域，中文词可能翻成竖栏，其余词按阅读顺序填满空隙，左对齐、字号反差大；取景最宽、镜头几乎不动。适合副歌与口号式歌词。',
        keywords: ['海报', '分区', '字号反差', '竖栏', '口号', '副歌'],
    },
    'quiet-tableau': {
        label: '静景',
        description: '字号最小、留白最多：强调词居中（有时竖排），前面的词在上、后面的词在下排成一列，太长折成多列；背景只有几个小方块，镜头轻漂。适合换气、安静段落与尾声。',
        keywords: ['留白', '小字', '单列', '安静', '换气', '尾声'],
    },
};

export const SONNET_FAMILY_DESCRIPTIONS: Record<string, string> = {
    typography: '以排字本身为主体：杂志分栏、巨字冲击、横向字带，镜头逐字追踪强调词',
    collage: '拼贴：词块大小反差大，环绕成圈或按海报分区铺满画面，热闹、信息量大',
    reveal: '遮罩揭示：竖排大字加十字构图，字随演唱逐个显现，背景极简，适合蓄力与过渡',
    tableau: '静景：小字号、大留白的一列字，镜头几乎静止，适合换气与安静段落',
};

/** 排版槽的选项：只换字怎么排（字号层级与摆法），构图、MG、镜头运动仍按本镜头。 */
const TYPOGRAPHY_OPTION_DESCRIPTIONS: Record<SonnetShotKind, string> = {
    'editorial-column': '杂志分栏：强调词做巨大竖排字柱或大标题，其余词排成分栏或阶梯',
    'type-impact': '强调词五倍巨字、弹大入场，其余词上下左右围成十字',
    'fragment-collage': '强调词居中，其余词顺时针绕成圆环或螺旋，部分竖排',
    'tracking-ribbon': '整句一条横向长带，强调词在中间放大',
    'mask-reveal': '强调词竖排大字，其余词上下左右围成十字',
    'poster-blocks': '海报分区：强调词占大区块、中文可能竖排，其余词填满空隙，左对齐',
    'quiet-tableau': '小字号，强调词居中，其余词上下排成一列，留白多',
};

const ACCENT_OPTION_DESCRIPTIONS: Record<SonnetAccent | 'standard', string> = {
    standard: '按构图默认：冲击大字与碎片拼贴画中央大几何，编辑栏画网格方框，其余散几个小方块；都带 HUD 线框与漂浮粒子',
    geo: '强制画中央大几何图形（放射圆、嵌套菱形、六边形、主题图形等，按种子）与固定几何块',
    hud: '只留背景 HUD 线框（十字、角括号、刻度尺、弧形仪表等），不画中央几何与漂浮粒子',
    none: 'MG 图层全关，只剩文字与引导线',
};

export const describeSonnetSlots = (slots: ComponentSlotDef[]): ComponentSlotDef[] => slots.map(slot => {
    if (slot.id === 'typography') {
        return {
            ...slot,
            description: '借另一种镜头的排字方式（字号层级与摆法）；本镜头的构图、MG 与镜头运动不变。',
            options: slot.options.map(option => ({ ...option, description: TYPOGRAPHY_OPTION_DESCRIPTIONS[option.id as SonnetShotKind] })),
        };
    }
    if (slot.id === 'accent') {
        return {
            ...slot,
            description: '字后面的 MG 装饰：几何图形、HUD 线框、漂浮粒子开多少。',
            options: slot.options.map(option => ({ ...option, description: ACCENT_OPTION_DESCRIPTIONS[option.id as SonnetAccent | 'standard'] })),
        };
    }
    return slot;
});
