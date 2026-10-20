import type { Line } from '@/packs/_compat/foliaTypes';
import type { GraphemeTiming } from '@/core/lyrics/graphemeTiming';

// src/packs/sonnet/types.ts
// Public, renderer-independent contracts for the deterministic Sonnet PV program.
export type SonnetParagraphKind = 'breath' | 'verse' | 'lift' | 'chorus' | 'break' | 'outro';
export type SonnetParagraphBoundary = 'song-start' | 'time-gap' | 'metadata' | 'duration-cap' | 'line-cap';
export type SonnetShotKind =
    | 'editorial-column'
    | 'type-impact'
    | 'fragment-collage'
    | 'tracking-ribbon'
    | 'mask-reveal'
    | 'poster-blocks'
    | 'quiet-tableau';
export const SONNET_TRANSITION_KINDS = [
    'fast-blur',
    'mono-glitch',
    'camera-pull',
] as const;
export type SonnetTransitionKind = typeof SONNET_TRANSITION_KINDS[number];

export interface SonnetSemanticSegment {
    text: string;
    startOffset: number;
    endOffset: number;
    startTime: number;
    endTime: number;
    wordIndices: number[];
    graphemes: GraphemeTiming[];
    isWordLike: boolean;
}

export interface SonnetCompiledLine {
    sourceIndex: number;
    line: Line;
    renderEndTime: number;
    segments: SonnetSemanticSegment[];
}

export interface SonnetAnimationCue {
    at: number;
    duration: number;
    kind: 'enter' | 'hold' | 'exit' | 'accent';
    segmentStart: number;
    segmentEnd: number;
}

/** lumisynth 路线 E：点缀（MG 图层）的替换。不设置时按 kind 的原规则。 */
export const SONNET_ACCENTS = ['geo', 'hud', 'none'] as const;
export type SonnetAccent = typeof SONNET_ACCENTS[number];

export interface SonnetShot {
    id: string;
    kind: SonnetShotKind;
    /** lumisynth 路线 E：按另一种镜头的排字方式排版（构图、镜头运动、MG 仍按 kind）。 */
    typography?: SonnetShotKind;
    /** lumisynth 路线 E：替换点缀。 */
    accent?: SonnetAccent;
    /** lumisynth 跨包借排版：字由别的包排，本镜头只画构图。 */
    textHidden?: true;
    startTime: number;
    endTime: number;
    lineIndices: number[];
    cues: SonnetAnimationCue[];
    camera: {
        x: number;
        y: number;
        zoom: number;
        rotation: number;
    };
}

export interface SonnetTransition {
    kind: SonnetTransitionKind;
    startTime: number;
    endTime: number;
}

export interface SonnetParagraph {
    id: string;
    kind: SonnetParagraphKind;
    boundary: SonnetParagraphBoundary;
    startTime: number;
    endTime: number;
    lines: SonnetCompiledLine[];
    shots: SonnetShot[];
    transitionOut: SonnetTransition | null;
}

export interface SonnetProgram {
    version: 1;
    seed: string;
    paragraphGapThreshold: number;
    paragraphs: SonnetParagraph[];
}

export interface SonnetShotTemplate {
    kind: SonnetShotKind;
    supports: (lines: SonnetCompiledLine[], paragraphKind: SonnetParagraphKind) => boolean;
}

export interface SonnetTransitionTemplate {
    kind: SonnetTransitionKind;
}
