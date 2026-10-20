// src/kernel/units.ts
// 场景单元：内核调度与转场的单位 = 段内同一个包的一串连续镜头（路线 D）。
// 没有跨包镜头的段落就是一个单元（与路线 C 相同）。跨包的镜头边界变成单元边界，两侧不可能
// 是同一个包（那样就在同一个单元里、由包自己处理镜头交接），所以用进入方的包指定的短转场
// （StylePack.shotBoundaryTransition）。
// 接缝转场（TransitionDef.joins，比如绘光的「轨迹」）两侧是同一个包时，两个段落的单元并成一个：
// 段落之间也由包自己像换镜头一样交接，没有转场帧。
import { hashText } from '@/core/lyrics/edits';
import { getPack, getTransition } from '@/packs/registry';
import type { TextRegion } from '@/packs/contract';
import type {
    LumiParagraph,
    LumiProgram,
    LumiShot,
    LumiTransition,
    NativeParagraph,
    PackId,
} from '@/compiler/types';

export interface SceneUnit {
    /** 缓存键：内容的哈希，内容不变就复用已构建的场景。 */
    key: string;
    index: number;
    pack: PackId;
    /** 单元所在的段落；接缝转场并起来的单元是第一段。 */
    paragraph: LumiParagraph;
    shots: LumiShot[];
    startTime: number;
    endTime: number;
    transitionOut: LumiTransition | null;
    /** 包自己的段落结构，交给包的场景构建器。 */
    native: NativeParagraph;
    /** 跨包借排版：单元里借了别的包排字的镜头，每个是一个只画字的客单元。 */
    guests: GuestUnit[];
}

/**
 * 客单元：客包按同一段歌词造的单镜头场景，只画字，在宿主镜头的时间里叠在宿主单元里。
 * 客包的文字区域（guestRegion，相对客画幅）对齐到宿主的文字区域（hostRegion，相对画面）。
 */
export interface GuestUnit {
    unit: SceneUnit;
    shotId: string;
    hostRegion: TextRegion;
    guestRegion: TextRegion;
}

const buildGuests = (program: LumiProgram, paragraph: LumiParagraph, shots: LumiShot[]): GuestUnit[] => shots.flatMap(shot => {
    const borrowed = shot.borrowedText;
    if (!borrowed) return [];
    const guestPack = getPack(borrowed.pack);
    const guestShot: LumiShot = { ...shot, pack: borrowed.pack, native: borrowed.native, borrowedText: undefined };
    const built = guestPack.toNativeParagraph(program, paragraph, {
        shots: [guestShot],
        startTime: shot.startTime,
        endTime: shot.endTime,
        transitionOut: null,
        idSuffix: `-t${shot.id}`,
    });
    const native: NativeParagraph = { pack: borrowed.pack, id: built.id, paragraph: built.data };
    const unit: SceneUnit = {
        key: `${unitKey(paragraph, native)}:${JSON.stringify([borrowed.hostRegion, borrowed.guestRegion])}`,
        index: -1,
        pack: borrowed.pack,
        paragraph,
        shots: [guestShot],
        startTime: shot.startTime,
        endTime: shot.endTime,
        transitionOut: null,
        native,
        guests: [],
    };
    return [{ unit, shotId: shot.id, hostRegion: borrowed.hostRegion, guestRegion: borrowed.guestRegion }];
});

const groupRuns = (shots: LumiShot[]) => {
    const runs: LumiShot[][] = [];
    shots.forEach(shot => {
        const last = runs.at(-1);
        if (last && last[0].native.pack === shot.native.pack) last.push(shot);
        else runs.push([shot]);
    });
    return runs;
};

/**
 * 缓存键 = 单元内容的哈希。原生段落结构里有分词、逐字时间、镜头参数与转场，任何会改变画面的
 * 编译结果都会改变它；只改了别处的单元保持同一个键，已构建的场景得以复用。
 */
