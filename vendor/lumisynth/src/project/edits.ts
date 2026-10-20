// src/project/edits.ts
// 编辑器对工程的修改都在这里：段落 Direction、段落转场、锁定 shot 风格、行的时间与分词、
// 风格库偏好。每个函数只产出新的工程对象（经 updateProject 进撤销栈）。
import type {
    EditOp,
    LumiParagraph,
    LumiShot,
    PackId,
    ParagraphAnchor,
    ParagraphDirectionOverride,
    ShotAnchor,
    StyleId,
    TransitionId,
} from '@/compiler/types';
import type { LineAnchor } from '@/core/lyrics/edits';
import { findPack, getStyle } from '@/packs/registry';
import { newId } from './defaults';
import { updateProject } from './store';
import type { LumiProject } from './types';

const sameLine = (a: LineAnchor, b: LineAnchor) => a.index === b.index && a.hash === b.hash;
const sameParagraph = (a: ParagraphAnchor, b: ParagraphAnchor) => sameLine(a.line, b.line);

// ---------------------------------------------------------------------------------------------
// 段落 Direction

export type DirectionPatch = {
    pack?: PackId | 'auto';
    energy?: number | null | 'auto';
    families?: string[] | null | 'auto';
};

/** 'auto' 表示去掉该字段的覆盖，交回自动规则。 */
export const patchParagraphDirection = (project: LumiProject, anchor: ParagraphAnchor, patch: DirectionPatch, source: 'user' | 'ai' = 'user'): LumiProject => {
    const existing = project.paragraphDirections.find(item => sameParagraph(item.anchor, anchor));
    const next: ParagraphDirectionOverride = { anchor, source, ...(existing ?? {}) };
    next.source = source;
    if (patch.pack !== undefined) {
        if (patch.pack === 'auto') delete next.pack;
        else next.pack = patch.pack;
    }
    if (patch.energy !== undefined) {
        if (patch.energy === 'auto') delete next.energy;
        else next.energy = patch.energy;
    }
    if (patch.families !== undefined) {
        if (patch.families === 'auto') delete next.families;
        else next.families = patch.families;
    }
    const empty = next.pack === undefined && next.energy === undefined && next.families === undefined;
    const others = project.paragraphDirections.filter(item => !sameParagraph(item.anchor, anchor));
    return { ...project, paragraphDirections: empty ? others : [...others, next] };
};

export const setParagraphDirection = (paragraph: LumiParagraph, patch: DirectionPatch) => updateProject(
    project => patchParagraphDirection(project, paragraph.anchor, patch),
    { coalesce: `direction:${paragraph.anchor.line.index}:${Object.keys(patch).join(',')}` },
);

// ---------------------------------------------------------------------------------------------
// 段落转场

/** 'auto' 删除覆盖；'none' 表示这个边界不要转场。 */
export const withParagraphTransition = (project: LumiProject, anchor: ParagraphAnchor, transition: TransitionId | 'none' | 'auto'): LumiProject => {
    const others = project.overrides.filter(op => !(op.type === 'transition' && sameParagraph(op.anchor, anchor)));
    if (transition === 'auto') return { ...project, overrides: others };
    const op: EditOp = { id: newId(), type: 'transition', anchor, transition };
    return { ...project, overrides: [...others, op] };
};

export const setParagraphTransition = (paragraph: LumiParagraph, transition: TransitionId | 'none' | 'auto') => updateProject(project => (
    withParagraphTransition(project, paragraph.anchor, transition)
));

// ---------------------------------------------------------------------------------------------
// shot 风格锁定

/** 这个包的镜头有这个组件槽与取值（借用的排版由编译时细查）。 */
const fitsPack = (pack: PackId, slot: string, value: string) => {
    const def = findPack(pack)?.componentSlots?.find(item => item.id === slot);
    return Boolean(def && (def.options.some(option => option.id === value) || (slot === 'typography' && value.includes('/'))));
};

/** style 为 null 时解锁。换成别的包的风格时，这个镜头上那个包用不上的组件一起去掉。 */
export const withShotStyle = (project: LumiProject, anchor: ShotAnchor, style: StyleId | null): LumiProject => {
    const pack = style ? getStyle(style)?.pack : undefined;
    const others = project.overrides.filter(op => {
        if (op.type === 'transition' || !sameLine(op.anchor.line, anchor.line) || op.anchor.slot !== anchor.slot) return true;
        if (op.type === 'shot-style') return false;
        return !pack || fitsPack(pack, op.slot, op.value);
    });
    if (style === null) return { ...project, overrides: others };
    const op: EditOp = { id: newId(), type: 'shot-style', anchor, style };
    return { ...project, overrides: [...others, op] };
};

export const lockShotStyle = (shot: LumiShot, style: StyleId) => updateProject(project => withShotStyle(project, shot.anchor, style));

export const unlockShotStyle = (shot: LumiShot) => updateProject(project => withShotStyle(project, shot.anchor, null));

/** 把当前自动选出的风格固定下来（换 seed 也不变）。 */
export const lockCurrentStyle = (shot: LumiShot) => lockShotStyle(shot, shot.style);

// 歌词的修改（偏移、时间、改字、逐字、分词）见 project/lyrics.ts。

// ---------------------------------------------------------------------------------------------
// 风格库偏好

export const toggleFavorite = (style: StyleId) => updateProject(project => {
    const favorites = project.library.favorites.includes(style)
        ? project.library.favorites.filter(item => item !== style)
        : [...project.library.favorites, style];
    return { ...project, library: { ...project.library, favorites, blocked: project.library.blocked.filter(item => item !== style) } };
});

export const toggleBlocked = (style: StyleId) => updateProject(project => {
    const blocked = project.library.blocked.includes(style)
        ? project.library.blocked.filter(item => item !== style)
        : [...project.library.blocked, style];
    return { ...project, library: { ...project.library, blocked, favorites: project.library.favorites.filter(item => item !== style) } };
});

// ---------------------------------------------------------------------------------------------
// 路线 E：逐镜头替换组件（排版、点缀……）

/** value 为 'auto' 时删除该槽的覆盖。 */
export const withShotComponent = (project: LumiProject, anchor: ShotAnchor, slot: string, value: string | 'auto'): LumiProject => {
    const others = project.overrides.filter(op => !(op.type === 'shot-component'
        && sameLine(op.anchor.line, anchor.line) && op.anchor.slot === anchor.slot && op.slot === slot));
    if (value === 'auto') return { ...project, overrides: others };
    const op: EditOp = { id: newId(), type: 'shot-component', anchor, slot, value };
    return { ...project, overrides: [...others, op] };
};

export const setShotComponent = (shot: LumiShot, slot: string, value: string | 'auto') => updateProject(project => (
    withShotComponent(project, shot.anchor, slot, value)
));
