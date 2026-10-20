// src/app/script/lumiscript.ts
// CodeMirror 6 对 LumiScript v2 的支持：语法高亮、按块上下文的自动补全、悬停说明、实时检查（整个应用
// 流程走一遍，编译阶段的错误也标得出来）与快速修复。设置（JSON sidecar）也在这里：高亮与实时检查。
// 需要工程与编排的部分（风格、素材、检查）通过 getEnv 取最新的值。
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { linter, lintGutter, type Action, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorView, hoverTooltip } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { Tag, tags } from '@lezer/highlight';
import { PARAGRAPH_KINDS } from '@/compiler/types';
import { ASSET_SLOTS, CLIP_ANIMATIONS, CLIP_EFFECTS, CLIP_MOTIONS } from '@/core/assets/clips';
import { allFamilies, borrowableTypographies, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import type { LumiProject } from '@/project/types';
import { lintScript, type ScriptEnv } from '@/script/apply';
import type { Diagnostic } from '@/script/diagnostics';
import { ASSET_BLENDS, BACKGROUND_KEYWORDS, blockPath, CLIP_KEYWORDS, LINE_KEYWORDS, PARAGRAPH_KEYWORDS, TOP_KEYWORDS } from '@/script/parse';
import { KIND_LABELS } from '@/script/print';
import { applySettings } from '@/script/settings';
import { shortId } from '@/script/syntax';

// ---------------------------------------------------------------------------------------------
// 高亮

const timeTag = Tag.define();
const idTag = Tag.define();
const colorTag = Tag.define();

const KEYWORDS = new Set([...TOP_KEYWORDS, ...PARAGRAPH_KEYWORDS, ...LINE_KEYWORDS, ...CLIP_KEYWORDS, ...BACKGROUND_KEYWORDS]);
const CONSTANTS = new Set(['auto', 'none', 'all', 'on', 'off', 'song', 'missing', 'single', 'mix', 'loop', 'offset', 'scene', 'motion', '@ai', 'locked']);

const streamParser: StreamParser<unknown> = {
    token(stream) {
        if (stream.eatSpace()) return null;
        const previous = stream.pos === 0 ? ' ' : stream.string.charAt(stream.pos - 1);
        if (/\s/.test(previous) && stream.match(/^#(?=\s|$)/, false)) {
            stream.skipToEnd();
            return 'comment';
        }
        if (stream.peek() === '"') {
            stream.next();
            let escaped = false;
            for (let char = stream.next(); char !== undefined && char !== null; char = stream.next()) {
                if (!escaped && char === '"') break;
                escaped = !escaped && char === '\\';
            }
            return 'string';
        }
        if (stream.match(/^#[0-9a-fA-F]{6}(?![\w])/)) return 'color';
        if (stream.match(/^@ai\b/)) return 'atom';
        if (stream.match(/^\d+:\d{1,2}(?:\.\d+)?(?:-\d+:\d{1,2}(?:\.\d+)?)?/)) return 'time';
        if (stream.match(/^[a-z][\w-]*\/[\w-]+/)) return 'id';
        if (stream.match(/^-?\d+(?:\.\d+)?(?:\.\.\d+)?/)) return 'number';
        if (stream.match(/^[A-Za-z][\w-]*/)) {
            const word = stream.current();
            if (KEYWORDS.has(word)) return 'keyword';
            if (CONSTANTS.has(word)) return 'atom';
            return 'variableName';
        }
        if (stream.match(/^[{}]/)) return 'brace';
        stream.next();
        return null;
    },
    tokenTable: { time: timeTag, id: idTag, color: colorTag },
};

const lumiscriptLanguage = StreamLanguage.define(streamParser);

const jsonParser: StreamParser<unknown> = {
    token(stream) {
        if (stream.eatSpace()) return null;
        if (stream.peek() === '"') {
            stream.next();
            let escaped = false;
            for (let char = stream.next(); char !== undefined && char !== null; char = stream.next()) {
                if (!escaped && char === '"') break;
                escaped = !escaped && char === '\\';
            }
            // 键（后面跟冒号）与值分开着色。
            return /^\s*:/.test(stream.string.slice(stream.pos)) ? 'propertyName' : 'string';
        }
        if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number';
        if (stream.match(/^(true|false|null)\b/)) return 'atom';
        if (stream.match(/^[{}[\]]/)) return 'brace';
        stream.next();
        return null;
    },
};

const jsonLanguage = StreamLanguage.define(jsonParser);

const highlight = HighlightStyle.define([
    { tag: tags.comment, color: '#71717a', fontStyle: 'italic' },
    { tag: tags.string, color: '#fde68a' },
    { tag: tags.keyword, color: '#f0abfc' },
    { tag: tags.atom, color: '#c4b5fd' },
    { tag: tags.number, color: '#fdba74' },
    { tag: tags.variableName, color: '#e4e4e7' },
    { tag: tags.propertyName, color: '#93c5fd' },
    { tag: tags.brace, color: '#a1a1aa' },
    { tag: timeTag, color: '#7dd3fc' },
    { tag: idTag, color: '#6ee7b7' },
    { tag: colorTag, color: '#fca5a5' },
]);

export const scriptTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: '#09090b', color: '#d4d4d8', fontSize: '12px' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '20px' },
    '.cm-content': { caretColor: '#e4e4e7' },
    '.cm-gutters': { backgroundColor: '#09090b', color: '#52525b', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(39, 39, 42, 0.45)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a1a1aa' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(56, 189, 248, 0.25) !important' },
    '.cm-script-selected': { backgroundColor: 'rgba(12, 74, 110, 0.4)' },
    '.cm-script-playing': { boxShadow: 'inset 2px 0 0 #fcd34d' },
    '.cm-tooltip': { backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#e4e4e7' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#0c4a6e', color: '#f4f4f5' },
    '.cm-completionDetail': { color: '#a1a1aa', marginLeft: '8px', fontStyle: 'normal' },
    '.cm-script-hover': { padding: '4px 8px', maxWidth: '380px', fontSize: '12px', lineHeight: '18px' },
    '.cm-diagnostic': { fontSize: '12px', whiteSpace: 'pre-wrap' },
    '.cm-diagnosticSource': { color: '#71717a' },
    '.cm-diagnosticAction': { backgroundColor: '#0c4a6e', color: '#f4f4f5', borderRadius: '3px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #f87171', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #fbbf24', textUnderlineOffset: '3px' },
    '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted #7dd3fc', textUnderlineOffset: '3px' },
}, { dark: true });

// ---------------------------------------------------------------------------------------------
// 说明（悬停与补全共用）

export const KEYWORD_DOCS: Record<string, string> = {
    lumiscript: 'lumiscript 2：剧本的版本（可以不写）。',
    seed: 'seed "种子"：全曲的随机种子，改了会重新自动选择风格、转场。',
    direction: 'direction single <包>：全曲一个包；direction mix：按段落性质分配包（见 mix）。',
    mix: 'mix <性质> <包>：混用时这种性质的段落用哪个包（没写的用默认）。',
    'shot-mixing': 'shot-mixing on|off：段内可以出现别的包的镜头（锁定别的包的风格时需要）。',
    'lyric-offset': 'lyric-offset 秒：歌词整体偏移（正值推迟）。line 的时间是歌词文件的时间，不含它。',
    paragraphs: 'paragraphs auto：分段、段落编排、转场、镜头全部交回自动（不能和段落块一起写）。',
    paragraph: 'paragraph <性质> [locked] { … }：一段。块里的 line（或 lines a..b）决定这一段包含哪些歌词行；只要写了一个段落块，所有段落都按剧本来。自动选出的值照常写着，改了就固定下来。',
    locked: 'locked：固定下来（换 seed、换编排方式也不变）。改了值会自动加上；去掉就交回自动。',
    lines: 'lines a..b：这一段包含的歌词行（从 1 起），不写 line 语句时用。',
    line: 'line 行号 m:ss.cc-m:ss.cc "歌词" [{ translation … / parts … / word … }]：一行歌词，时间是歌词文件的时间。改字时没变的字保留时间；块里可以写译文、手动分词与逐字时间。',
    translation: 'translation "译文" | none：这一行的译文（字幕）；none 不显示；不写就用歌词文件里的译文。',
    parts: 'parts "词" "词" …：手动分词，拼起来要等于这一行的文字；不写就用自动分词。',
    word: 'word m:ss.cc-m:ss.cc "字"：逐字时间（按顺序、不重叠、在行的时间内）；不写就按改字规则推出来。',
    pack: 'pack <包>|auto [locked|@ai]：这一段用哪个风格包。',
    energy: 'energy 0..1|auto [locked|@ai]：这一段的能量，影响挑选的风格。',
    families: 'families <族…>|all|auto [locked|@ai]：这一段允许的镜头族；all 不限。',
    transition: 'transition <转场>|none|auto [locked|@ai]：这一段的出场转场。',
    shot: 'shot N <风格>|auto [locked] [{ <组件槽> <取值> [locked] … }]：这一段的第 N 个镜头。改风格就锁定；块里是它的组件（排版、点缀……），改了就逐镜头替换。',
    '@ai': '@ai：这条编排来自 AI（「清除 AI 编排」会清掉它）。',
    clips: 'clips none：没有素材片段（删除全部）。',
    backgrounds: 'backgrounds none：没有背景片段（删除全部）。',
    clip: 'clip [<id>] { … }：一个素材片段。写了素材片段块，没写到的片段就删除；新片段不写 id。',
    background: 'background [<id>] { … }：一个背景片段。块的先后就是叠放顺序（后面的盖住前面的）；新背景不写 id。',
    asset: 'asset <素材 id 前几位>|"文件名"：素材库里的图片。',
    at: 'at song | m:ss.cc-m:ss.cc | lines a..b | paragraph N | shot P.S：挂在哪里。missing 表示锚点已失效，保持不变。',
    extend: 'extend 提前秒 延后秒：比挂载的时间提前出现 / 延后消失。',
    slot: 'slot back|mid|front|overlay：场景之下 / 场景之上、歌词之下 / 歌词之上 / 最上层。',
    position: 'position x y：中心点，画面宽高的比例（0..1）。',
    scale: 'scale：高度占画面高度的比例。',
    rotate: 'rotate：角度（度）。',
    opacity: 'opacity 0..1：不透明度。',
    flip: 'flip on|off：水平翻转。',
    blend: 'blend normal|add|multiply|screen：混合方式。',
    enter: 'enter <动画> 秒：入场动画。',
    exit: 'exit <动画> 秒：退场动画。',
    follow: 'follow off|scene|motion [程度]：跟随运镜。scene 贴在场景上（切镜头时跟着跳），motion 只跟随镜头内的运动；程度 0..1，默认 1。',
    effect: 'effect none|echo|glow|shadow [#颜色] [幅度] [不透明度] [周期秒]：剪影效果（重影扩张 / 外发光 / 投影）。',
    motion: 'motion none|float|drift|push|sway [幅度]：持续运动（漂浮 / 横移 / 推近 / 摇摆）。',
    source: 'source theme | cover | gradient #rrggbb #rrggbb 角度 | image <素材> | video <素材> [offset 秒] [loop]。',
    fit: 'fit cover|contain：铺满（裁切）/ 完整显示。',
    'ken-burns': 'ken-burns：片段内缓慢推近的幅度（0.06 = 放大 6%）。',
    blur: 'blur：模糊（像素，按 1080p 计）。',
    dim: 'dim 0..1：叠一层主题背景色来压暗。',
    fade: 'fade 淡入秒 淡出秒。',
    auto: '交回自动。',
};

const describeWord = (word: string, env: ScriptEnv): string | null => {
    if (KEYWORD_DOCS[word]) return KEYWORD_DOCS[word];
    if (KIND_LABELS[word as keyof typeof KIND_LABELS]) return `段落性质：${KIND_LABELS[word as keyof typeof KIND_LABELS]}`;
    const style = getStyle(word);
    if (style) {
        const family = findPack(style.pack)?.families.find(item => item.id === style.family);
        return `风格 · ${findPack(style.pack)?.label ?? style.pack} · 族「${family?.label ?? style.family}」· ${style.mood}${family?.description ? `\n${family.description}` : ''}`;
    }
    const transition = getTransition(word);
    if (transition) return `转场 · ${transition.label}`;
    const pack = findPack(word);
    if (pack) return `风格包「${pack.label}」：${pack.description}`;
    const asset = word.length >= 4 ? env.project.assets.find(item => item.id.startsWith(word)) : undefined;
    if (asset) return `素材「${asset.name}」（${asset.kind === 'video' ? '视频，只能用作背景' : '图片'}）`;
    const family = allFamilies().find(item => item.id === word);
    if (family) return `镜头族「${family.label}」（${findPack(family.pack)?.shortLabel ?? family.pack}）${family.description ? `：${family.description}` : ''}`;
    return null;
};

// ---------------------------------------------------------------------------------------------
// 补全

const packOptions = (): Completion[] => listPacks().map(pack => ({ label: pack.id, detail: pack.label, type: 'constant' }));
const words = (items: readonly string[], type = 'keyword', detail?: (item: string) => string | undefined): Completion[] => (
    items.map(item => ({ label: item, type, detail: detail?.(item) }))
);
const auto: Completion = { label: 'auto', type: 'constant', detail: '交回自动' };
const ai: Completion = { label: '@ai', type: 'constant', detail: '来自 AI' };
const locked: Completion = { label: 'locked', type: 'constant', detail: '固定下来' };

const assetOptions = (project: LumiProject, kind: 'image' | 'video'): Completion[] => project.assets
    .filter(asset => asset.kind === kind)
    .map(asset => ({ label: shortId(asset.id), detail: asset.name, type: 'variable' }));

const timingOptions = (): Completion[] => words(['song', 'paragraph', 'lines', 'shot', 'missing'], 'constant');

/** 镜头块里：这个镜头的风格（写了就用写的，否则用编排里这一段第 N 个镜头的风格）。 */
const shotStyleAt = (doc: Text, env: ScriptEnv, paragraphLine: number, header: string[]) => {
    if (header[2] && header[2].includes('/')) return getStyle(header[2]);
    let index = -1;
    for (let n = 1; n <= paragraphLine; n += 1) if (/^paragraph\b/.test(doc.line(n).text)) index += 1;
    const shot = env.program.paragraphs[index]?.shots[Number(header[1]) - 1];
    return shot ? getStyle(shot.style) : undefined;
};

const completionSource = (getEnv: () => ScriptEnv) => (completion: CompletionContext): CompletionResult | null => {
    const word = completion.matchBefore(/[\w/#.@-]*/);
    if (!word) return null;
    const line = completion.state.doc.lineAt(completion.pos);
    const before = line.text.slice(0, word.from - line.from);
    if ((before.match(/"/g)?.length ?? 0) % 2 === 1 || /(^|\s)#\s/.test(before)) return null;
    const tokens = before.trim() ? before.trim().split(/\s+/) : [];
    const env = getEnv();
    const { project } = env;
    const path = blockPath(completion.state.doc.toString(), line.number);
    const block = path.at(-1)?.head.text ?? 'top';
    let options: Completion[] = [];

    if (tokens.length === 0) {
        if (block === 'top') options = words(TOP_KEYWORDS);
        else if (block === 'paragraph') options = words(PARAGRAPH_KEYWORDS);
        else if (block === 'line') options = words(LINE_KEYWORDS);
        else if (block === 'clip') options = words(CLIP_KEYWORDS);
        else if (block === 'background') options = words(BACKGROUND_KEYWORDS);
        else if (block === 'shot') {
            const owner = path.at(-1)!;
            const style = shotStyleAt(completion.state.doc, env, path[0].line, [owner.head.text, ...owner.args.map(token => token.text)]);
            options = (findPack(style?.pack ?? '')?.componentSlots ?? []).map(slot => ({ label: slot.id, detail: slot.label, type: 'property' }));
        }
        options = options.map(option => ({ ...option, info: KEYWORD_DOCS[option.label] }));
    } else {
        const [head] = tokens;
        const index = tokens.length; // 正在写第几个参数（1 起）
        if (block === 'top') {
            if (head === 'direction') options = index === 1 ? words(['single', 'mix'], 'constant') : tokens[1] === 'single' && index === 2 ? packOptions() : [];
            else if (head === 'mix') options = index === 1 ? words(PARAGRAPH_KINDS, 'constant', kind => KIND_LABELS[kind as keyof typeof KIND_LABELS]) : index === 2 ? packOptions() : [];
            else if (head === 'shot-mixing') options = words(['on', 'off'], 'constant');
            else if (head === 'paragraphs') options = [auto];
            else if (head === 'clips' || head === 'backgrounds') options = words(['none'], 'constant');
            else if (head === 'paragraph' && index === 1) options = [...words(PARAGRAPH_KINDS, 'constant', kind => KIND_LABELS[kind as keyof typeof KIND_LABELS]), auto];
            else if (head === 'paragraph' && index === 2) options = [locked];
        } else if (block === 'paragraph') {
            const hasValue = index >= 2;
            if (hasValue && ['pack', 'energy', 'families', 'transition'].includes(head)) options = [locked, ai];
            if (head === 'pack' && index === 1) options = [...packOptions(), auto];
            else if (head === 'energy' && index === 1) options = [auto];
            else if (head === 'families') options = [...allFamilies().map(family => ({ label: family.id, detail: `${family.label} · ${findPack(family.pack)?.shortLabel ?? family.pack}`, type: 'constant' })), ...(index === 1 ? words(['all', 'auto'], 'constant') : [locked, ai])];
            else if (head === 'transition' && index === 1) options = [...listPacks().flatMap(pack => pack.transitions.map(item => ({ label: item.id, detail: item.label, type: 'constant' }))), ...words(['none', 'auto'], 'constant')];
            else if (head === 'shot' && index === 2) options = [...listPacks().flatMap(pack => pack.styles.map(style => ({ label: style.id, detail: pack.families.find(item => item.id === style.family)?.label, type: 'class' }))), auto];
            else if (head === 'shot' && index === 3) options = [locked];
        } else if (block === 'shot') {
            const owner = path.at(-1)!;
            const style = shotStyleAt(completion.state.doc, env, path[0].line, [owner.head.text, ...owner.args.map(token => token.text)]);
            const slot = findPack(style?.pack ?? '')?.componentSlots?.find(item => item.id === head);
            if (slot && index === 2) options = [locked];
            if (slot && index === 1) {
                options = [...slot.options.map(option => ({ label: option.id, detail: option.label, type: 'constant' })), auto];
                if (slot.id === 'typography' && style) options.push(...borrowableTypographies(style.pack, style.kind).map(option => ({ label: option.value, detail: `借用：${option.label}`, type: 'constant' })));
            }
        } else if (block === 'clip') {
            if (head === 'asset') options = assetOptions(project, 'image');
            else if (head === 'at' && index === 1) options = timingOptions();
            else if (head === 'slot') options = words(ASSET_SLOTS, 'constant');
            else if (head === 'blend') options = words(ASSET_BLENDS, 'constant');
            else if ((head === 'enter' || head === 'exit') && index === 1) options = words(CLIP_ANIMATIONS, 'constant');
            else if (head === 'effect' && index === 1) options = words(CLIP_EFFECTS, 'constant');
            else if (head === 'motion' && index === 1) options = words(CLIP_MOTIONS, 'constant');
            else if (head === 'follow' && index === 1) options = [
                { label: 'off', detail: '不跟随', type: 'constant' },
                { label: 'scene', detail: '贴在场景上', type: 'constant' },
                { label: 'motion', detail: '只跟随运动', type: 'constant' },
            ];
            else if (head === 'flip') options = words(['on', 'off'], 'constant');
        } else if (block === 'background') {
            if (head === 'source' && index === 1) options = words(['theme', 'cover', 'gradient', 'image', 'video'], 'constant');
            else if (head === 'source' && index === 2 && (tokens[1] === 'image' || tokens[1] === 'video')) options = assetOptions(project, tokens[1]);
            else if (head === 'source' && tokens[1] === 'video' && index >= 3) options = words(['offset', 'loop'], 'constant');
            else if (head === 'at' && index === 1) options = timingOptions();
            else if (head === 'fit') options = words(['cover', 'contain'], 'constant');
        }
    }
    if (options.length === 0) return null;
    return { from: word.from, options, validFor: /^[\w/#.@-]*$/ };
};

// ---------------------------------------------------------------------------------------------
// 悬停、检查

const hover = (getEnv: () => ScriptEnv) => hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const offset = pos - line.from;
    let from = offset;
    let to = offset;
    while (from > 0 && /[\w/.@-]/.test(line.text[from - 1])) from -= 1;
    while (to < line.text.length && /[\w/.@-]/.test(line.text[to])) to += 1;
    if (from === to) return null;
    const text = describeWord(line.text.slice(from, to), getEnv());
    if (!text) return null;
    return {
        pos: line.from + from,
        end: line.from + to,
        above: true,
        create: () => {
            const dom = document.createElement('div');
            dom.className = 'cm-script-hover';
            dom.textContent = text;
            return { dom };
        },
    };
});

const position = (doc: Text, lineNumber: number, column: number) => {
    const line = doc.line(Math.min(Math.max(1, lineNumber), doc.lines));
    return line.from + Math.min(Math.max(0, column), line.length);
};

/** 剧本的诊断 → CodeMirror 的诊断（行号 1 起、列 0 起；超出范围的收拢到行内）。提示、相关位置写进说明，快速修复变成按钮。 */
export const toCmDiagnostics = (doc: Text, diagnostics: Diagnostic[]): CmDiagnostic[] => diagnostics.map(item => {
    const line = doc.line(Math.min(Math.max(1, item.line), doc.lines));
    const from = line.from + Math.min(item.from ?? 0, line.length);
    const to = item.to === undefined ? line.to : line.from + Math.min(item.to, line.length);
    const message = [
        item.message,
        item.hint ? `→ ${item.hint}` : null,
        ...(item.related ?? []).map(related => `· 第 ${related.line} 行：${related.message}`),
    ].filter(Boolean).join('\n');
    const actions: Action[] = (item.fixes ?? []).map(fix => ({
        name: fix.label,
        apply: view => {
            const changes = fix.edits.map(edit => ({ from: position(view.state.doc, edit.line, edit.from), to: position(view.state.doc, edit.line, edit.to), insert: edit.insert }));
            view.dispatch({ changes });
        },
    }));
    return { from, to: Math.max(from, to), severity: item.severity, message, source: item.code, actions };
});

export const lumiscript = (getEnv: () => ScriptEnv): Extension => [
    lumiscriptLanguage,
    syntaxHighlighting(highlight),
    autocompletion({ override: [completionSource(getEnv)], icons: false }),
    hover(getEnv),
    linter(view => toCmDiagnostics(view.state.doc, lintScript(view.state.doc.toString(), getEnv())), { delay: 500 }),
    lintGutter(),
];

/** 设置（JSON）：高亮与实时检查。 */
export const settingsLanguage = (getProject: () => LumiProject): Extension => [
    jsonLanguage,
    syntaxHighlighting(highlight),
    linter(view => toCmDiagnostics(view.state.doc, applySettings(view.state.doc.toString(), getProject()).diagnostics), { delay: 400 }),
    lintGutter(),
];