const unitKey = (paragraph: LumiParagraph, native: NativeParagraph) => (
    `${paragraph.id}:${native.pack}:${hashText(JSON.stringify(native.paragraph))}`
);

/** 前一个单元以接缝转场出场、两侧是同一个包且包能并单元时，两个单元并成一个。 */
const joinsInto = (previous: SceneUnit, unit: SceneUnit) => (
    previous.pack === unit.pack
    && Boolean(previous.transitionOut && getTransition(previous.transitionOut.id)?.joins)
    && Boolean(getPack(unit.pack).joinParagraphs)
);

const joinUnits = (group: SceneUnit[]): SceneUnit => {
    const first = group[0];
    const last = group[group.length - 1];
    const built = getPack(first.pack).joinParagraphs!(group.map(unit => ({ id: unit.native.id, data: unit.native.paragraph })));
    return {
        // 并起来的内容完全由各部分决定：各部分的键连起来就是内容的键。
        key: group.map(unit => unit.key).join('+'),
        index: first.index,
        pack: first.pack,
        paragraph: first.paragraph,
        shots: group.flatMap(unit => unit.shots),
        startTime: first.startTime,
        endTime: last.endTime,
        transitionOut: last.transitionOut,
        native: { pack: first.pack, id: built.id, paragraph: built.data },
        guests: group.flatMap(unit => unit.guests),
    };
};

const joinSeams = (units: SceneUnit[]): SceneUnit[] => {
    const groups: SceneUnit[][] = [];
    units.forEach(unit => {
        const group = groups.at(-1);
        if (group && joinsInto(group[group.length - 1], unit)) group.push(unit);
        else groups.push([unit]);
    });
    if (groups.length === units.length) return units;
    return groups.map((group, index) => ({ ...(group.length === 1 ? group[0] : joinUnits(group)), index }));
};

export const buildUnits = (program: LumiProgram): SceneUnit[] => {
    const units: SceneUnit[] = [];
    program.paragraphs.forEach(paragraph => {
        const runs = paragraph.shots.length > 0 ? groupRuns(paragraph.shots) : [[]];
        runs.forEach((shots, runIndex) => {
            const packId: PackId = shots[0]?.native.pack ?? paragraph.direction.pack;
            const pack = getPack(packId);
            const next = runs[runIndex + 1];
            const startTime = runIndex === 0 ? paragraph.startTime : shots[0].startTime;
            const endTime = next ? next[0].startTime : paragraph.endTime;
            let transitionOut: LumiTransition | null = paragraph.transitionOut;
            if (next) {
                const id = getPack(next[0].native.pack).shotBoundaryTransition;
                const duration = getTransition(id)?.duration(0) ?? 0.25;
                transitionOut = { id, startTime: Math.max(startTime, endTime - duration), endTime, source: 'auto' };
            }
            const built = pack.toNativeParagraph(program, paragraph, runs.length === 1
                ? {}
                // 同一段落的多个单元用不同的 id，场景里按 id 播种的装饰才不会重复。
                : { shots, startTime, endTime, transitionOut, idSuffix: runIndex > 0 ? `-u${runIndex}` : undefined });
            const native: NativeParagraph = { pack: packId, id: built.id, paragraph: built.data };
            const guests = buildGuests(program, paragraph, shots);
            units.push({
                key: [unitKey(paragraph, native), ...guests.map(guest => guest.unit.key)].join('|'),
                index: units.length,
                pack: packId,
                paragraph,
                shots,
                startTime,
                endTime,
                transitionOut,
                native,
                guests,
            });
        });
    });
    return joinSeams(units);
};

/** 与两包 runtime 相同：最后一个 startTime 已经过去的单元。 */
export const findUnitIndexAtTime = (units: SceneUnit[], time: number) => {
    for (let index = units.length - 1; index >= 0; index -= 1) {
        if (time >= units[index].startTime) return index;
    }
    return 0;
};
