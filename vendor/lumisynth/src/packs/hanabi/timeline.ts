// src/packs/hanabi/timeline.ts
// 一个场景单元的时间安排（纯数据）：每个镜头的文字入场 / 退场、升空尾迹、世界上升 rise(t) 与镜头内运镜。
// 全部只由 t 决定（docs/HANABI.md「上升」）。

export interface TimelineShot {
    startTime: number;
    endTime: number;
    /** 第一个字被唱到 / 最后一个字唱完的时刻；间奏为 null。 */
    firstSung: number | null;
    lastSungEnd: number | null;
    isBridge: boolean;
    camera: { rise: number; push: number; roll: number; punch: number };
}

export interface ShotTiming {
    start: number;
    end: number;
    /** 镜头容器在世界里的高度偏移（像素，向上为负）。 */
    worldY: number;
    /** 升空尾迹出发、文字入场（= 尾迹到达、主烟花开花）、文字退场。 */
    launchAt: number;
    enterAt: number;
    exitAt: number;
    exitDuration: number;
    /** 入场震动的时刻。 */
    punchAt: number;
    /** 进入这个镜头的上升窗口（第一个镜头为 null）。 */
    riseIn: { from: number; to: number } | null;
    /** 镜头内匀速上漂的速度（像素 / 秒）。 */
    drift: number;
}

export interface CameraOffset {
    scale: number;
    rotation: number;
    dx: number;
    dy: number;
}

export interface Timeline {
    shots: ShotTiming[];
    /** 世界容器的 y（像素）：镜头 i 定格时约等于 -worldY_i，镜头内缓慢变大（摄影机上漂）。 */
    rise: (time: number) => number;
    /** time 时刻所在的镜头（最后一个已经开始的；开始之前为 0）。 */
    shotAt: (time: number) => number;
    /** 镜头内的推近、摆动与入场震动（绕画面中心）。 */
    camera: (time: number) => CameraOffset;
}

/** 边界前后上升的时长上限（秒）。 */
export const RISE_BEFORE = 0.6;
export const RISE_AFTER = 0.6;
/** 升空尾迹飞行时长。 */
export const LAUNCH_DURATION = 0.45;
/** 文字入场比第一个字被唱到提前多少秒。 */
export const ENTER_LEAD = 0.4;
/** 镜头内上漂：每秒约 2% 画面高度，整个镜头最多 10%。 */
const DRIFT_PER_SECOND = 0.02;
const DRIFT_MAX = 0.1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (value: number) => {
    const t = clamp(value, 0, 1);
    return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
};

