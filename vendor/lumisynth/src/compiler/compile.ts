// src/compiler/compile.ts
// 统一编译器：歌词 + Direction + EditOp → LumiProgram。
//   ① Structure  统一切片、统一分段（structure.ts，与风格包无关）
//   ② Direction  每段用哪个包、energy、允许的族（自动规则 / 用户 / AI）
//   ③ Chunk      该段所属包切镜头
//   ④ Cast       在候选池里选风格（风格库收藏 / 屏蔽、族、energy、锁定）
//   ⑤ Dress      镜头、flow、装饰、转场（包的编译逻辑与转场目录）
//   ⑥ Overrides  用户锁定的风格与转场；锚点失效的修改进 invalidOps，不静默丢弃
// 编译器只经注册表访问风格包（src/packs/registry.ts），不认识任何具体的包。
// 使用 FOLIA_COMPATIBLE_PARAMS 且不给编排修改时，内置包的单包结果与 folia 的 compile*Program 逐字段相等
// （test/unit/compiler/equivalence.test.ts）。
import type { Line } from '@/core/types';
import { anchorOfLine } from '@/core/lyrics/edits';
import { getLineRenderEndTime } from '@/core/lyrics/renderHints';
import type { CastContext, StylePack } from '@/packs/contract';
import { defaultPackId, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import { DEFAULT_ENGINE_PARAMS, packParams, type EngineParams } from './params';
import { classifyParagraph, classifyParagraphs, draftParagraphs, resolveParagraphGapThreshold, type ManualStructure } from './structure';
import {
    DEFAULT_DIRECTION_SETTINGS,
    type BorrowedText,
    mixAssignment,
    EMPTY_LIBRARY_PREFS,
    type DirectionSettings,
    type EditOp,
    type InvalidEditOp,
    type InvalidStructureEdit,
    type StructureEdit,
    type LibraryPrefs,
    type LumiParagraph,
    type LumiProgram,
    type LumiShot,
    type LumiTransition,
    type PackId,
    type ParagraphDirection,
    type ParagraphDirectionOverride,
    type TransitionId,
    type UnifiedLine,
} from './types';

export interface CompileInput {
    lines: Line[];
    seed: string | number;
    direction?: DirectionSettings;
    paragraphDirections?: ParagraphDirectionOverride[];
    overrides?: EditOp[];
    library?: LibraryPrefs;
    params?: EngineParams;
    /** 各包的 tuning（有的包的切块受它影响，比如 tempera 的整句模式）。缺省用包的默认值。 */
    packTunings?: Record<PackId, unknown>;
    /** 用户的分段修改：强制分段、合并、段落性质。 */
    structureEdits?: StructureEdit[];
}

interface ForcedStyles {
    /** `${lineIndex}:${hash}:${slot}` → op。同一锚点以后出现的 op 为准。 */
    bySlot: Map<string, Extract<EditOp, { type: 'shot-style' }>>;
    used: Set<string>;
    mismatched: Set<string>;
}

const slotKey = (lineIndex: number, hash: string, slot: string) => `${lineIndex}:${hash}:${slot}`;

/** ④ 风格库偏好与族限制；没有任何限制时返回 null（包按原规则选，保证与 folia 一致）。 */
const buildCandidateFilter = (pack: StylePack, library: LibraryPrefs, families: string[] | null) => {
    const blocked = new Set(library.blocked);
    const favorites = new Set(library.favorites);
    const ownFamilies = families?.filter(family => pack.families.some(item => item.id === family)) ?? [];
    const familyFilter = ownFamilies.length > 0 ? new Set(ownFamilies) : null;
    const relevant = pack.styles.some(style => blocked.has(style.id) || favorites.has(style.id));
    if (!relevant && !familyFilter) return null;
    return (defaults: readonly string[]): readonly string[] => {
        const kept = defaults.filter(kind => {
            const style = getStyle(`${pack.id}/${kind}`);
            if (!style) return true;
            if (blocked.has(style.id)) return false;
            if (familyFilter && !familyFilter.has(style.family)) return false;
            return true;
        });
        // 收藏的风格在候选里出现两次，被哈希选中的概率翻倍。
        const weighted = [...kept, ...kept.filter(kind => favorites.has(`${pack.id}/${kind}`))];
        return weighted.length > 0 ? weighted : defaults;
    };
};

export const compileLumiProgram = (input: CompileInput): LumiProgram => {
    const settings = input.direction ?? DEFAULT_DIRECTION_SETTINGS;
    const library = input.library ?? EMPTY_LIBRARY_PREFS;
    const params = input.params ?? DEFAULT_ENGINE_PARAMS;
    const seed = String(input.seed);
    const { lines } = input;
    const packs = listPacks();
    const fallbackPack = defaultPackId();
    const resolvePackId = (id: PackId | undefined) => (id && findPack(id) ? id : fallbackPack);
    const tuningOf = (pack: StylePack) => pack.tuning.normalize(input.packTunings?.[pack.id]);

    // ① Structure ------------------------------------------------------------------------------
    const unified: UnifiedLine[] = lines.map((line, sourceIndex) => ({
        sourceIndex,
        line,
        // The visual tail may extend beyond authored timing, but never into the next line.
        renderEndTime: Math.max(
            line.startTime,
            Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY),
        ),
        anchor: anchorOfLine(line, sourceIndex),
        segments: Object.fromEntries(packs.map(pack => [pack.id, pack.segmentLine(line)])),
    }));
    const paragraphGapThreshold = resolveParagraphGapThreshold(lines, params.paragraph);
    // 用户的分段修改：锚点失效的、放在第一行上的分段 / 合并都列入失效。同一行以后出现的为准。
    const invalidStructureEdits: InvalidStructureEdit[] = [];
    const manual: ManualStructure = { breaks: new Set(), joins: new Set() };
    const kindEdits = new Map<number, Extract<StructureEdit, { type: 'kind' }>>();
    for (const edit of input.structureEdits ?? []) {
        const line = unified[edit.anchor.index];
        if (!line || line.anchor.hash !== edit.anchor.hash) {
            invalidStructureEdits.push({ edit, reason: 'line-missing' });
            continue;
        }
        if (edit.type === 'kind') {
            kindEdits.set(edit.anchor.index, edit);
            continue;
        }
        if (edit.anchor.index === 0) {
            invalidStructureEdits.push({ edit, reason: 'first-line' });
            continue;
        }
        manual.breaks.delete(edit.anchor.index);
        manual.joins.delete(edit.anchor.index);
        (edit.type === 'break' ? manual.breaks : manual.joins).add(edit.anchor.index);
    }
    const drafts = draftParagraphs(unified, paragraphGapThreshold, params.paragraph, manual);
    const paragraphKinds = params.paragraph.inferRepeatedLyrics === false
        ? drafts.map((draft, index) => classifyParagraph(draft.lines, index, drafts.length))
        : classifyParagraphs(drafts, new Map([...kindEdits].map(([index, edit]) => [index, edit.kind])));
    const paragraphStarts = new Set(drafts.map(draft => draft.lines[0].sourceIndex));
    kindEdits.forEach((edit, index) => {
        if (!paragraphStarts.has(index)) invalidStructureEdits.push({ edit, reason: 'not-paragraph-start' });
    });

    // ② Direction 覆盖 ---------------------------------------------------------------------------
    const directionOverrides = new Map<string, ParagraphDirectionOverride>();
    (input.paragraphDirections ?? []).forEach(item => {
        directionOverrides.set(`${item.anchor.line.index}:${item.anchor.line.hash}`, item);
    });
    const usedDirections = new Set<ParagraphDirectionOverride>();

    // ⑥ Overrides 预处理 -------------------------------------------------------------------------
    const invalidOps: InvalidEditOp[] = [];
    const forced: ForcedStyles = { bySlot: new Map(), used: new Set(), mismatched: new Set() };
    const transitionOps = new Map<string, Extract<EditOp, { type: 'transition' }>>();
    // 组件修改：按镜头锚点归组，同一槽以后出现的为准。
    const componentOps = new Map<string, Map<string, Extract<EditOp, { type: 'shot-component' }>>>();
    const usedComponentOps = new Set<string>();
    for (const op of input.overrides ?? []) {
        if (op.type === 'shot-component') {
            const key = slotKey(op.anchor.line.index, op.anchor.line.hash, op.anchor.slot);
            if (!componentOps.has(key)) componentOps.set(key, new Map());
            componentOps.get(key)!.set(op.slot, op);
            continue;
        }
        if (op.type === 'shot-style') {
            if (!getStyle(op.style)) {
                invalidOps.push({ op, reason: 'style-unknown' });
                continue;
            }
            forced.bySlot.set(slotKey(op.anchor.line.index, op.anchor.line.hash, op.anchor.slot), op);
        } else {
            if (op.transition !== 'none' && !getTransition(op.transition)) {
                invalidOps.push({ op, reason: 'transition-unknown' });
                continue;
            }
            transitionOps.set(`${op.anchor.line.index}:${op.anchor.line.hash}`, op);
        }
    }
    const usedTransitionOps = new Set<string>();
    const forcedFor = (lineIndex: number, slot: string) => {
        const line = unified[lineIndex];
        return line ? forced.bySlot.get(slotKey(lineIndex, line.anchor.hash, slot)) : undefined;
    };

    // ③④⑤ 逐段 -----------------------------------------------------------------------------------
    const chains = new Map<PackId, unknown>();
    const chainOf = (pack: StylePack) => {
        if (!chains.has(pack.id)) chains.set(pack.id, pack.createChain());
        return chains.get(pack.id);
    };
    const previousTransition = new Map<PackId, string | null>();

    const paragraphs: LumiParagraph[] = drafts.map((draft, index) => {
        const kindEdit = kindEdits.get(draft.lines[0].sourceIndex);
        const kind = kindEdit?.kind ?? paragraphKinds[index];
        const first = draft.lines[0];
        const lastLineIndex = draft.lines.at(-1)!.sourceIndex;
        const anchorKey = `${first.anchor.index}:${first.anchor.hash}`;
        const override = directionOverrides.get(anchorKey);
        const autoPack = resolvePackId(settings.mode === 'mix' ? mixAssignment(settings)[kind] : settings.pack);
        let direction: ParagraphDirection = { pack: autoPack, energy: null, families: null, source: 'auto' };
        if (override && (override.pack === undefined || findPack(override.pack))) {
            usedDirections.add(override);
            direction = {
                pack: override.pack ?? autoPack,
                energy: override.energy !== undefined ? override.energy : null,
                families: override.families !== undefined ? override.families : null,
                source: override.source,
            };
        }
        const pack = findPack(direction.pack)!;
        const next = drafts[index + 1];
        const endTime = draft.lines.at(-1)!.renderEndTime;
        const gap = next ? next.lines[0].line.startTime - endTime : 0;

        const cast: CastContext = {
            filterCandidates: buildCandidateFilter(pack, library, direction.families),
            energy: direction.energy,
            forceKind: forced.bySlot.size === 0 ? null : ({ lineIndex, slot }) => {
                const op = forcedFor(lineIndex ?? lastLineIndex, slot);
                const style = op ? getStyle(op.style) : undefined;
                if (!op || !style) return null;
                if (style.pack !== pack.id) {
                    forced.mismatched.add(op.id);
                    return null;
                }
                forced.used.add(op.id);
                return style.kind;
            },
        };
        const tuning = tuningOf(pack);
        const compileContext = {
            seed,
            paragraphIndex: index,
            kind,
            lines: draft.lines,
            songLines: unified,
            tuning,
            params: packParams(params, pack),
        };
        const compiled = pack.compileParagraph({
            ...compileContext,
            nextStartTime: next ? next.lines[0].line.startTime : null,
            endTime,
            cast,
        }, chainOf(pack));

        let shots: LumiShot[] = compiled.map(({ native, lineIndex, slot }) => {
            const { id, kind: shotKind, span, components } = pack.describeShot(native, unified);
            const op = forcedFor(lineIndex, slot);
            return {
                components: components ?? {},
                lockedComponents: [],
                id,
                anchor: { line: unified[lineIndex].anchor, slot },
                pack: pack.id,
                style: `${pack.id}/${shotKind}`,
                startTime: span.startTime,
                endTime: span.endTime,
                lyricEndTime: span.lyricEndTime,
                lineIndices: [...new Set(span.slices.map(slice => slice.lineIndex))],
                isBridge: span.isBridge,
                locked: Boolean(op && forced.used.has(op.id) && op.style === `${pack.id}/${shotKind}`),
                native: { pack: pack.id, shot: native },
            };
        });

        // ⑥ 路线 D：开启按 shot 混用时，锁定成另一个包风格的镜头由那个包来画（镜头边界不变）。
        if (settings.shotMixing && forced.bySlot.size > 0) {
            shots = shots.map((shot, shotIndex) => {
                const op = forcedFor(shot.anchor.line.index, shot.anchor.slot);
                const style = op ? getStyle(op.style) : undefined;
                if (!op || !style || style.pack === shot.pack) return shot;
                const target = findPack(style.pack);
                if (!target?.fromSpan) return shot;
                const { span } = pack.describeShot(shot.native.shot, unified);
                const converted = target.fromSpan(span, style.kind, {
                    ...compileContext,
                    tuning: tuningOf(target),
                    params: packParams(params, target),
                    shotIndex,
                }, chainOf(target));
                // 做不到（比如没有歌词的间奏换成排字包）：保持原样，这条修改留在失效列表里。
                if (!converted) return shot;
                forced.used.add(op.id);
                forced.mismatched.delete(op.id);
                const described = target.describeShot(converted.shot, unified);
                return {
                    ...shot,
                    components: described.components ?? {},
                    pack: target.id,
                    style: style.id,
                    startTime: described.span.startTime,
                    endTime: described.span.endTime,
                    lyricEndTime: described.span.lyricEndTime,
                    locked: true,
                    native: { pack: target.id, shot: converted.shot, extra: converted.extra },
                };
            });
        }

        // ⑥ 路线 E：逐镜头的组件（排版、点缀……）。只接受镜头所属包声明过的槽与选项；
        // 排版槽另外接受 `<别的包>/<排版>`：字由那个包排，排进本镜头构图的文字区域。
        if (componentOps.size > 0) {
            shots = shots.map((shot, shotIndex) => {
                const ops = componentOps.get(slotKey(shot.anchor.line.index, shot.anchor.line.hash, shot.anchor.slot));
                if (!ops) return shot;
                const owner = findPack(shot.pack);
                const accepted: Record<string, string> = {};
                let borrowOp: EditOp | null = null;
                for (const [slotId, op] of ops) {
                    usedComponentOps.add(op.id);
                    if (op.type !== 'shot-component') continue;
                    if (slotId === 'typography' && op.value.includes('/')) {
                        borrowOp = op;
                        continue;
                    }
                    const slotDef = owner?.componentSlots?.find(item => item.id === slotId);
                    if (!slotDef || !slotDef.options.some(option => option.id === op.value) || !owner?.applyComponents) {
                        invalidOps.push({ op, reason: 'component-unknown' });
                        continue;
                    }
                    accepted[slotId] = op.value;
                }
                if (!owner || (Object.keys(accepted).length === 0 && !borrowOp)) return shot;
                let nativeShot = Object.keys(accepted).length > 0 && owner.applyComponents
                    ? owner.applyComponents(shot.native.shot, accepted)
                    : shot.native.shot;
                let borrowedText: BorrowedText | undefined;
                if (borrowOp && borrowOp.type === 'shot-component') {
                    const borrowed = borrowTypography(owner, shot, nativeShot, borrowOp.value, (guest, kind) => guest.fromSpan!(
                        owner.describeShot(nativeShot, unified).span,
                        kind,
                        { ...compileContext, tuning: tuningOf(guest), params: packParams(params, guest), shotIndex },
                        // 客镜头用独立的 chain：不能影响宿主包后面镜头的 flow。
                        guest.createChain(),
                    ));
                    if (borrowed) {
                        nativeShot = borrowed.host;
                        borrowedText = borrowed.text;
                    } else {
                        invalidOps.push({ op: borrowOp, reason: 'component-unknown' });
                    }
                }
                const described = owner.describeShot(nativeShot, unified);
                const components = { ...(described.components ?? { ...shot.components, ...accepted }) };
                const locked = Object.keys(accepted);
                if (borrowedText && borrowOp?.type === 'shot-component') {
                    components.typography = borrowOp.value;
                    if (!locked.includes('typography')) locked.push('typography');
                }
                return {
                    ...shot,
                    components,
                    lockedComponents: locked,
                    native: { ...shot.native, shot: nativeShot },
                    ...(borrowedText ? { borrowedText } : {}),
                };
            });
        }

        // ⑤ 段落转场
        let transitionOut: LumiTransition | null = null;
        if (next) {
            const transitionOp = transitionOps.get(anchorKey);
            if (transitionOp) usedTransitionOps.add(transitionOp.id);
            let chosen: TransitionId | null;
            if (transitionOp) {
                chosen = transitionOp.transition === 'none' ? null : transitionOp.transition;
            } else {
                const transitionKind = pack.chooseTransition(seed, index, previousTransition.get(pack.id) ?? null);
                previousTransition.set(pack.id, transitionKind);
                chosen = `${pack.id}/${transitionKind}`;
            }
            const def = chosen ? getTransition(chosen) : undefined;
            if (chosen && def) {
                const transitionEnd = next.lines[0].line.startTime;
                transitionOut = {
                    id: chosen,
                    startTime: Math.max(first.line.startTime, transitionEnd - def.duration(gap)),
                    endTime: transitionEnd,
                    source: transitionOp ? 'user' : 'auto',
                };
            }
        }

        return {
            id: `p${index}`,
            index,
            kind,
            kindManual: Boolean(kindEdit),
            boundary: draft.boundary,
            merged: Boolean(draft.merged),
            startTime: first.line.startTime,
            endTime,
            lineIndices: draft.lines.map(line => line.sourceIndex),
            anchor: { line: first.anchor },
            direction,
            shots,
            transitionOut,
        };
    });

    // ⑤ 接缝：包的 tuning 要求时（比如绘光的「轨迹过渡」），交界两侧的镜头都是这个包的自动转场换成它的接缝转场，
    // 内核据此把两段并成一个场景单元（kernel/units.ts）。用户指定的转场不动。
    paragraphs.forEach((paragraph, index) => {
        const next = paragraphs[index + 1];
        const out = paragraph.transitionOut;
        if (!next || !out || out.source !== 'auto') return;
        const packId = paragraph.shots.at(-1)?.pack ?? paragraph.direction.pack;
        if ((next.shots[0]?.pack ?? next.direction.pack) !== packId) return;
        const pack = findPack(packId);
        const id = pack?.seamlessTransition?.(tuningOf(pack));
        const def = id ? getTransition(id) : undefined;
        if (!id || !def) return;
        paragraph.transitionOut = {
            id,
            startTime: Math.max(paragraph.startTime, out.endTime - def.duration(next.startTime - paragraph.endTime)),
            endTime: out.endTime,
            source: 'auto',
        };
    });

    // 平移类转场预卷：下一段首个镜头的起点提前到转场起点（不越过上一段的结束），
    // 让新构图在间隙里就开始搭建；逐字时序不受影响。由镜头所属的包决定是否支持。
    paragraphs.forEach((paragraph, index) => {
        const incoming = paragraph.shots[0];
        const transition = paragraphs[index - 1]?.transitionOut;
        if (!incoming || !transition || !getTransition(transition.id)?.preRoll) return;
        const pack = findPack(incoming.pack);
        if (!pack?.applyPreRoll) return;
        const startTime = Math.min(incoming.startTime, Math.max(transition.startTime, paragraphs[index - 1].endTime));
        incoming.startTime = startTime;
        incoming.native = { ...incoming.native, shot: pack.applyPreRoll(incoming.native.shot, startTime) };
    });

    // ⑥ 失效的修改
    for (const op of forced.bySlot.values()) {
        if (forced.used.has(op.id)) continue;
        invalidOps.push({ op, reason: forced.mismatched.has(op.id) ? 'pack-mismatch' : 'anchor-missing' });
    }
    for (const op of transitionOps.values()) {
        if (!usedTransitionOps.has(op.id)) invalidOps.push({ op, reason: 'anchor-missing' });
    }
    for (const ops of componentOps.values()) {
        for (const op of ops.values()) {
            if (!usedComponentOps.has(op.id)) invalidOps.push({ op, reason: 'anchor-missing' });
        }
    }
    const invalidDirections = (input.paragraphDirections ?? []).filter(item => !usedDirections.has(item));

    return { version: 1, seed, paragraphGapThreshold, lines: unified, paragraphs, invalidOps, invalidDirections, invalidStructureEdits };
};

