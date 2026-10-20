// src/packs/hanabi/styleNotes.ts
// 花火 50 个预设与组件槽的画面描述（给 AI 编排与 agent 的 list_styles 看）。描述从 HanabiProfile 的数据自动生成
// （排法、字底色块、入场 / 强调 / 退场、主烟花与开花位置、装饰件），每族再补一句手写的气质与适合的段落；
// 改预设数据时描述跟着走。
import type { ComponentSlotDef, StyleDef } from '@/packs/contract';
import { BLOCK_LABELS, ENTER_LABELS, HANABI_FAMILY_LABELS, profileOf } from './catalog';
import type {
    BlockStyle,
    BurstKind,
    EnterFx,
    ExitFx,
    HanabiProfile,
    OrnamentKind,
    PaletteRole,
    SingFx,
    TextLayout,
    TextSpec,
} from './types';

/** 描述的长度上限（与单测一致）。 */
export const HANABI_DESCRIPTION_MAX = 90;

const LAYOUT_PHRASES: Record<TextLayout, string> = {
    center: '居中一行',
    left: '左对齐',
    right: '右对齐',
    stagger: '按词错落成阶梯',
    diagonal: '沿对角线斜排',
    scatter: '词块大小不一地散落',
    vertical: '竖排',
    'vertical-split': '竖排、词块左右两列交错',
    arc: '沿上拱的弧线排',
};

const LAYOUT_KEYWORDS: Record<TextLayout, string> = {
    center: '居中',
    left: '左对齐',
    right: '右对齐',
    stagger: '阶梯错落',
    diagonal: '斜排',
    scatter: '散落',
    vertical: '竖排',
    'vertical-split': '竖排',
    arc: '拱弧',
};

/** 字底色块，接在「垫」后面。 */
const BLOCK_PHRASES: Record<BlockStyle, string> = {
    none: '',
    tile: '每字一块方形色块',
    band: '整行色带',
    slant: '逐词平行四边形斜块',
    double: '色块加错位的影子色块',
    pill: '逐词圆角胶囊',
    split: '逐词上下双色块',
    ticket: '两端带缺口的票据色块',
    marker: '荧光笔粗笔触',
    outline: '逐段画出的描边框',
    circle: '每字一个圆底',
    stair: '高低错落的阶梯色块',
};

const ENTER_PHRASES: Record<EnterFx, string> = {
    pop: '逐字弹出',
    drop: '逐字从上落下',
    rise: '逐字从下升起',
    spin: '旋转着进入',
    wipe: '从一侧擦出',
    type: '打字机式逐字打出',
    scramble: '乱码翻动后定格',
    stretch: '横向拉长再收回',
    elastic: '弹簧般弹回原位',
    split: '两半拼合',
    spiral: '沿螺线旋入',
    flip: '翻牌翻出',
    glitch: '故障错位后稳定',
    stamp: '从大处砸下、整行震动',
    wave: '波浪般起伏进入',
    zoom: '从镜头前拉近',
    burst: '从中心炸开飞到位',
};

const SING_PHRASES: Record<SingFx, string> = {
    none: '',
    bounce: '唱到的字弹跳',
    flash: '唱到的字闪白',
    swell: '唱到的字鼓大',
    shake: '唱到的字抖动',
    jump: '唱到的字跳起',
    glow: '唱到的字发光',
    underline: '唱到的词出下划线',
    color: '唱到的字变色',
};

const EXIT_PHRASES: Record<ExitFx, string> = {
    ascend: '向上飞走',
    scatter: '四散飞走',
    shrink: '缩成点',
    slide: '整行滑出',
    dissolve: '碎成火花',
    fall: '像柳火一样垂落',
    blink: '闪几下',
};

/** 烟花在描述里的叫法。 */
const BURST_NAMES: Record<BurstKind, string> = {
    kiku: '带尾迹的菊花',
    botan: '饱满的牡丹色点',
    yanagi: '长长垂落的柳火',
    kamuro: '金色下垂的大冠',
    senrin: '一群千輪小花',
    ring: '圆环烟花',
    heart: '心形烟花',
    star: '星形烟花',
    palm: '椰树形烟花',
    crossette: '会十字分裂的烟花',
    strobe: '闪烁的点滅星',
    hachi: '乱飞的蜂火花',
    'willow-ring': '内牡丹外垂柳的双层烟花',
    mine: '扇形连发烟花',
};

