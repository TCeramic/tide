// src/script/parse.ts
// 剧本文本 → 语法树（LumiScript v2）。先由 cst.ts 切成语句与块，这里逐条解读：关键字、参数个数、
// 数字 / 时间 / 枚举的写法与范围。包、风格、素材存不存在，行号够不够这些要看工程，在 check.ts 里查。
// 每条语句单独解读，一条出错不影响其余的语句；写错的块头整块跳过（免得块里每一行都跟着报错）。
// 语法见 docs/SCRIPT.md。
import type { AssetBlend, AssetSlot, ClipAnimation, ClipAnimationType, ClipEffectType, ClipMotionType, FollowMode } from '@/core/assets/clips';
import { ASSET_SLOTS, CLIP_ANIMATIONS, CLIP_EFFECTS, CLIP_MOTIONS, FOLLOW_MODES } from '@/core/assets/clips';
import { PARAGRAPH_KINDS, type ParagraphKind } from '@/compiler/types';
import { parseCst, type Statement } from './cst';
import { error, suggest, warning, type Diagnostic, type Fix, type Span } from './diagnostics';
import { isColor, parseNumber, parseRange, type Token } from './syntax';

export const SCRIPT_VERSION = 2;

/** 带位置的值。 */
export interface At<T> extends Span {
    value: T;
    from: number;
    to: number;
}

/**
 * 可以交回自动的指令。生成的剧本把自动选出的值也写出来（可以直接改）：
 * 值和当前编排里的一样、又没有 locked / @ai 时保持自动；改了值或者标了 locked / @ai 就固定下来。
 */
export type Directive<T> = At<T> & { locked: boolean; ai: boolean };

export type TimingNode =
    | { type: 'song' }
    | { type: 'absolute'; start: number; end: number }
    /** 行号从 1 起。 */
    | { type: 'lines'; from: number; to: number }
    | { type: 'paragraph'; paragraph: number }
    | { type: 'shot'; paragraph: number; shot: number }
    /** 锚点已失效：保留原来的挂载（只能用在已有的片段上）。 */
    | { type: 'missing' };

export type SourceNode =
    | { type: 'theme' }
    | { type: 'cover' }
    | { type: 'gradient'; from: string; to: string; angle: number }
    | { type: 'image'; asset: At<string> }
    | { type: 'video'; asset: At<string>; offset: number; loop: boolean };

export interface ShotNode extends Span {
    /** 段内序号（1 起）。 */
    number: At<number>;
    /** 风格；null（没写或 auto）表示自动。 */
    style: Directive<string> | null;
    components: Array<{ slot: At<string>; value: Directive<string> }>;
}

export interface WordNode {
    range: At<{ start: number; end: number }>;
    text: At<string>;
}

/** 歌词行：line 行号 时间 "文字" [{ translation … / parts … / word … }]。 */
export interface LyricLineNode extends Span {
    /** 行号（1 起）。 */
    number: At<number>;
    range: At<{ start: number; end: number }>;
    text: At<string>;
    /** 译文：字符串，none（值为空字符串）表示不显示；null（没写）表示用歌词文件里的译文。 */
    translation: At<string> | null;
    parts: At<string[]> | null;
    /** 逐字时间；null 表示按改字规则推出来。 */
    words: WordNode[] | null;
}

export interface ParagraphNode extends Span {
    /** 块头的位置（paragraph 这个词）。 */
    head: At<string>;
    /** 性质；null（没写或 auto）表示自动判断。 */
    kind: Directive<ParagraphKind> | null;
    /** lines a..b（行号 1 起，含两端）。 */
    lines: At<{ from: number; to: number }> | null;
    pack: Directive<string> | null;
    energy: Directive<number | 'auto'> | null;
    families: Directive<string[] | 'all' | 'auto'> | null;
    transition: Directive<string> | null;
    shots: ShotNode[];
    lyricLines: LyricLineNode[];
}

export interface ClipFields {
    asset: At<string>;
    at: At<TimingNode>;
    extend: At<[number, number]>;
    slot: At<AssetSlot>;
    position: At<[number, number]>;
    scale: At<number>;
    rotate: At<number>;
    opacity: At<number>;
    flip: At<boolean>;
    blend: At<AssetBlend>;
    enter: At<ClipAnimation>;
    exit: At<ClipAnimation>;
    follow: At<{ mode: FollowMode; amount: number }>;
    effect: At<{ type: ClipEffectType; color?: string; size?: number; opacity?: number; period?: number }>;
    motion: At<{ type: ClipMotionType; amount?: number }>;
}

