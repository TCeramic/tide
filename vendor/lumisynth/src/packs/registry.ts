// src/packs/registry.ts
// 风格包注册表。内置包由 `src/packs/builtin.ts` 自动发现并注册（src/packs/<id>/pack.ts 的默认导出）；应用入口与测试都先导入它。
import type { FamilyDef, PackId, StyleDef, StylePack, TransitionDef } from './contract';

const packs = new Map<PackId, StylePack>();
let styleIndex: Map<string, StyleDef> | null = null;
let transitionIndex: Map<string, TransitionDef> | null = null;
const listeners = new Set<() => void>();

export const registerPack = (pack: StylePack) => {
    if (packs.has(pack.id)) throw new Error(`风格包 ${pack.id} 已注册`);
    if (pack.id.includes('/')) throw new Error(`风格包 id 不能含 "/"：${pack.id}`);
    for (const style of pack.styles) {
        if (style.pack !== pack.id || style.id !== `${pack.id}/${style.kind}`) throw new Error(`风格 ${style.id} 的 id 与包不符`);
    }
    for (const transition of pack.transitions) {
        if (transition.pack !== pack.id || transition.id !== `${pack.id}/${transition.kind}`) throw new Error(`转场 ${transition.id} 的 id 与包不符`);
    }
    packs.set(pack.id, pack);
    styleIndex = null;
    transitionIndex = null;
    listeners.forEach(listener => listener());
};

export const onPacksChanged = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const listPacks = (): StylePack[] => [...packs.values()];
export const hasPack = (id: PackId) => packs.has(id);

export const getPack = (id: PackId): StylePack => {
    const pack = packs.get(id);
    if (!pack) throw new Error(`未注册的风格包：${id}`);
    return pack;
};

export const findPack = (id: PackId): StylePack | undefined => packs.get(id);

/** 第一个注册的包；工程里指定的包不存在时退回它。 */
export const defaultPackId = (): PackId => {
    const first = packs.keys().next();
    if (first.done) throw new Error('没有注册任何风格包');
    return first.value;
};

export const allStyles = (): StyleDef[] => listPacks().flatMap(pack => pack.styles);
export const allFamilies = (): FamilyDef[] => listPacks().flatMap(pack => pack.families);
export const allTransitions = (): TransitionDef[] => listPacks().flatMap(pack => pack.transitions);

export const getStyle = (id: string): StyleDef | undefined => {
    styleIndex ??= new Map(allStyles().map(style => [style.id, style]));
    return styleIndex.get(id);
};

export const getTransition = (id: string): TransitionDef | undefined => {
    transitionIndex ??= new Map(allTransitions().map(transition => [transition.id, transition]));
    return transitionIndex.get(id);
};

export const familyLabel = (pack: PackId, family: string) => (
    findPack(pack)?.families.find(item => item.id === family)?.label ?? family
);

export const splitStyleId = (id: string): { pack: PackId; kind: string } => {
    const slash = id.indexOf('/');
    return { pack: id.slice(0, slash), kind: id.slice(slash + 1) };
};

/**
 * 跨包借排版：`host` 包 `kind` 风格的镜头能借用的其他包的排版（值为 `<客包>/<排版>`）。
 * 宿主要能隐藏自己的字并给出这个风格的文字区域，客包要导出排版并能按 span 造镜头。
 */
export const borrowableTypographies = (host: PackId, kind: string): Array<{ value: string; label: string; pack: PackId }> => {
    const hostPack = findPack(host);
    if (!hostPack?.hideText || !hostPack.textRegion?.(kind)) return [];
    return listPacks()
        .filter(pack => pack.id !== host && pack.fromSpan && pack.textOnlyTuning)
        .flatMap(pack => (pack.typographyExports ?? [])
            .filter(item => pack.textRegion?.(item.kind))
            .map(item => ({ value: `${pack.id}/${item.id}`, label: `${pack.shortLabel} · ${item.label}`, pack: pack.id })));
};
