// src/kernel/adapters/tempera.ts
// tempera 接入内核。每帧逻辑取自 createTemperaPixiRuntime.ts 的 renderFrame / updateShot：
// shot 之间沿 flow 交接（两个构图在 handoff 窗口内同屏），镜头只做 shot 级，片尾卡与角标照旧。
// 背景、段落转场、后处理由内核统一处理，所以传给场景构建器的 tuning 关掉了后处理与转场模糊。
import type { TemperaTuning } from '@/packs/tempera/temperaTuning';
import type { TemperaParagraph } from '@/packs/tempera/types';
import { destroyPixiDisplayTree, setPixiDisplayTreeVisibility, unloadPixiDisplayTree } from '@/engine/shared/pixiDisplayResources';
import { hashTemperaSeed } from '@/packs/tempera/temperaRandom';
import { resolveTemperaBreathWeight, resolveTemperaCameraBreath, resolveTemperaCameraFrame } from '@/packs/tempera/temperaCamera';
import {
    buildTemperaCreditsPoster,
    buildTemperaScene,
    hasTemperaCreditsMetadata,
    type TemperaSceneView,
    type TemperaShotView,
} from '@/packs/tempera/temperaSceneBuilder';
import { resolveTemperaPalette, type TemperaPalette } from '@/packs/tempera/temperaPalette';
import {
    clamp01,
    easeTemperaEnter,
    easeTemperaInOut,
    resolveShotPacedDuration,
    resolveTemperaGlyphMotion,
} from '@/packs/tempera/temperaMotion';
import type { Theme } from '@/core/types';
import type { CreditsView, KernelContext, PackAdapter, UnitView } from '@/kernel/adapters/types';
import { cameraBetween, type TransformParams } from '@/kernel/cameraFollow';

const packTuning = (context: KernelContext) => context.tunings.packs.tempera as TemperaTuning;

const resolveAnimationScale = (theme: Theme) => (
    theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1
);

/** 场景构建器用的 tuning：后处理与转场模糊归内核。 */
const builderTuning = (tuning: TemperaTuning): TemperaTuning => ({
    ...tuning,
    postProcessEnabled: false,
    enableTransitions: false,
});

const resolveShotHandoff = (view: TemperaShotView) => (
    resolveShotPacedDuration(view.shot.endTime - view.shot.startTime, 0.3, 0.4, 1.1)
);

const resolveShotExit = (view: TemperaShotView, time: number) => (
    clamp01((time - view.shot.endTime) / resolveShotHandoff(view))
);

/**
 * 镜头的运镜（不含 shot 之间沿 flow 的交接位移与退场缩放）：由时间唯一决定，
 * 逐帧更新与素材跟随运镜共用这一份。
 */