/**
 * 跨包借排版：`value` = `<客包>/<排版>`。宿主要能隐藏自己的字、给出本风格的文字区域；
 * 客包要导出这个排版并能按 span 造镜头。任何一环不满足都返回 null（这条修改列入失效）。
 */
function borrowTypography(
    owner: StylePack,
    shot: LumiShot,
    hostNative: unknown,
    value: string,
    convert: (guest: StylePack, kind: string) => { shot: unknown; extra?: unknown } | null,
): { host: unknown; text: BorrowedText } | null {
    const slash = value.indexOf('/');
    const guest = findPack(value.slice(0, slash));
    const typography = value.slice(slash + 1);
    const exported = guest?.typographyExports?.find(item => item.id === typography);
    const hostKind = getStyle(shot.style)?.kind;
    const hostRegion = hostKind ? owner.textRegion?.(hostKind) : null;
    const guestRegion = exported ? guest?.textRegion?.(exported.kind) : null;
    if (!guest || !exported || guest.id === owner.id || shot.isBridge) return null;
    if (!owner.hideText || !hostRegion || !guestRegion || !guest.fromSpan || !guest.textOnlyTuning) return null;
    const converted = convert(guest, exported.kind);
    if (!converted) return null;
    let guestShot = converted.shot;
    const slot = guest.componentSlots?.find(item => item.id === 'typography');
    if (guest.applyComponents && slot?.options.some(option => option.id === typography)) {
        guestShot = guest.applyComponents(guestShot, { typography });
    }
    return {
        host: owner.hideText(hostNative),
        text: {
            pack: guest.id,
            typography,
            native: { pack: guest.id, shot: guestShot, extra: converted.extra },
            hostRegion,
            guestRegion,
        },
    };
}
