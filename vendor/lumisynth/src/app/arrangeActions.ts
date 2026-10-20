// src/app/arrangeActions.ts
// 镜头与段落上的常用操作：右键菜单、快速选择、命令面板、面包屑共用。选择风格 / 排版时高亮项在预览里试看。
import { PARAGRAPH_KINDS, type LumiParagraph, type LumiProgram, type LumiShot } from '@/compiler/types';
import { getAgentState } from '@/agent/host';
import { borrowableTypographies, familyLabel, findPack, getStyle, listPacks } from '@/packs/registry';
import {
    lockCurrentStyle,
    lockShotStyle,
    patchParagraphDirection,
    setParagraphDirection,
    setParagraphTransition,
    setShotComponent,
    unlockShotStyle,
} from '@/project/edits';
import { setPeek, setSession, useSession } from '@/project/session';
import { mergeWithPrevious, resetParagraphStructure, setParagraphKind, splitParagraphAt } from '@/project/structure';
import { updateProject, useProjectStore } from '@/project/store';
import { bringShotIntoView } from './inspector/StylePickerGrid';
import { log } from './output';
import { seek, usePlayback } from './playback';
import { revealInTimeline } from './timeline/reveal';
import type { ContextMenuItem } from './workbench/ContextMenu';
import { showQuickPick, type QuickPickItem } from './workbench/QuickPick';
import { t } from '@/i18n';
import { packDescription, packLabel, packShortLabel, paragraphKindLabel } from '@/i18n/catalog';

// ---------------------------------------------------------------------------------------------
// 选择

export const selectShot = (paragraph: LumiParagraph, shot: LumiShot, jump = true) => {
    setSession({ selection: { type: 'shot', paragraphId: paragraph.id, shotId: shot.id } });
    if (jump) {
        seek(shot.startTime + 0.01);
        revealInTimeline(shot.startTime, shot.endTime);
    }
};

export const selectParagraph = (paragraph: LumiParagraph, jump = true) => {
    setSession({ selection: { type: 'paragraph', paragraphId: paragraph.id } });
    if (jump) {
        seek(paragraph.startTime + 0.01);
        revealInTimeline(paragraph.startTime, paragraph.endTime);
    }
};

/** 当前选中的镜头 / 段落（按最新的编排解析）。 */
export const currentSelection = (program: LumiProgram = getAgentState().program) => {
    const selection = useSession.getState().selection;
    if (selection.type !== 'shot' && selection.type !== 'paragraph') return { paragraph: null, shot: null };
    const paragraph = program.paragraphs.find(item => item.id === selection.paragraphId) ?? null;
    const shot = selection.type === 'shot' ? paragraph?.shots.find(item => item.id === selection.shotId) ?? null : null;
    return { paragraph, shot };
};

/** 时刻 time 所在的段落与镜头。 */
export const locateAt = (program: LumiProgram, time: number) => {
    const paragraph = [...program.paragraphs].reverse().find(item => time >= item.startTime) ?? program.paragraphs[0] ?? null;
    const shot = paragraph ? [...paragraph.shots].reverse().find(item => time >= item.startTime) ?? null : null;
    return { paragraph, shot };
};

/** 播放头所在的段落 / 镜头 id。只在跨过镜头边界时变化（播放时不逐帧重渲染）。 */
export const usePlayheadLocation = (program: LumiProgram) => {
    const key = usePlayback(state => {
        const { paragraph, shot } = locateAt(program, state.time);
        return `${paragraph?.id ?? ''}|${shot?.id ?? ''}`;
    });
    const [paragraphId, shotId] = key.split('|');
    return { paragraphId: paragraphId || null, shotId: shotId || null };
};

export const shotText = (program: LumiProgram, shot: LumiShot) => (
    shot.isBridge ? t('arrange:bridge') : shot.lineIndices.map(index => program.lines[index]?.line.fullText).filter(Boolean).join(' / ')
);

// ---------------------------------------------------------------------------------------------
// 快速选择

export const pickShotStyle = async (shot: LumiShot) => {
    const project = useProjectStore.getState().project;
    const packs = project.direction.shotMixing ? listPacks() : listPacks().filter(pack => pack.id === shot.pack);
    const items: QuickPickItem<string>[] = packs.flatMap(pack => pack.styles.map(style => ({
        label: style.kind,
        description: `${packs.length > 1 ? `${packShortLabel(pack.id)} · ` : ''}${familyLabel(pack.id, style.family)} · ${style.mood}`,
        value: style.id,
        thumbnail: style.id,
        picked: style.id === shot.style,
    })));
    bringShotIntoView(shot);
    const chosen = await showQuickPick(items, {
        title: t('arrange:pick.shotStyle', { current: shot.style }),
        placeholder: t('arrange:pick.shotStylePlaceholder'),
        onActive: style => setPeek([{ id: 'peek-style', type: 'shot-style', anchor: shot.anchor, style }]),
    });
    setPeek(null, 0);
    if (chosen && (chosen !== shot.style || !shot.locked)) lockShotStyle(shot, chosen);
};