/** 组件槽「主烟花」的选项说明。 */
const BURST_OPTION_DESCRIPTIONS: Record<BurstKind, string> = {
    kiku: '菊：带尾迹的球状放射',
    botan: '牡丹：没有尾迹的饱满色点',
    yanagi: '柳：长尾迹，受重力长长下垂',
    kamuro: '冠：金色、久久下垂的大伞',
    senrin: '千輪：一群小花同时或依次开',
    ring: '輪：平面圆环，可斜成椭圆',
    heart: '心：心形的型物烟花',
    star: '星：五角星形的型物烟花',
    palm: '椰：几根粗枝向外再下垂',
    crossette: '分裂：每颗星飞出后再十字分裂',
    strobe: '点滅：一闪一闪的星',
    hachi: '蜂：螺旋乱飞的火花',
    'willow-ring': '双层：内环牡丹 + 外层垂柳',
    mine: 'スターマイン：从画面底边扇形喷射的连发',
};

const BURST_AT_PHRASES: Record<HanabiProfile['burstAt'], string> = {
    behind: '字后',
    above: '字组上方',
    sides: '字组两侧',
    sky: '高空',
};

const ORNAMENT_NAMES: Record<OrnamentKind, string> = {
    ring: '扩散圆环',
    spokes: '集中线',
    sparkle: '四角星',
    orbit: '环绕点阵',
    chevrons: '箭头流',
    brackets: '「」角括号',
    cross: '＋号',
    zigzag: '锯齿线',
    wave: '波线',
    halftone: '网点',
    confetti: '彩纸',
    shards: '三角碎片',
    'dash-circle': '虚线圆',
    squares: '同心方框',
    streaks: '速度线',
    petals: '樱花瓣',
    stamp: '印章',
    rays: '旭日放射',
    underline: '粗下划线',
    'dots-line': '点线',
    glints: '字边光点',
};

const PALETTE_KEYWORDS: Record<PaletteRole, string> = {
    night: '夜空色',
    festival: '祭典色',
    pastel: '粉彩',
    mono: '黑白',
    gold: '金色',
    neon: '霓虹',
    sakura: '樱粉',
    ocean: '海蓝',
};

const MOOD_KEYWORDS: Record<HanabiProfile['mood'], string | null> = { quiet: '安静', neutral: null, loud: '高能' };

interface FamilyNote {
    /** 这一族的气质与适合的段落，接在生成的描述后面。 */
    fit: string;
    keywords: string[];
}

const FAMILY_NOTES: Record<string, FamilyNote> = {
    uchiage: { fit: '上升感最强，哪段都能用', keywords: ['升空', '上升', '烟花'] },
    kiku: { fit: '正面、有冲击力，适合副歌', keywords: ['正面', '冲击', '烟花'] },
    botan: { fit: '明快热闹，适合副歌', keywords: ['色块', '热闹', '烟花'] },
    yanagi: { fit: '慢而抒情，适合主歌与尾声', keywords: ['垂落', '抒情', '慢'] },
    senrin: { fit: '节奏快，适合密集的歌词与副歌', keywords: ['小烟花', '快节奏', '密集'] },
    hoshikuzu: { fit: '梦幻轻盈，适合安静段落', keywords: ['星屑', '梦幻', '发光'] },
    obi: { fit: '干净利落，适合主歌', keywords: ['色带', '日式PV', '利落'] },
    senko: { fit: '躁动、电子感，适合高能段落', keywords: ['故障', '频闪', '电子'] },
    senkohanabi: { fit: '暗色调、温柔私密，适合主歌与尾声', keywords: ['线香花火', '火花', '温柔'] },
    shakudama: { fit: '最大的场面，留给副歌高潮与全曲最高点', keywords: ['超大字', '高潮', '烟花'] },
};

const sizePhrase = (text: TextSpec) => (text.heroSize >= 0.15 ? '超大字' : text.heroSize >= 0.12 ? '大字' : '');

