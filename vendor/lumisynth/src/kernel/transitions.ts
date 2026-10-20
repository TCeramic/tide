// src/kernel/transitions.ts
// 段落转场的统一帧。每种转场的帧由它所属的风格包给出（TransitionDef.resolveFrame），
// 这里只定义帧的超集与内核的调度规则。
import { getTransition } from '@/packs/registry';
import type { TransitionDef, TransitionFrameContext } from '@/packs/contract';

export interface KernelTransitionFrame {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    blur: number;
    /** 单色故障强度与种子。 */
    glitch: number;
    glitchSeed: number;
    /** 擦除色块行程 0..2（1 为满覆盖）与方向。 */
    wipe: number;
    wipeAngle: number;
}

export const IDLE_FRAME: KernelTransitionFrame = {
    x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, blur: 0, glitch: 0, glitchSeed: 0, wipe: 0, wipeAngle: 0,
};

/** 包的帧只需要给出自己用到的字段。 */
export const completeFrame = (frame: Partial<KernelTransitionFrame>): KernelTransitionFrame => ({ ...IDLE_FRAME, ...frame });
export const fromSonnetFrame = completeFrame;
export const fromTemperaFrame = completeFrame;

export type { TransitionFrameContext };

export const resolveTransitionFrame = (
    id: string,
    phase: 'enter' | 'exit',
    progress: number,
    context: TransitionFrameContext,
): KernelTransitionFrame => getTransition(id)?.resolveFrame(phase, progress, context) ?? IDLE_FRAME;

/** 边界之后的进入阶段时长（钳制由转场所属的包给出）。 */
export const resolveEnterDuration = (def: TransitionDef, startTime: number, endTime: number) => (
    Math.max(def.enterClamp[0], Math.min(def.enterClamp[1], endTime - startTime))
);