export const buildTimeline = (shots: readonly TimelineShot[], options: {
    unitStart: number;
    unitEnd: number;
    height: number;
    /** tuning.riseSpeed。 */
    riseSpeed: number;
    /** 震动 / 摆动幅度倍率（主题的动画强度）。 */
    motion: number;
    /** 段落出场转场开始的时刻（最后一个镜头的字在这之后退场）；没有转场时字留到单元结束。 */
    exitStart?: number | null;
}): Timeline => {
    const { height, riseSpeed, motion } = options;
    const count = shots.length;
    const durationOf = (index: number) => Math.max(shots[index]!.endTime - shots[index]!.startTime, 0.05);
    // 边界 i（镜头 i-1 → i）的上升窗口：前后各不超过 0.6 秒，也不吃掉两边镜头太多。
    const before = shots.map((_, index) => (index === 0 ? 0 : Math.min(RISE_BEFORE, 0.45 * durationOf(index - 1))));
    const after = shots.map((_, index) => (index === 0 ? 0 : Math.min(RISE_AFTER, 0.35 * durationOf(index))));

    const timings: ShotTiming[] = [];
    let worldY = 0;
    shots.forEach((shot, index) => {
        if (index > 0) worldY -= clamp(shot.camera.rise, 0, 1.2) * riseSpeed * height;
        const boundary = shot.startTime;
        const sung = shot.firstSung ?? boundary;
        let enterAt = shot.isBridge ? boundary : Math.min(boundary, sung) - ENTER_LEAD;
        if (index > 0) enterAt = Math.max(enterAt, boundary - before[index]!, timings[index - 1]!.enterAt + 0.1);
        const duration = durationOf(index);
        timings.push({
            start: shot.startTime,
            end: shot.endTime,
            worldY,
            launchAt: enterAt - LAUNCH_DURATION,
            enterAt,
            exitAt: 0,
            exitDuration: 0,
            punchAt: enterAt + 0.08,
            riseIn: index === 0 ? null : { from: boundary - before[index]!, to: boundary + after[index]! },
            drift: riseSpeed * height * Math.min(DRIFT_PER_SECOND, DRIFT_MAX / duration),
        });
    });

    // 退场：在下一个边界的上升里（最后一个唱完之后、边界前 0.15 秒之前开始），最后一个镜头在单元末尾。
    timings.forEach((timing, index) => {
        const shot = shots[index]!;
        const sungEnd = shot.lastSungEnd ?? timing.end;
        let exitAt: number;
        let exitDuration: number;
        if (index < count - 1) {
            const boundary = timing.end;
            exitAt = clamp(sungEnd, boundary - before[index + 1]!, boundary - 0.15);
            exitDuration = clamp(boundary + after[index + 1]! - exitAt, 0.35, 0.9);
        } else if (options.exitStart != null) {
            exitAt = Math.min(Math.max(sungEnd, options.exitStart), options.unitEnd - 0.2);
            exitDuration = clamp(options.unitEnd - exitAt, 0.25, 0.7);
        } else {
            // 没有出场转场（全曲最后一段、段内接别的包的镜头、缩略图）：字留到单元结束，交给内核或片尾卡收。
            exitAt = options.unitEnd;
            exitDuration = 0.5;
        }
        timing.exitAt = Math.max(exitAt, timing.enterAt + 0.3);
        timing.exitDuration = exitDuration;
    });

    const shotAt = (time: number) => {
        let found = 0;
        for (let index = 0; index < count; index += 1) if (timings[index]!.start <= time) found = index;
        return found;
    };

    /** 按镜头取值：上升窗口里在两个镜头之间缓动过渡，其余时间取所在镜头的值。 */
    const blended = (time: number, value: (index: number, time: number) => number) => {
        for (let index = 1; index < count; index += 1) {
            const window = timings[index]!.riseIn!;
            if (time >= window.from && time <= window.to) {
                const k = easeInOutCubic((time - window.from) / Math.max(window.to - window.from, 1e-3));
                return value(index - 1, time) + (value(index, time) - value(index - 1, time)) * k;
            }
        }
        return value(shotAt(time), time);
    };

    const target = (index: number, time: number) => {
        const timing = timings[index]!;
        const mid = (timing.start + timing.end) / 2;
        return -timing.worldY + timing.drift * (clamp(time, timing.start, timing.end) - mid);
    };

    const rise = (time: number) => (count === 0 ? 0 : blended(time, target));

    const pushOf = (index: number, time: number) => {
        const timing = timings[index]!;
        return 1 + shots[index]!.camera.push * smooth((time - timing.start) / Math.max(timing.end - timing.start, 0.05));
    };
    const rollOf = (index: number, time: number) => {
        const timing = timings[index]!;
        return shots[index]!.camera.roll * motion * Math.sin((time - timing.start) * 0.9 + index * 1.3);
    };

    const camera = (time: number): CameraOffset => {
        if (count === 0) return { scale: 1, rotation: 0, dx: 0, dy: 0 };
        let scale = blended(time, pushOf);
        const rotation = blended(time, rollOf);
        let dx = 0;
        let dy = 0;
        for (let index = 0; index < count; index += 1) {
            const age = time - timings[index]!.punchAt;
            const punch = shots[index]!.camera.punch;
            if (age < 0 || age > 0.9 || punch <= 0 || shots[index]!.isBridge) continue;
            const amp = punch * motion * Math.exp(-age / 0.16);
            dx += amp * 0.012 * height * Math.sin(age * 70 + index);
            dy += amp * 0.016 * height * Math.cos(age * 55 + index * 2);
            scale *= 1 + amp * 0.03;
        }
        return { scale, rotation, dx, dy };
    };

    return { shots: timings, rise, shotAt, camera };
};