/** 竖排的文字区偏离中心时补一句靠哪边。 */
const sidePhrase = (profile: HanabiProfile) => {
    if (profile.text.layout !== 'vertical' && profile.text.layout !== 'vertical-split') return '';
    return profile.region.cx >= 0.56 ? '靠右' : profile.region.cx <= 0.44 ? '靠左' : '';
};

/** 排版部分：字怎么排、垫什么色块、怎么入场、唱到时怎样、怎么退场。 */
const textParts = (profile: HanabiProfile, text: TextSpec, withSize: boolean) => {
    const size = withSize ? sizePhrase(text) : '';
    const layout = `${size || '字'}${LAYOUT_PHRASES[text.layout]}${sidePhrase(profile)}`;
    const block = BLOCK_PHRASES[text.block];
    return {
        head: `${layout}${block ? `、垫${block}` : ''}`,
        enter: ENTER_PHRASES[text.enter],
        sing: SING_PHRASES[text.sing],
        exit: `${EXIT_PHRASES[text.exit]}退场`,
    };
};

const sungPhrase = (kind: BurstKind) => (
    kind === 'hachi' ? '唱到的字边噼啪冒火花'
        : kind === 'senrin' ? '唱到的字各开一朵小花'
            : kind === 'star' ? '唱到的字边迸出小星'
                : kind === 'strobe' ? '唱到的字边闪烁小星'
                    : kind === 'heart' ? '唱到的字各开一朵小心形花'
                        : `唱到的字各开一朵小${BURST_OPTION_DESCRIPTIONS[kind].split('：')[0]}`
);

/** 烟花部分：升空尾迹、主烟花开在哪、唱到的字放什么。 */
const burstPart = (profile: HanabiProfile) => {
    const parts: string[] = [];
    if (profile.burst?.kind === 'mine') {
        // スターマイン 总是从画面底边往上喷，不带升空尾迹（scene.ts）。
        parts.push(`画面底边${profile.burstAt === 'sides' ? '两处' : ''}扇形连发烟花`);
    } else if (profile.burst) {
        const at = BURST_AT_PHRASES[profile.burstAt];
        const name = BURST_NAMES[profile.burst.kind];
        parts.push(profile.launch ? `尾迹从底边升空，在${at}开${name}` : `${at}开${name}`);
    }
    if (profile.sungBurst) parts.push(sungPhrase(profile.sungBurst.kind));
    return parts.join('，');
};

/**
 * 按优先级拼描述：放不下 90 字时，依次减装饰件、去掉字号、去掉唱到时的强调，最后去掉装饰件。
 */
export const describeHanabiProfile = (profile: HanabiProfile): string => {
    const fit = FAMILY_NOTES[profile.family]?.fit ?? '';
    const burst = burstPart(profile);
    const ornaments = profile.ornaments.map(item => ORNAMENT_NAMES[item.kind]);
    const attempts: Array<{ ornaments: number; size: boolean; sing: boolean }> = [
        { ornaments: 3, size: true, sing: true },
        { ornaments: 2, size: true, sing: true },
        { ornaments: 2, size: false, sing: true },
        { ornaments: 1, size: false, sing: true },
        { ornaments: 1, size: false, sing: false },
        { ornaments: 0, size: false, sing: false },
    ];
    let result = '';
    for (const attempt of attempts) {
        const text = textParts(profile, profile.text, attempt.size);
        const motion = [text.enter, attempt.sing ? text.sing : '', text.exit].filter(Boolean).join('，');
        const decor = ornaments.slice(0, attempt.ornaments);
        result = [
            burst ? `${burst}。` : '',
            `${text.head}，${motion}`,
            decor.length > 0 ? `；配${decor.join('、')}` : '',
            fit ? `。${fit}。` : '。',
        ].join('');
        if (result.length <= HANABI_DESCRIPTION_MAX) break;
    }
    return result;
};