export interface BackgroundFields {
    source: At<SourceNode>;
    at: At<TimingNode>;
    fit: At<'cover' | 'contain'>;
    kenBurns: At<number>;
    blur: At<number>;
    dim: At<number>;
    fade: At<[number, number]>;
}

export interface ClipNode extends Span {
    head: At<string>;
    /** 已有片段 id 的前几位；null 表示新片段。 */
    id: At<string> | null;
    fields: Partial<ClipFields>;
}

export interface BackgroundNode extends Span {
    head: At<string>;
    id: At<string> | null;
    fields: Partial<BackgroundFields>;
}

export interface ScriptDoc {
    version: At<number> | null;
    seed: At<string> | null;
    direction: At<{ mode: 'single'; pack: At<string> } | { mode: 'mix' }> | null;
    mix: Array<{ kind: At<ParagraphKind>; pack: At<string> }>;
    shotMixing: At<boolean> | null;
    lyricOffset: At<number> | null;
    /** paragraphs auto：分段、段落编排、镜头全部交回自动。 */
    paragraphsAuto: Span | null;
    paragraphs: ParagraphNode[];
    backgroundsNone: Span | null;
    backgrounds: BackgroundNode[];
    clipsNone: Span | null;
    clips: ClipNode[];
}

export interface ParseResult {
    doc: ScriptDoc;
    diagnostics: Diagnostic[];
}

export const ASSET_BLENDS: AssetBlend[] = ['normal', 'add', 'multiply', 'screen'];
export const TOP_KEYWORDS = ['lumiscript', 'seed', 'direction', 'mix', 'shot-mixing', 'lyric-offset', 'paragraphs', 'paragraph', 'backgrounds', 'background', 'clips', 'clip'];
export const PARAGRAPH_KEYWORDS = ['lines', 'line', 'pack', 'energy', 'families', 'transition', 'shot'];
export const LINE_KEYWORDS = ['translation', 'parts', 'word'];
export const CLIP_KEYWORDS = ['asset', 'at', 'extend', 'slot', 'position', 'scale', 'rotate', 'opacity', 'flip', 'blend', 'follow', 'enter', 'exit', 'effect', 'motion'];
export const BACKGROUND_KEYWORDS = ['source', 'at', 'fit', 'ken-burns', 'blur', 'dim', 'fade'];
export const TIMING_USAGE = 'song / m:ss.cc-m:ss.cc / lines a..b / paragraph N / shot P.S';

/** v1 的写法：给出迁移提示。 */
const V1_HINTS: Record<string, string> = {
    'gap-threshold': 'v2 不再写 gap-threshold：分段阈值是编译结果（写在注释里），切分参数在「设置」标签里改',
    boundary: 'v2 不再写 boundary：分段原因是编译结果，写在段落的注释里',
    hold: 'v2 不再写 hold：余韵的时刻是编译结果，写在镜头的注释里',
    text: '歌词写在段落的 line 语句里',
};

class ReadError extends Error {
    constructor(message: string, readonly span: Span, readonly code = 'LS111', readonly extra: { hint?: string; fixes?: Fix[] } = {}) {
        super(message);
    }
}

const spanOf = (line: number, first: Token, last: Token = first): Span => ({ line, from: first.from, to: last.to });