const resolveShotCamera = (context: KernelContext, view: TemperaShotView, time: number, width: number, height: number): TransformParams => {
    const tuning = packTuning(context);
    const duration = Math.max(view.shot.endTime - view.shot.startTime, 0.001);
    const rawProgress = (time - view.shot.startTime) / duration;
    const animationScale = resolveAnimationScale(context.theme);
    const camera = tuning.cameraIntensity * animationScale * context.tunings.kernel.motion.camera;
    const frame = resolveTemperaCameraFrame(view.shot, rawProgress);

    const breathWeight = resolveTemperaBreathWeight(time, view.revealDoneTime);
    if (breathWeight > 0) {
        const breathPhase = (hashTemperaSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2;
        const breath = resolveTemperaCameraBreath(time, breathPhase);
        frame.x += breath.x * breathWeight;
        frame.y += breath.y * breathWeight;
        frame.scale += breath.scale * breathWeight;
        frame.rotation += breath.rotation * breathWeight;
    }
    return {
        x: view.baseX + frame.x * width * camera,
        y: view.baseY + frame.y * height * camera,
        pivotX: view.container.pivot.x,
        pivotY: view.container.pivot.y,
        scale: 1 + (frame.scale - 1) * camera,
        rotation: frame.rotation * camera,
    };
};

/** 没有运镜时镜头容器的变换。 */
const restTransform = (view: TemperaShotView): TransformParams => ({
    x: view.baseX,
    y: view.baseY,
    pivotX: view.container.pivot.x,
    pivotY: view.container.pivot.y,
    scale: 1,
    rotation: 0,
});

const activeShotAt = (scene: TemperaSceneView, time: number) => {
    for (let i = scene.shots.length - 1; i >= 0; i -= 1) {
        if (time >= scene.shots[i].shot.startTime) return i;
    }
    return 0;
};

const updateShot = (
    context: KernelContext,
    view: TemperaShotView,
    time: number,
    width: number,
    height: number,
) => {
    const tuning = packTuning(context);
    const animationScale = resolveAnimationScale(context.theme);
    const motion = tuning.glyphMotion * animationScale * context.tunings.kernel.motion.typography;
    const camera = resolveShotCamera(context, view, time, width, height);

    // 交接：shot 沿自己的 flow 从上游推进来，结束后继续向下游推出画面。
    const handoff = resolveShotHandoff(view);
    const span = Math.max(width, height);
    const enter = easeTemperaEnter(clamp01((time - view.shot.startTime) / (handoff * 0.8)));
    const exit = easeTemperaInOut(resolveShotExit(view, time));
    const travel = exit * span * 0.55 - (1 - enter) * span * 0.32;
    view.container.position.set(
        camera.x + Math.cos(view.shot.flowAngle) * travel,
        camera.y + Math.sin(view.shot.flowAngle) * travel,
    );
    view.container.alpha = 1 - exit;
    view.container.scale.set(camera.scale * (1 - exit * 0.08));
    view.container.rotation = camera.rotation;

    view.blocks.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime);
    view.images.updateTime(time, view.shot.startTime, view.shot.endTime, view.shot.lyricEndTime);

    view.glyphs.forEach(glyph => {
        const glyphFrame = resolveTemperaGlyphMotion(glyph.motion, time, motion);
        const x = glyph.baseX + glyphFrame.x;
        const y = glyph.baseY + glyphFrame.y;
        glyph.display.alpha = glyphFrame.alpha;
        glyph.display.visible = glyphFrame.visible;
        glyph.display.position.set(x, y);
        glyph.display.scale.set(glyphFrame.scaleX, glyphFrame.scaleY);
        glyph.display.rotation = glyphFrame.rotation;
        if (glyph.shadow) {
            glyph.shadow.alpha = glyphFrame.alpha * 0.34;
            glyph.shadow.visible = glyphFrame.visible;
            glyph.shadow.position.set(x + glyph.shadowDX, y + glyph.shadowDY);
            glyph.shadow.scale.set(glyphFrame.scaleX, glyphFrame.scaleY);
            glyph.shadow.rotation = glyphFrame.rotation;
        }
        const echoVisible = glyphFrame.visible && glyphFrame.echoAlpha > 0.004;
        glyph.echoes.forEach((echo, index) => {
            echo.visible = echoVisible;
            if (!echoVisible) return;
            const depth = 1 + index * 0.85;
            echo.alpha = glyphFrame.echoAlpha / (index + 1.4);
            echo.position.set(glyph.baseX + glyphFrame.echoX * depth, glyph.baseY + glyphFrame.echoY * depth);
            echo.scale.set(glyphFrame.scaleX, glyphFrame.scaleY);
            echo.rotation = glyphFrame.rotation;
        });
    });
};

const destroyScene = (scene: TemperaSceneView) => {
    scene.container.parent?.removeChild(scene.container);
    unloadPixiDisplayTree(scene.container);
    scene.container.filters = null;
    scene.shots.forEach(shot => {
        shot.textLayer.filters = null;
    });
    scene.postProcessFilters.forEach(filter => filter.destroy());
    destroyPixiDisplayTree(scene.container);
};

const decodeImageBlob = async (blob: Blob): Promise<ImageBitmap | HTMLImageElement> => {
    try {
        return await createImageBitmap(blob);
    } catch {
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.decoding = 'async';
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('Tempera layer image failed to decode'));
                image.src = url;
            });
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
};

const closeImageBitmap = (source: unknown) => {
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
};

/** 与原 runtime 相同的片尾节奏：最后一句结束后淡出歌词、推入海报。 */
const resolveTemperaCreditsFrame = (time: number, finalEndTime: number) => {
    const lyricAlpha = 1 - easeTemperaInOut((time - finalEndTime - 0.1) / 0.9);
    const posterProgress = easeTemperaInOut((time - finalEndTime - 0.9) / 1.1);
    return {
        active: time > finalEndTime + 0.35,
        lyricAlpha,
        lyricBlur: 0,
        posterAlpha: posterProgress,
        posterOffsetY: (1 - posterProgress) * 0.06,
        posterScale: 0.96 + posterProgress * 0.04,
    };
};