export const pickShotComponent = async (shot: LumiShot, slotId: string) => {
    const pack = findPack(shot.pack);
    const slot = pack?.componentSlots?.find(item => item.id === slotId);
    if (!slot) return;
    const kind = getStyle(shot.style)?.kind ?? '';
    const current = shot.components[slotId];
    const items: QuickPickItem<string>[] = [
        { label: t('arrange:pick.auto'), description: t('arrange:pick.autoRules'), value: 'auto', picked: !shot.lockedComponents.includes(slotId) },
        ...slot.options.map(option => ({ label: option.label, description: packShortLabel(pack!.id), value: option.id, picked: shot.lockedComponents.includes(slotId) && option.id === current })),
        ...(slotId === 'typography' && !shot.isBridge
            ? borrowableTypographies(shot.pack, kind).map(option => ({ label: option.label, description: t('arrange:pick.borrowed'), value: option.value, picked: option.value === current }))
            : []),
    ];
    bringShotIntoView(shot);
    const chosen = await showQuickPick(items, {
        title: t('arrange:pick.shotComponent', { slot: slot.label }),
        onActive: value => setPeek(value === 'auto' ? [] : [{ id: 'peek-component', type: 'shot-component', anchor: shot.anchor, slot: slotId, value }]),
    });
    setPeek(null, 0);
    if (chosen) setShotComponent(shot, slotId, chosen);
};

export const pickParagraphPack = async (paragraph: LumiParagraph) => {
    const items: QuickPickItem<string>[] = [
        { label: t('arrange:pick.auto'), description: t('arrange:pick.autoDirection'), value: 'auto', picked: paragraph.direction.source === 'auto' },
        ...listPacks().map(pack => ({ label: packLabel(pack.id), description: packDescription(pack.id).slice(0, 40), value: pack.id, picked: paragraph.direction.source !== 'auto' && paragraph.direction.pack === pack.id })),
    ];
    const chosen = await showQuickPick(items, { title: t('arrange:pick.paragraphPack', { n: paragraph.index + 1, kind: paragraphKindLabel(paragraph.kind) }) });
    if (chosen) setParagraphDirection(paragraph, { pack: chosen });
};

export const pickParagraphTransition = async (paragraph: LumiParagraph) => {
    const currentId = paragraph.transitionOut?.id ?? 'none';
    const items: QuickPickItem<string>[] = [
        { label: t('arrange:pick.auto'), value: 'auto' },
        { label: t('arrange:pick.noTransition'), value: 'none', picked: currentId === 'none' },
        ...listPacks().flatMap(pack => pack.transitions.map(transition => ({
            label: transition.label,
            description: packShortLabel(pack.id),
            value: transition.id,
            picked: transition.id === currentId,
        }))),
    ];
    const chosen = await showQuickPick(items, { title: t('arrange:pick.paragraphTransition', { n: paragraph.index + 1 }) });
    if (chosen) setParagraphTransition(paragraph, chosen);
};

export const pickParagraphKind = async (paragraph: LumiParagraph) => {
    const chosen = await showQuickPick<string>([
        { label: t('arrange:pick.autoKind'), description: t('arrange:pick.autoKindHint'), value: 'auto', picked: !paragraph.kindManual },
        ...PARAGRAPH_KINDS.map(kind => ({ label: paragraphKindLabel(kind), description: kind, value: kind, picked: paragraph.kindManual && paragraph.kind === kind })),
    ], { title: t('arrange:pick.paragraphKind', { n: paragraph.index + 1 }) });
    if (chosen) setParagraphKind(paragraph, chosen as never, message => log(message));
};

/** 这一段范围内有没有手动分段 / 合并记录。 */
const hasManualStructure = (paragraph: LumiParagraph) => {
    const lines = new Set(paragraph.lineIndices);
    return useProjectStore.getState().project.structureEdits.some(edit => edit.type !== 'kind' && lines.has(edit.anchor.index));
};

