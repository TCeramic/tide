// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/adapter.ts
// 绘光接入内核：一个场景单元 = 段内一串连续的绘光镜头（「轨迹」转场连起来的几段并成一个），由 scene.ts 画
// （持续的层整单元一份，光位与线稿随镜头交叉渐变，所以单元内部不返回 shot 级转场帧）。背景、段落转场、后处理归内核。
import type { KernelContext, PackAdapter, UnitView } from '@/kernel/adapters/types';
import { cameraBetween } from '@/kernel/cameraFollow';
import { createRng } from '@/core/rng';
import { profileOf } from './catalog';
import { createLumiereCredits, hasLumiereCredits, resolveLumiereCreditsFrame } from './credits';
import { buildLumiereOverlay } from './overlay';
import { createLightSprites, type LightSprites } from './light/sprites';
import type { LumiereParagraph } from './program';
import { createLumiereScene, type SceneShot } from './scene';
import { DEFAULT_LUMIERE_TUNING, LUMIERE_PACK_ID, type BurstSpec, type LumiereTuning } from './types';

/** 光位没有声明爆闪、但用户在组件槽里打开时用的设置。 */
const DEFAULT_BURST: BurstSpec = { mode: 'sung', density: 0.35, every: 1, offset: 0, size: 3.6, tint: [1, 0.75, 0.55] };

const tuningOf = (context: KernelContext): LumiereTuning => ({
    ...DEFAULT_LUMIERE_TUNING,
    ...(context.tunings.packs[LUMIERE_PACK_ID] as Partial<LumiereTuning> | undefined),
});

export const createLumiereAdapter = (): PackAdapter => {
    let sprites: LightSprites | null = null;

    return {
        id: LUMIERE_PACK_ID,
        prepare: async context => {
            if (!sprites) sprites = createLightSprites(context.pixi);
        },
        buildUnit: (context, unit): UnitView => {
            if (!sprites) sprites = createLightSprites(context.pixi);
            const paragraph = unit.native.paragraph as LumiereParagraph;
            const localLine = new Map(paragraph.lineIndices.map((lineIndex, index) => [lineIndex, index]));
            const shots: SceneShot[] = paragraph.shots.map(shot => {
                const profile = profileOf(shot.kind);
                return {
                    profile,
                    startTime: shot.startTime,
                    endTime: shot.endTime,
                    lines: shot.lineIndices.map(index => localLine.get(index)).filter((index): index is number => index !== undefined),
                    burst: shot.burst === 'off' ? null : shot.burst === 'on' ? profile.burst ?? DEFAULT_BURST : undefined,
                    typography: shot.typography,
                    textHidden: shot.textHidden === true,
                };
            });
            if (shots.length === 0) {
                // 不会发生（单元至少一个镜头）；防御：给一个覆盖整段的天井。
                shots.push({ profile: profileOf(''), startTime: paragraph.startTime, endTime: paragraph.endTime, lines: [] });
            }
            const tuning = tuningOf(context);
            const scene = createLumiereScene(context.pixi, {
                width: context.width,
                height: context.height,
                resolution: context.renderResolution,
                seed: `${context.programSeed}:${paragraph.id}`,
                theme: context.theme,
                tuning,
                lines: paragraph.lines,
                shots,
                startTime: paragraph.startTime,
                endTime: paragraph.endTime,
                sprites,
                opening: paragraph.opening,
                sections: paragraph.sections,
                fadeOut: paragraph.transitionOut?.kind === 'lights-out'
                    ? { start: paragraph.transitionOut.startTime, end: paragraph.transitionOut.endTime }
                    : null,
                audioAt: time => context.audioAt(time),
            });
            const shotAt = (time: number) => {
                let found = paragraph.shots[0];
                for (const shot of paragraph.shots) if (shot.startTime <= time) found = shot;
                return found;
            };
            const transitionSeed = Math.floor(createRng(`${context.programSeed}:${paragraph.id}:transition`)() * 2 ** 31);
            return {
                unit,
                container: scene.view,
                wipeColor: context.theme.primaryColor,
                exitFlowAngle: 0,
                enterFlowAngle: 0,
                transitionSeed,
                update: ({ time }) => {
                    scene.update(time);
                    return null;
                },
                // 运镜整个单元连续（不按镜头重置），motion 跟随以单元开头为基准。
                camera: time => ({
                    matrix: cameraBetween(scene.rest, scene.camera(time)),
                    shotId: shotAt(time)?.id ?? paragraph.id,
                    shotStart: paragraph.startTime,
                }),
                midLayer: () => scene.mid,
                setLayerVisibility: ({ graphics, text, mid }) => {
                    // 只画字的客单元始终不画图形组。
                    scene.graphics.renderable = graphics && !tuning.textOnly;
                    scene.front.renderable = graphics && !tuning.textOnly;
                    scene.text.renderable = text;
                    scene.mid.renderable = mid;
                },
                hide: () => undefined,
                destroy: () => scene.destroy(),
            };
        },
        buildCredits: context => {
            const tuning = tuningOf(context);
            if (tuning.textOnly || !hasLumiereCredits(context.metadata)) return null;
            if (!sprites) sprites = createLightSprites(context.pixi);
            const credits = createLumiereCredits(context.pixi, {
                width: context.width,
                height: context.height,
                resolution: context.renderResolution,
                theme: context.theme,
                metadata: context.metadata,
                tuning,
                sprites,
            });
            return {
                container: credits.view,
                centered: false,
                resolveFrame: resolveLumiereCreditsFrame,
                update: credits.update,
                destroy: credits.destroy,
            };
        },
        buildOverlay: context => {
            const tuning = tuningOf(context);
            if (tuning.textOnly || !tuning.overlayFrame) return null;
            return buildLumiereOverlay(context.pixi, context.width, context.height, context.theme, tuning.themeColorMix);
        },
        dispose: () => {
            sprites?.destroy();
            sprites = null;
        },
    };
};