export const createTemperaAdapter = (): PackAdapter => {
    const imageTextures = new Map<string, import('pixi.js').Texture>();
    let loadedBlobs = new Map<string, Blob>();
    let lastPalette: TemperaPalette | null = null;

    const releaseTextures = () => {
        imageTextures.forEach(texture => {
            const source = texture.source.resource;
            texture.destroy(true);
            closeImageBitmap(source);
        });
        imageTextures.clear();
    };

    return {
        id: 'tempera',
        prepare: async context => {
            const blobs = context.images;
            const same = blobs.size === loadedBlobs.size && [...blobs].every(([id, blob]) => loadedBlobs.get(id) === blob);
            if (same) return;
            releaseTextures();
            loadedBlobs = new Map(blobs);
            await Promise.all([...blobs].map(async ([id, blob]) => {
                try {
                    const source = await decodeImageBlob(blob);
                    imageTextures.set(id, context.pixi.Texture.from(source));
                } catch {
                    // 解不出来的图片只是不显示。
                }
            }));
        },
        buildUnit: (context, unit): UnitView => {
            const paragraph = unit.native.paragraph as TemperaParagraph;
            const scene = buildTemperaScene(context.pixi, {
                programSeed: context.programSeed,
                host: context.host,
                theme: context.theme,
                tuning: builderTuning(packTuning(context)),
                renderResolution: context.renderResolution,
                lyricsFontScale: context.lyricsFontScale,
                staticMode: false,
                coverColors: context.coverColors,
                imageTextures,
            }, paragraph);
            lastPalette = scene.palette;
            return {
                unit,
                container: scene.container,
                wipeColor: scene.palette.tone3,
                exitFlowAngle: paragraph.shots.at(-1)?.flowAngle ?? 0,
                enterFlowAngle: paragraph.shots[0]?.flowAngle ?? 0,
                transitionSeed: 0,
                update: ({ time, width, height }) => {
                    const activeShotIndex = activeShotAt(scene, time);
                    scene.shots.forEach((shot, shotIndex) => {
                        const isActive = shotIndex === activeShotIndex;
                        const isHandingOff = shotIndex < activeShotIndex && resolveShotExit(shot, time) < 1;
                        setPixiDisplayTreeVisibility(shot.container, isActive || isHandingOff);
                        if (!shot.container.visible) return;
                        updateShot(context, shot, time, width, height);
                    });
                    scene.activeShotIndex = activeShotIndex;
                    return null;
                },
                camera: time => {
                    const view = scene.shots[activeShotAt(scene, time)];
                    if (!view) return null;
                    return {
                        matrix: cameraBetween(restTransform(view), resolveShotCamera(context, view, time, context.width, context.height)),
                        shotId: view.shot.id,
                        shotStart: view.shot.startTime,
                    };
                },
                hide: () => {
                    scene.shots.forEach(shot => {
                        shot.container.visible = false;
                    });
                    scene.activeShotIndex = -1;
                },
                setLayerVisibility: ({ graphics, text, mid }) => {
                    scene.graphicsNodes.forEach(node => { node.renderable = graphics; });
                    scene.shots.forEach(shot => {
                        shot.graphicsNodes.forEach(node => { node.renderable = graphics; });
                        shot.textNodes.forEach(node => { node.renderable = text; });
                        shot.midLayer.renderable = mid;
                    });
                },
                midLayer: time => scene.shots[activeShotAt(scene, time)]?.midLayer ?? null,
                destroy: () => destroyScene(scene),
            };
        },
        buildCredits: (context): CreditsView | null => {
            const metadata = context.metadata;
            if (!hasTemperaCreditsMetadata(metadata)) return null;
            const palette = lastPalette ?? resolveTemperaPalette(context.theme, packTuning(context), context.coverColors);
            const view = buildTemperaCreditsPoster(context.pixi, {
                theme: context.theme,
                tuning: packTuning(context),
                palette,
                metadata,
                width: context.width,
                height: context.height,
                lyricsFontScale: context.lyricsFontScale,
            });
            return {
                container: view.container,
                centered: true,
                resolveFrame: resolveTemperaCreditsFrame,
                update: elapsed => view.updateTime(elapsed),
                destroy: () => {
                    view.container.children.forEach(child => {
                        child.filters = null;
                    });
                    view.filters.forEach(filter => filter.destroy());
                    destroyPixiDisplayTree(view.container);
                },
            };
        },
        buildOverlay: context => {
            if (!packTuning(context).showCornerMarks) return null;
            const { pixi, width, height } = context;
            const g = new pixi.Graphics();
            const primary = pixi.Color.shared.setValue(context.theme.primaryColor).toNumber();
            const paddingX = Math.max(28, width * 0.045);
            const paddingY = Math.max(28, height * 0.045);
            g.moveTo(paddingX, paddingY + 14).lineTo(paddingX, paddingY).lineTo(paddingX + 14, paddingY)
                .stroke({ color: primary, width: 1.5, alpha: 0.5 });
            g.moveTo(width - paddingX - 14, height - paddingY).lineTo(width - paddingX, height - paddingY).lineTo(width - paddingX, height - paddingY - 14)
                .stroke({ color: primary, width: 1.5, alpha: 0.5 });
            return g;
        },
        dispose: () => {
            releaseTextures();
            loadedBlobs = new Map();
        },
    };
};