/** 分段相关的菜单项：在某一行开新段（lineIndex 给出时）、与上一段合并、性质、交回自动分段。 */
export const structureMenuItems = (program: LumiProgram, paragraph: LumiParagraph, lineIndex?: number): ContextMenuItem[] => [
    ...(lineIndex !== undefined ? [{
        label: t('arrange:menu.splitAtLine', { n: lineIndex + 1 }),
        run: () => splitParagraphAt(program, lineIndex, message => log(message)),
        disabled: paragraph.lineIndices[0] === lineIndex,
    }] : []),
    { label: t('arrange:menu.mergePrevious'), run: () => mergeWithPrevious(program, paragraph, message => log(message)), disabled: paragraph.index === 0 },
    { label: paragraph.kindManual ? t('arrange:menu.kindManual', { kind: paragraphKindLabel(paragraph.kind) }) : t('arrange:menu.kind', { kind: paragraphKindLabel(paragraph.kind) }), run: () => pickParagraphKind(paragraph) },
    { label: t('arrange:menu.resetStructure'), run: () => resetParagraphStructure(program, paragraph, message => log(message)), disabled: !hasManualStructure(paragraph) },
];

/** 把这一段的编排覆盖（包、energy、族）复制到同一性质的所有段落。 */
export const copyDirectionToSameKind = (program: LumiProgram, paragraph: LumiParagraph) => {
    const targets = program.paragraphs.filter(item => item.kind === paragraph.kind && item.id !== paragraph.id);
    if (targets.length === 0) return;
    const { pack, energy, families, source } = paragraph.direction;
    const patch = source === 'auto'
        ? { pack: 'auto' as const, energy: 'auto' as const, families: 'auto' as const }
        : { pack, energy, families };
    updateProject(project => targets.reduce((next, target) => patchParagraphDirection(next, target.anchor, patch), project));
    log(t('arrange:copiedDirection', { n: paragraph.index + 1, count: targets.length, kind: paragraphKindLabel(paragraph.kind) }));
};

// ---------------------------------------------------------------------------------------------
// 右键菜单

export const shotMenu = (program: LumiProgram, paragraph: LumiParagraph, shot: LumiShot): ContextMenuItem[] => {
    const slots = findPack(shot.pack)?.componentSlots ?? [];
    return [
        { label: t('arrange:menu.changeStyle'), run: () => pickShotStyle(shot) },
        ...slots.map(slot => ({ label: `${slot.label}…`, run: () => pickShotComponent(shot, slot.id), disabled: shot.isBridge && slot.id === 'typography' })),
        'separator',
        shot.locked
            ? { label: t('arrange:menu.unlockStyle'), run: () => unlockShotStyle(shot) }
            : { label: t('arrange:menu.lockStyle'), run: () => lockCurrentStyle(shot) },
        { label: t('arrange:menu.clearComponents'), run: () => slots.forEach(slot => setShotComponent(shot, slot.id, 'auto')), disabled: shot.lockedComponents.length === 0 },
        'separator',
        ...(shot.lineIndices.length > 0 && shot.lineIndices[0] >= 0 && paragraph.lineIndices.includes(shot.lineIndices[0]) && paragraph.lineIndices[0] !== shot.lineIndices[0]
            ? [{ label: t('arrange:menu.splitAtShot', { n: shot.lineIndices[0] + 1 }), run: () => splitParagraphAt(program, shot.lineIndices[0], message => log(message)) }]
            : []),
        { label: t('arrange:menu.jumpHere'), run: () => selectShot(paragraph, shot) },
        { label: t('arrange:menu.paragraph'), run: () => selectParagraph(paragraph) },
        ...paragraphMenu(program, paragraph).filter(item => item !== 'separator' && item.label !== t('arrange:menu.jumpHere')).slice(0, 2),
    ];
};

export const paragraphMenu = (program: LumiProgram, paragraph: LumiParagraph): ContextMenuItem[] => [
    { label: t('arrange:menu.pack', { pack: packShortLabel(paragraph.direction.pack) }), run: () => pickParagraphPack(paragraph) },
    { label: t('arrange:menu.transition'), run: () => pickParagraphTransition(paragraph), disabled: paragraph.index === program.paragraphs.length - 1 },
    'separator',
    ...structureMenuItems(program, paragraph),
    'separator',
    { label: t('arrange:menu.copyToKind', { kind: paragraphKindLabel(paragraph.kind) }), run: () => copyDirectionToSameKind(program, paragraph) },
    { label: t('arrange:menu.resetDirection'), run: () => setParagraphDirection(paragraph, { pack: 'auto', energy: 'auto', families: 'auto' }), disabled: paragraph.direction.source === 'auto' },
    'separator',
    { label: t('arrange:menu.jumpHere'), run: () => selectParagraph(paragraph) },
];
