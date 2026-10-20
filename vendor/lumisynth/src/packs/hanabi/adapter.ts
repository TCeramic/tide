// src/packs/hanabi/adapter.ts
// 花火接入内核：一个场景单元 = 段内一串连续的花火镜头，由 scene.ts 画（整单元一个世界持续上升，
// 所以单元内部不返回 shot 级转场帧）。粒子纹理整个适配器共享。背景、段落转场、后处理归内核。
import type { KernelContext, PackAdapter, UnitView } from '@/kernel/adapters/types';
import { cameraBetween } from '@/kernel/cameraFollow';
import { createRng } from '@/core/rng';
import { cssOfHex, resolveHanabiPalette } from './color';
import { createHanabiCredits, hasHanabiCredits, resolveHanabiCreditsFrame } from './credits';
import { createHanabiTextures } from './mg/textures';
import { buildHanabiOverlay } from './overlay';
import { resolveShotProfile, shotLine, type HanabiParagraph } from './program';
import { createHanabiScene, type HanabiSceneShot } from './scene';
import { DEFAULT_HANABI_TUNING, HANABI_PACK_ID, type HanabiTextures, type HanabiTuning } from './types';

const tuningOf = (context: KernelContext): HanabiTuning => ({
    ...DEFAULT_HANABI_TUNING,
    ...(context.tunings.packs[HANABI_PACK_ID] as Partial<HanabiTuning> | undefined),
});

export const createHanabiAdapter = (): PackAdapter => {
    let textures: HanabiTextures | null = null;
    let resolution = 0;
    // 分辨率变了要重画纹理；旧的可能还被已建好的单元用着，留到 dispose 再放。
    const retired: HanabiTextures[] = [];

    const texturesFor = (context: KernelContext) => {
        if (!textures || resolution !== context.renderResolution) {
            if (textures) retired.push(textures);
            textures = createHanabiTextures(context.pixi, context.renderResolution);
            resolution = context.renderResolution;
        }
        return textures;
    };

    return {
        id: HANABI_PACK_ID,
        prepare: async context => {
            texturesFor(context);
        },
        buildUnit: (context, unit): UnitView => {
            const paragraph = unit.native.paragraph as HanabiParagraph;
            const lineMap = new Map(paragraph.lineIndices.map((lineIndex, index) => [lineIndex, paragraph.lines[index]!]));
            const shots: HanabiSceneShot[] = paragraph.shots.map(shot => ({
                id: shot.id,
                profile: resolveShotProfile(shot),
                startTime: shot.startTime,
                endTime: shot.endTime,
                isBridge: shot.isBridge,
                line: shot.isBridge ? null : shotLine(lineMap, shot.slices),
                textHidden: shot.textHidden === true,
            }));
            if (shots.length === 0) {
                // 不会发生（单元至少一个镜头）；防御：给一个覆盖整段的间奏。
                shots.push({
                    id: paragraph.id,
                    profile: resolveShotProfile({ kind: '' }),
                    startTime: paragraph.startTime,
                    endTime: paragraph.endTime,
                    isBridge: true,
                    line: null,
                });
            }
            const tuning = tuningOf(context);
            const scene = createHanabiScene(context.pixi, {
                width: context.width,
                height: context.height,
                resolution: context.renderResolution,
                seed: `${context.programSeed}:${paragraph.id}`,
                theme: context.theme,
                tuning,
                shots,
                startTime: paragraph.startTime,
                endTime: paragraph.endTime,
                textures: texturesFor(context),
                fontScale: context.lyricsFontScale,
                exitStart: paragraph.transitionOut?.startTime ?? null,
            });
            const shotIdAt = (time: number) => shots[scene.timeline.shotAt(time)]?.id ?? paragraph.id;
            const transitionSeed = Math.floor(createRng(`${context.programSeed}:${paragraph.id}:transition`)() * 2 ** 31);
            const lead = resolveHanabiPalette(shots[0]!.profile.palette, context.theme, tuning.colorMode);
            return {
                unit,
                container: scene.view,
                wipeColor: cssOfHex(lead.accent),
                // 摄影机向上走，画面里的东西向下流。
                exitFlowAngle: Math.PI / 2,
                enterFlowAngle: Math.PI / 2,
                transitionSeed,
                update: ({ time }) => {
                    scene.update(time);
                    return null;
                },
                camera: time => ({
                    matrix: cameraBetween(scene.rest, scene.camera(time)),
                    shotId: shotIdAt(time),
                    shotStart: scene.timeline.shots[scene.timeline.shotAt(time)]?.start ?? paragraph.startTime,
                }),
                midLayer: time => scene.midLayer(time),
                setLayerVisibility: layers => scene.setLayerVisibility(layers),
                hide: () => undefined,
                destroy: () => scene.destroy(),
            };
        },
        buildCredits: context => {
            const tuning = tuningOf(context);
            if (tuning.textOnly || !hasHanabiCredits(context.metadata)) return null;
            const credits = createHanabiCredits(context.pixi, {
                width: context.width,
                height: context.height,
                resolution: context.renderResolution,
                theme: context.theme,
                metadata: context.metadata,
                tuning,
                textures: texturesFor(context),
                fontScale: context.lyricsFontScale,
            });
            return {
                container: credits.view,
                centered: false,
                resolveFrame: resolveHanabiCreditsFrame,
                update: credits.update,
                destroy: credits.destroy,
            };
        },
        buildOverlay: context => {
            const tuning = tuningOf(context);
            if (tuning.textOnly || !tuning.overlayFrame) return null;
            return buildHanabiOverlay(context.pixi, context.width, context.height, context.theme, tuning.colorMode, context.renderResolution);
        },
        dispose: () => {
            textures?.destroy();
            retired.forEach(item => item.destroy());
            retired.length = 0;
            textures = null;
            resolution = 0;
        },
    };
};