export const hanabiStyleNote = (profile: HanabiProfile): Required<Pick<StyleDef, 'label' | 'description' | 'keywords'>> => {
    const { text } = profile;
    const keywords = [
        HANABI_FAMILY_LABELS[profile.family],
        ...(FAMILY_NOTES[profile.family]?.keywords ?? []),
        LAYOUT_KEYWORDS[text.layout],
        text.block === 'none' ? null : BLOCK_LABELS[text.block],
        ENTER_LABELS[text.enter],
        profile.burst ? BURST_OPTION_DESCRIPTIONS[profile.burst.kind].split('：')[0] : null,
        ...profile.ornaments.slice(0, 2).map(item => ORNAMENT_NAMES[item.kind]),
        PALETTE_KEYWORDS[profile.palette],
        MOOD_KEYWORDS[profile.mood],
    ].filter((word): word is string => Boolean(word));
    return { label: profile.label, description: describeHanabiProfile(profile), keywords: [...new Set(keywords)] };
};

/** 排版槽一个选项的说明：只含文字部分（排法、色块、入场、强调、退场）。 */
const typographyOptionDescription = (kind: string) => {
    const profile = profileOf(kind);
    const text = textParts(profile, profile.text, true);
    return [text.head, text.enter, text.sing, text.exit].filter(Boolean).join('，');
};

const BLOCK_OPTION_DESCRIPTIONS: Record<BlockStyle, string> = {
    none: '不垫色块，字直接压在画面上',
    tile: '每个字一块方形色块，两色交替',
    band: '整行一条色带，从一端拉出',
    slant: '逐词的平行四边形斜块',
    double: '色块加一层错位的影子色块',
    pill: '逐词的圆角胶囊',
    split: '逐词色块，上下两半不同色',
    ticket: '票据形：两端有半圆缺口的色块',
    marker: '荧光笔：字下半部一道粗笔触，逐字扫过',
    outline: '只描边的框，框线逐段画出',
    circle: '每个字一个圆底（丸抜き）',
    stair: '逐字高低错落的阶梯色块',
};

const ENTER_OPTION_DESCRIPTIONS: Record<EnterFx, string> = {
    pop: '从 0 缩放弹出，带过冲',
    drop: '从上方落下、落地回弹',
    rise: '从下方升起、纵向拉伸，到位时压扁回弹',
    spin: '旋转加缩放进入',
    wipe: '遮罩从一侧擦出',
    type: '打字机：逐字出现，行尾有闪烁光标',
    scramble: '先是乱码字符快速翻动，再定格成原字',
    stretch: '横向拉长到 3 倍再收回',
    elastic: '从偏移处弹簧般回到原位',
    split: '字从左右或上下两半拼合',
    spiral: '从远处沿螺线旋入',
    flip: '绕纵轴翻牌出现',
    glitch: '横向错位加 RGB 分色抖动后稳定',
    stamp: '从 2.5 倍大砸下，落定时整行震动',
    wave: '逐字上下起伏着进入',
    zoom: '从镜头前（大而模糊）拉到原位',
    burst: '从行中心一点炸开，飞到各自位置',
};

export const describeHanabiSlots = (slots: ComponentSlotDef[]): ComponentSlotDef[] => slots.map(slot => {
    if (slot.id === 'typography') {
        return {
            ...slot,
            description: '借另一个预设的整套文字：排法、字号、字底色块、入场、唱到时的强调与退场；烟花、装饰件与配色不变。',
            options: slot.options.map(option => ({ ...option, description: typographyOptionDescription(option.id) })),
        };
    }
    if (slot.id === 'block') {
        return {
            ...slot,
            description: '字底下的色块，随字一起入场、退场。',
            options: slot.options.map(option => ({ ...option, description: BLOCK_OPTION_DESCRIPTIONS[option.id as BlockStyle] })),
        };
    }
    if (slot.id === 'enter') {
        return {
            ...slot,
            description: '字的入场动画，逐字依次开始，最后一个字在被唱到前到位。',
            options: slot.options.map(option => ({ ...option, description: ENTER_OPTION_DESCRIPTIONS[option.id as EnterFx] })),
        };
    }
    if (slot.id === 'burst') {
        return {
            ...slot,
            description: '文字入场时开的主烟花种类（开花位置与颜色仍按预设）。',
            options: slot.options.map(option => ({ ...option, description: BURST_OPTION_DESCRIPTIONS[option.id as BurstKind] })),
        };
    }
    return slot;
});