export const parseScript = (text: string): ParseResult => {
    const cst = parseCst(text);
    const diagnostics = [...cst.diagnostics];
    const doc: ScriptDoc = {
        version: null, seed: null, direction: null, mix: [], shotMixing: null, lyricOffset: null,
        paragraphsAuto: null, paragraphs: [], backgroundsNone: null, backgrounds: [], clipsNone: null, clips: [],
    };

    // ---- 参数
    let current: Statement = cst.statements[0];
    const at = <T>(value: T, first: Token, last: Token = first): At<T> => ({ value, line: current.line, from: first.from, to: last.to });
    const fail = (message: string, token?: Token, code = 'LS111', extra: { hint?: string; fixes?: Fix[] } = {}): never => {
        throw new ReadError(message, token ? spanOf(current.line, token) : spanOf(current.line, current.head, current.args.at(-1) ?? current.head), code, extra);
    };
    const count = (min: number, max: number, usage: string) => {
        const { args } = current;
        if (args.length < min) fail(`缺少参数，写法：${usage}`, undefined, 'LS111');
        if (args.length > max) {
            const extra = args[max];
            throw new ReadError(`多余的参数，写法：${usage}`, { line: current.line, from: extra.from, to: args.at(-1)!.to }, 'LS112', {
                fixes: [{ label: '删掉多余的参数', edits: [{ line: current.line, from: args[max - 1]?.to ?? current.head.to, to: args.at(-1)!.to, insert: '' }] }],
            });
        }
    };
    const number = (token: Token | undefined, what: string, min = -Infinity, max = Infinity) => {
        if (!token) return fail(`缺少${what}`);
        const value = parseNumber(token.text);
        if (value === null) return fail(`${what}应该是数字`, token, 'LS113');
        if (value < min || value > max) {
            const clamped = Math.min(max, Math.max(min, value));
            return fail(`${what}应在 ${min} 到 ${max} 之间`, token, 'LS114', {
                fixes: [{ label: `改成 ${clamped}`, edits: [{ line: current.line, from: token.from, to: token.to, insert: String(clamped) }] }],
            });
        }
        return value;
    };
    const integer = (token: Token | undefined, what: string, min = 1) => {
        const value = number(token, what, min);
        if (!Number.isInteger(value)) fail(`${what}应该是整数`, token, 'LS113');
        return value;
    };
    const oneOf = <T extends string>(token: Token | undefined, options: readonly T[], what: string): T => {
        if (!token) return fail(`缺少${what}，可以写 ${options.join(' / ')}`);
        if (options.includes(token.text as T)) return token.text as T;
        const close = suggest(token.text, options);
        return fail(`${what}没有 ${token.text}`, token, 'LS115', {
            hint: close.length > 0 ? `是不是想写 ${close.join(' / ')}？` : `可以写 ${options.join(' / ')}`,
            fixes: close.map(item => ({ label: `改成 ${item}`, edits: [{ line: current.line, from: token.from, to: token.to, insert: item }] })),
        });
    };
    const onOff = (token: Token | undefined, what: string) => oneOf(token, ['on', 'off'] as const, what) === 'on';
    const str = (token: Token | undefined, what: string) => {
        if (!token) return fail(`缺少${what}`);
        if (token.string === undefined) return fail(`${what}要写成字符串："…"`, token, 'LS113', {
            fixes: [{ label: '加上引号', edits: [{ line: current.line, from: token.from, to: token.to, insert: JSON.stringify(token.text) }] }],
        });
        return token.string;
    };
    const range = (token: Token | undefined, what = '时间段') => {
        if (!token) return fail(`缺少${what}（m:ss.cc-m:ss.cc）`);
        const value = parseRange(token.text);
        if (!value) return fail(`${what}写成 m:ss.cc-m:ss.cc，例如 0:45.20-0:47.90`, token, 'LS116');
        if (value.end < value.start) return fail('结束时间早于开始时间', token, 'LS116');
        return value;
    };
    const lineRange = (token: Token | undefined) => {
        const match = token ? /^(\d+)\.\.(\d+)$/.exec(token.text) : null;
        if (!match) return fail('行范围写成 a..b（行号从 1 起），例如 12..18', token, 'LS118');
        const from = Number(match[1]);
        const to = Number(match[2]);
        if (from < 1 || to < from) return fail('行范围要从 1 起、前小后大', token, 'LS118');
        return { from, to };
    };
    const timing = (tokens: Token[]): TimingNode => {
        const [head, arg, extra] = tokens;
        if (!head) return fail(`缺少挂载点：${TIMING_USAGE}`);
        if (extra) return fail('多余的参数', extra, 'LS112');
        if (head.text === 'song' || head.text === 'missing') {
            if (arg) fail('多余的参数', arg, 'LS112');
            return { type: head.text };
        }
        if (head.text === 'paragraph') return { type: 'paragraph', paragraph: integer(arg, '段落编号') };
        if (head.text === 'lines') {
            const value = lineRange(arg);
            return { type: 'lines', from: value.from, to: value.to };
        }
        if (head.text === 'shot') {
            const match = arg ? /^(\d+)\.(\d+)$/.exec(arg.text) : null;
            if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) return fail('镜头写成 段.镜头（都从 1 起），例如 3.2', arg ?? head, 'LS113');
            return { type: 'shot', paragraph: Number(match[1]), shot: Number(match[2]) };
        }
        const value = parseRange(head.text);
        if (!value) return fail(`挂载点写成 ${TIMING_USAGE}`, head, 'LS115');
        if (arg) fail('多余的参数', arg, 'LS112');
        if (value.end < value.start) fail('结束时间早于开始时间', head, 'LS116');
        return { type: 'absolute', start: value.start, end: value.end };
    };
    /** 去掉末尾的 locked / @ai（顺序不限）。 */
    const provenance = () => {
        const marks = { locked: false, ai: false };
        for (;;) {
            const last = current.args.at(-1)?.text;
            if (last === 'locked') marks.locked = true;
            else if (last === '@ai') marks.ai = true;
            else return marks;
            current = { ...current, args: current.args.slice(0, -1) };
        }
    };
    const setOnce = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
        const previous = target[key] as unknown as Span | null | undefined;
        if (previous) {
            diagnostics.push(warning('LS902', spanOf(current.line, current.head), `重复的 ${current.head.text}，以这一行为准`, {
                related: [{ line: previous.line, message: '前面写过' }],
            }));
        }
        target[key] = value;
    };
    const noBlock = () => {
        if (current.block) fail(`${current.head.text} 后面不带 { … } 块`, current.head, 'LS117');
    };
    const needBlock = (usage: string) => {
        if (!current.block) fail(`${current.head.text} 要带一个块：${usage}`, current.head, 'LS117');
    };
    const unknown = (keywords: readonly string[], where: string): never => {
        const word = current.head.text;
        const close = suggest(word, keywords);
        return fail(`${where}里不认识 ${word}`, current.head, 'LS110', {
            hint: V1_HINTS[word] ?? (close.length > 0 ? `是不是想写 ${close.join(' / ')}？` : `可以写 ${keywords.join(' / ')}`),
            fixes: close.map(item => ({ label: `改成 ${item}`, edits: [{ line: current.line, from: current.head.from, to: current.head.to, insert: item }] })),
        });
    };

    /** 逐条解读；handler 抛出的 ReadError 变成诊断。返回 false 表示这一条出错了。 */
    const each = (statements: Statement[], handler: (statement: Statement) => void) => statements.forEach(statement => {
        const saved = current;
        current = statement;
        try {
            handler(statement);
        } catch (caught) {
            if (!(caught instanceof ReadError)) throw caught;
            diagnostics.push(error(caught.code, caught.span, caught.message, caught.extra));
        } finally {
            current = saved;
        }
    });

    // ---- 段落
    const shotStatement = (paragraph: ParagraphNode) => {
        const marks = provenance();
        const [numberToken, styleToken, extra] = current.args;
        if (extra) fail('多余的参数，写法：shot N [<风格>|auto] [locked] [{ … }]', extra, 'LS112');
        if (numberToken && /^\d+\.\d+$/.test(numberToken.text)) {
            fail('v2 的镜头只写段内序号：shot 2（段落是它所在的块）', numberToken, 'LS113', {
                fixes: [{ label: `改成 shot ${numberToken.text.split('.')[1]}`, edits: [{ line: current.line, from: numberToken.from, to: numberToken.to, insert: numberToken.text.split('.')[1] }] }],
            });
        }
        const shot: ShotNode = {
            line: current.line,
            number: at(integer(numberToken, '镜头序号'), numberToken!),
            style: styleToken && styleToken.text !== 'auto' ? { ...at(styleToken.text, styleToken), ...marks } : null,
            components: [],
        };
        if (styleToken && styleToken.text !== 'auto' && !styleToken.text.includes('/')) {
            fail('风格写成 包/风格，例如 tempera/duo-split', styleToken, 'LS113');
        }
        each(current.block ?? [], () => {
            const componentMarks = provenance();
            const [value, more] = current.args;
            if (current.block) fail('组件槽后面不带 { … } 块', current.head, 'LS117');
            if (!value) fail(`缺少 ${current.head.text} 的取值（写 auto 交回自动）`);
            if (more) fail('多余的参数，写法：<组件槽> <取值>|auto [locked]', more, 'LS112');
            const existing = shot.components.find(item => item.slot.value === current.head.text);
            if (existing) {
                diagnostics.push(warning('LS902', spanOf(current.line, current.head), `重复的组件槽 ${current.head.text}，以这一行为准`, {
                    related: [{ line: existing.slot.line, message: '前面写过' }],
                }));
                shot.components = shot.components.filter(item => item !== existing);
            }
            shot.components.push({ slot: at(current.head.text, current.head), value: { ...at(value.text, value), ...componentMarks } });
        });
        paragraph.shots.push(shot);
    };

    const lyricStatement = (paragraph: ParagraphNode) => {
        count(3, 3, 'line 行号 m:ss.cc-m:ss.cc "歌词"');
        const [numberToken, rangeToken, textToken] = current.args;
        const node: LyricLineNode = {
            line: current.line,
            number: at(integer(numberToken, '行号'), numberToken),
            range: at(range(rangeToken, '行的时间'), rangeToken),
            text: at(str(textToken, '歌词'), textToken),
            translation: null,
            parts: null,
            words: null,
        };
        each(current.block ?? [], () => {
            if (current.block) fail(`${current.head.text} 后面不带 { … } 块`, current.head, 'LS117');
            if (current.head.text === 'translation') {
                count(1, 1, 'translation "译文" | none');
                const token = current.args[0]!;
                const value = token.string === undefined && token.text === 'none' ? '' : str(token, '译文');
                setOnce(node, 'translation', at(value, token));
                return;
            }
            if (current.head.text === 'parts') {
                if (current.args.length === 0) fail('缺少分词：parts "词" "词" …');
                const parts = current.args.map(token => str(token, '分词'));
                setOnce(node, 'parts', at(parts, current.args[0], current.args.at(-1)));
                return;
            }
            if (current.head.text === 'word') {
                count(2, 2, 'word m:ss.cc-m:ss.cc "字"');
                const [wordRange, wordText] = current.args;
                node.words ??= [];
                node.words.push({ range: at(range(wordRange, '逐字时间'), wordRange), text: at(str(wordText, '字'), wordText) });
                return;
            }
            unknown(LINE_KEYWORDS, '歌词行');
        });
        paragraph.lyricLines.push(node);
    };

    const paragraphBlock = () => {
        const kindMarks = provenance();
        const [kindToken, extra] = current.args;
        if (extra || (kindToken && /^\d/.test(kindToken.text))) {
            fail('段落写成 paragraph [性质] [locked] {（编号、时间是编译结果，写在注释里）', extra ?? kindToken, 'LS112');
        }
        needBlock('paragraph [性质] [locked] { … }');
        const paragraph: ParagraphNode = {
            line: current.line,
            head: at('paragraph', current.head),
            kind: kindToken && kindToken.text !== 'auto' ? { ...at(oneOf(kindToken, PARAGRAPH_KINDS, '段落性质'), kindToken), ...kindMarks } : null,
            lines: null, pack: null, energy: null, families: null, transition: null, shots: [], lyricLines: [],
        };
        each(current.block!, () => {
            const head = current.head.text;
            if (head === 'shot') return shotStatement(paragraph);
            if (head === 'line') return lyricStatement(paragraph);
            noBlock();
            switch (head) {
                case 'lines': {
                    count(1, 1, 'lines a..b');
                    return setOnce(paragraph, 'lines', at(lineRange(current.args[0]), current.args[0]));
                }
                case 'pack': {
                    const marks = provenance();
                    count(1, 1, 'pack <包>|auto [locked|@ai]');
                    return setOnce(paragraph, 'pack', { ...at(current.args[0].text, current.args[0]), ...marks });
                }
                case 'energy': {
                    const marks = provenance();
                    count(1, 1, 'energy 0..1|auto [locked|@ai]');
                    const token = current.args[0];
                    return setOnce(paragraph, 'energy', { ...at(token.text === 'auto' ? 'auto' as const : number(token, 'energy', 0, 1), token), ...marks });
                }
                case 'families': {
                    const marks = provenance();
                    if (current.args.length === 0) fail('缺少族，写法：families <族…>|all|auto [locked|@ai]');
                    const first = current.args[0];
                    const special = first.text === 'all' || first.text === 'auto';
                    if (special && current.args.length > 1) fail(`${first.text} 不能和族写在一起`, current.args[1], 'LS112');
                    const value = special ? first.text as 'all' | 'auto' : current.args.map(token => token.text);
                    return setOnce(paragraph, 'families', { ...at(value, first, current.args.at(-1)), ...marks });
                }
                case 'transition': {
                    const marks = provenance();
                    count(1, 1, 'transition <转场>|none|auto [locked|@ai]');
                    return setOnce(paragraph, 'transition', { ...at(current.args[0].text, current.args[0]), ...marks });
                }
                default:
                    return unknown(PARAGRAPH_KEYWORDS, '段落块');
            }
        });
        doc.paragraphs.push(paragraph);
    };

    // ---- 片段
    const blockId = (usage: string): At<string> | null => {
        const [idToken, extra] = current.args;
        if (extra) fail(`多余的参数，写法：${usage}`, extra, 'LS112');
        needBlock(usage);
        return idToken && idToken.text !== 'new' ? at(idToken.text, idToken) : null;
    };
    const assetRef = (token: Token | undefined): At<string> => {
        if (!token) return fail('缺少素材：写素材 id 的前几位，或者素材的文件名 "名字.png"');
        return at(token.string ?? token.text, token);
    };

    const clipBlock = () => {
        const node: ClipNode = { line: current.line, head: at('clip', current.head), id: blockId('clip [<id>] { … }'), fields: {} };
        const f = node.fields;
        each(current.block!, () => {
            noBlock();
            const args = current.args;
            switch (current.head.text) {
                case 'asset':
                    count(1, 1, 'asset <素材 id>|"文件名"');
                    return setOnce(f, 'asset', assetRef(args[0]));
                case 'at':
                    return setOnce(f, 'at', at(timing(args), args[0] ?? current.head, args.at(-1) ?? current.head));
                case 'extend':
                    count(2, 2, 'extend 提前秒 延后秒');
                    return setOnce(f, 'extend', at([number(args[0], '提前', -30, 30), number(args[1], '延后', -30, 30)] as [number, number], args[0], args[1]));
                case 'slot':
                    count(1, 1, `slot ${ASSET_SLOTS.join('|')}`);
                    return setOnce(f, 'slot', at(oneOf(args[0], ASSET_SLOTS, '层级'), args[0]));
                case 'position':
                    count(2, 2, 'position x y（画面宽高的比例）');
                    return setOnce(f, 'position', at([number(args[0], 'x', -1, 2), number(args[1], 'y', -1, 2)] as [number, number], args[0], args[1]));
                case 'scale':
                    count(1, 1, 'scale 高度比例');
                    return setOnce(f, 'scale', at(number(args[0], '大小', 0.01, 5), args[0]));
                case 'rotate':
                    count(1, 1, 'rotate 度');
                    return setOnce(f, 'rotate', at(number(args[0], '角度', -360, 360), args[0]));
                case 'opacity':
                    count(1, 1, 'opacity 0..1');
                    return setOnce(f, 'opacity', at(number(args[0], '不透明度', 0, 1), args[0]));
                case 'flip':
                    count(1, 1, 'flip on|off');
                    return setOnce(f, 'flip', at(onOff(args[0], '翻转'), args[0]));
                case 'blend':
                    count(1, 1, `blend ${ASSET_BLENDS.join('|')}`);
                    return setOnce(f, 'blend', at(oneOf(args[0], ASSET_BLENDS, '混合方式'), args[0]));
                case 'follow': {
                    count(1, 2, 'follow off|scene|motion [程度 0..1]');
                    const mode = oneOf<FollowMode>(args[0], FOLLOW_MODES, '跟随方式');
                    if (mode === 'off' && args[1]) fail('follow off 不带程度', args[1], 'LS112');
                    return setOnce(f, 'follow', at({ mode, amount: args[1] ? number(args[1], '跟随程度', 0, 1) : 1 }, args[0], args.at(-1)));
                }
                case 'enter':
                case 'exit': {
                    const key = current.head.text as 'enter' | 'exit';
                    count(2, 2, `${key} <${CLIP_ANIMATIONS.join('|')}> 秒`);
                    return setOnce(f, key, at({ type: oneOf<ClipAnimationType>(args[0], CLIP_ANIMATIONS, '动画'), duration: number(args[1], '时长', 0, 30) }, args[0], args[1]));
                }
                case 'effect': {
                    count(1, 5, `effect <${CLIP_EFFECTS.join('|')}> [#颜色] [幅度 0..1] [不透明度 0..1] [周期秒]`);
                    const type = oneOf<ClipEffectType>(args[0], CLIP_EFFECTS, '附加效果');
                    if (type === 'none' && args[1]) fail('effect none 不带参数', args[1], 'LS112');
                    if (args[1] && !isColor(args[1].text)) fail('颜色写成 #rrggbb', args[1], 'LS119');
                    return setOnce(f, 'effect', at({
                        type,
                        color: args[1]?.text.toLowerCase(),
                        size: args[2] ? number(args[2], '幅度', 0, 1) : undefined,
                        opacity: args[3] ? number(args[3], '效果的不透明度', 0, 1) : undefined,
                        period: args[4] ? number(args[4], '周期', 0.3, 8) : undefined,
                    }, args[0], args.at(-1)));
                }
                case 'motion': {
                    count(1, 2, `motion <${CLIP_MOTIONS.join('|')}> [幅度 0..1]`);
                    const type = oneOf<ClipMotionType>(args[0], CLIP_MOTIONS, '持续运动');
                    if (type === 'none' && args[1]) fail('motion none 不带幅度', args[1], 'LS112');
                    return setOnce(f, 'motion', at({ type, amount: args[1] ? number(args[1], '幅度', 0, 1) : undefined }, args[0], args.at(-1)));
                }
                default:
                    return unknown(CLIP_KEYWORDS, '素材片段');
            }
        });
        doc.clips.push(node);
    };

    const source = (args: Token[]): SourceNode => {
        const [head, ...rest] = args;
        const kind = oneOf(head, ['theme', 'cover', 'gradient', 'image', 'video'] as const, '背景来源');
        if (kind === 'theme' || kind === 'cover') {
            if (rest.length) fail('多余的参数', rest[0], 'LS112');
            return { type: kind };
        }
        if (kind === 'gradient') {
            count(4, 4, 'source gradient #rrggbb #rrggbb 角度');
            if (!isColor(rest[0].text)) fail('颜色写成 #rrggbb', rest[0], 'LS119');
            if (!isColor(rest[1].text)) fail('颜色写成 #rrggbb', rest[1], 'LS119');
            return { type: 'gradient', from: rest[0].text.toLowerCase(), to: rest[1].text.toLowerCase(), angle: number(rest[2], '角度', -360, 360) };
        }
        const asset = assetRef(rest[0]);
        if (kind === 'image') {
            if (rest.length > 1) fail('多余的参数', rest[1], 'LS112');
            return { type: 'image', asset };
        }
        let offset = 0;
        let loop = false;
        for (let i = 1; i < rest.length; i += 1) {
            if (rest[i].text === 'loop') loop = true;
            else if (rest[i].text === 'offset') {
                offset = number(rest[i + 1], '视频起点', 0);
                i += 1;
            } else fail('视频背景写成 source video <素材> [offset 秒] [loop]', rest[i], 'LS112');
        }
        return { type: 'video', asset, offset, loop };
    };

    const backgroundBlock = () => {
        const node: BackgroundNode = { line: current.line, head: at('background', current.head), id: blockId('background [<id>] { … }'), fields: {} };
        const f = node.fields;
        each(current.block!, () => {
            noBlock();
            const args = current.args;
            switch (current.head.text) {
                case 'source':
                    return setOnce(f, 'source', at(source(args), args[0] ?? current.head, args.at(-1) ?? current.head));
                case 'at':
                    return setOnce(f, 'at', at(timing(args), args[0] ?? current.head, args.at(-1) ?? current.head));
                case 'fit':
                    count(1, 1, 'fit cover|contain');
                    return setOnce(f, 'fit', at(oneOf(args[0], ['cover', 'contain'] as const, '适配'), args[0]));
                case 'ken-burns':
                    count(1, 1, 'ken-burns 0..0.5');
                    return setOnce(f, 'kenBurns', at(number(args[0], '推近幅度', 0, 0.5), args[0]));
                case 'blur':
                    count(1, 1, 'blur 像素');
                    return setOnce(f, 'blur', at(number(args[0], '模糊', 0, 100), args[0]));
                case 'dim':
                    count(1, 1, 'dim 0..1');
                    return setOnce(f, 'dim', at(number(args[0], '压暗', 0, 1), args[0]));
                case 'fade':
                    count(2, 2, 'fade 淡入秒 淡出秒');
                    return setOnce(f, 'fade', at([number(args[0], '淡入', 0, 30), number(args[1], '淡出', 0, 30)] as [number, number], args[0], args[1]));
                default:
                    return unknown(BACKGROUND_KEYWORDS, '背景片段');
            }
        });
        doc.backgrounds.push(node);
    };

    // ---- 顶层
    each(cst.statements, () => {
        const head = current.head.text;
        const args = current.args;
        if (head === 'paragraph') return paragraphBlock();
        if (head === 'clip') return clipBlock();
        if (head === 'background') return backgroundBlock();
        noBlock();
        switch (head) {
            case 'lumiscript': {
                count(1, 1, `lumiscript ${SCRIPT_VERSION}`);
                const version = integer(args[0], '版本');
                if (version !== SCRIPT_VERSION) fail(`这是 LumiScript ${version} 的剧本，现在只认 ${SCRIPT_VERSION}`, args[0], 'LS120');
                return setOnce(doc, 'version', at(version, args[0]));
            }
            case 'seed':
                count(1, 1, 'seed "种子"');
                return setOnce(doc, 'seed', at(str(args[0], '种子'), args[0]));
            case 'direction': {
                count(1, 2, 'direction single <包> | direction mix');
                const mode = oneOf(args[0], ['single', 'mix'] as const, '编排方式');
                if (mode === 'mix') {
                    if (args[1]) fail('direction mix 不带包（每种性质用哪个包写成 mix <性质> <包>）', args[1], 'LS112');
                    return setOnce(doc, 'direction', at({ mode }, args[0]));
                }
                if (!args[1]) fail('缺少包，写法：direction single <包>');
                return setOnce(doc, 'direction', at({ mode, pack: at(args[1].text, args[1]) }, args[0], args[1]));
            }
            case 'mix': {
                count(2, 2, 'mix <性质> <包>');
                const kind = at(oneOf(args[0], PARAGRAPH_KINDS, '段落性质'), args[0]);
                const existing = doc.mix.find(item => item.kind.value === kind.value);
                if (existing) {
                    diagnostics.push(warning('LS902', spanOf(current.line, current.head, args[0]), `重复的 mix ${kind.value}，以这一行为准`, { related: [{ line: existing.kind.line, message: '前面写过' }] }));
                    doc.mix = doc.mix.filter(item => item !== existing);
                }
                doc.mix.push({ kind, pack: at(args[1].text, args[1]) });
                return;
            }
            case 'shot-mixing':
                count(1, 1, 'shot-mixing on|off');
                return setOnce(doc, 'shotMixing', at(onOff(args[0], 'shot-mixing'), args[0]));
            case 'lyric-offset':
                count(1, 1, 'lyric-offset 秒（正值推迟）');
                return setOnce(doc, 'lyricOffset', at(number(args[0], '歌词偏移', -30, 30), args[0]));
            case 'paragraphs':
                count(1, 1, 'paragraphs auto');
                oneOf(args[0], ['auto'] as const, 'paragraphs 的取值');
                return setOnce(doc, 'paragraphsAuto', spanOf(current.line, current.head, args[0]));
            case 'backgrounds':
            case 'clips': {
                count(1, 1, `${head} none`);
                oneOf(args[0], ['none'] as const, `${head} 的取值`);
                return setOnce(doc, head === 'clips' ? 'clipsNone' : 'backgroundsNone', spanOf(current.line, current.head, args[0]));
            }
            default:
                return unknown(TOP_KEYWORDS, '剧本顶层');
        }
    });
    diagnostics.sort((a, b) => a.line - b.line || (a.from ?? 0) - (b.from ?? 0));
    return { doc, diagnostics };
};

/** 行号 → 语句开头的词（补全、悬停判断上下文用）：从 CST 找光标所在的块链。 */
export const blockPath = (text: string, lineNumber: number): Statement[] => {
    const { statements } = parseCst(text);
    const path: Statement[] = [];
    let level = statements;
    for (;;) {
        const owner = level.find(item => item.block && item.line < lineNumber && (item.endLine === null || item.endLine >= lineNumber));
        if (!owner) return path;
        path.push(owner);
        level = owner.block!;
    }
};

