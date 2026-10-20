// src/kernel/adapters/sonnet.ts
// sonnet 接入内核。每帧逻辑取自 createSonnetPixiRuntime.ts 的 renderFrame / updateShot：
// 段内同时只显示一个 shot，shot 边界用 sonnet 自己的短转场（作为帧返回给内核施加），
// 镜头逐字追踪焦点。音频从离线特征轨按时刻取值，所以预览与逐帧导出一致。
import type { SonnetTuning } from '@/packs/sonnet/sonnetTuning';
import type { SonnetParagraph } from '@/packs/sonnet/types';
import { destroySonnetDisplayTree, unloadSonnetDisplayTree } from '@/packs/sonnet/sonnetPixiResources';
import { buildSonnetIconDataUrl, buildSonnetIconTextureKey, resolveSonnetIconNames } from '@/packs/sonnet/sonnetIcons';
import {
    clamp01,
    easeSonnetInOut,
    resolveSegmentProgress,
    resolveShotMotionFrame,
    resolveShotProgress,
    resolveSonnetAnimationScale,
    resolveSonnetBreathWeight,
    resolveSonnetCameraBreath,
    resolveSonnetFocusWeights,
    resolveSonnetSmoothedCameraFocus,
    resolveTimelineShake,
} from '@/packs/sonnet/sonnetMotion';
import { hashSonnetSeed } from '@/packs/sonnet/sonnetRandom';
import { IDLE_SONNET_TRANSITION_FRAME, resolveSonnetShotTransitionFrame } from '@/packs/sonnet/sonnetTransitions';
import { buildSonnetScene, type SceneView, type ShotView } from '@/packs/sonnet/sonnetSceneBuilder';
import { isSonnetEmphasisRole } from '@/packs/sonnet/sonnetTypographyLayout';
import { getSonnetTexturePool } from '@/packs/sonnet/sonnetTexturePool';
import { buildSonnetCreditsPoster, hasSonnetCreditsMetadata, resolveSonnetCreditsFrame } from '@/packs/sonnet/sonnetCredits';
import { resolveSonnetSegmentCameraFocus } from '@/packs/sonnet/sonnetCameraTracking';
import { fromSonnetFrame } from '@/kernel/transitions';
import type { CreditsView, KernelContext, PackAdapter, UnitView } from '@/kernel/adapters/types';
import { cameraBetween, type TransformParams } from '@/kernel/cameraFollow';

const packTuning = (context: KernelContext) => context.tunings.packs.sonnet as SonnetTuning;

/** 场景构建器用的 tuning：后处理与转场 filter 归内核。 */
const builderTuning = (tuning: SonnetTuning): SonnetTuning => ({
    ...tuning,
    postProcessEnabled: false,
    enableTransitions: false,
});

/**
 * 镜头的运镜：镜头帧 + 间隙漂移 + 呼吸 + 抖动 + 追踪焦点。由时间唯一决定，
 * 逐帧更新与素材跟随运镜共用这一份。
 */
const resolveShotCamera = (context: KernelContext, view: ShotView, time: number, width: number, height: number) => {
    const tuning = packTuning(context);
    const progress = resolveShotProgress(view.shot, time);
    const camera = tuning.cameraIntensity * resolveSonnetAnimationScale(context.theme) * context.tunings.kernel.motion.camera;
    const cameraFrame = resolveShotMotionFrame(view.shot.kind, progress);

    // 间隙里沿 shot 末段的方向继续缓慢漂移，画面不冻住。
    const gapTime = Math.max(0, time - view.shot.endTime);
    if (gapTime > 0) {
        const tailStart = resolveShotMotionFrame(view.shot.kind, 0.8);
        const dx = cameraFrame.x - tailStart.x;
        const dy = cameraFrame.y - tailStart.y;
        const dScale = cameraFrame.scale - tailStart.scale;
        const dRot = cameraFrame.rotation - tailStart.rotation;
        const driftSpeed = (1 - Math.exp(-gapTime * 0.4)) * 2.0;
        cameraFrame.x += dx * driftSpeed;
        cameraFrame.y += dy * driftSpeed;
        cameraFrame.scale += dScale * driftSpeed;
        cameraFrame.rotation += dRot * driftSpeed;
    }

    const shake = resolveTimelineShake(time, 0);

    let trackSegments = view.segments.filter(s => s.role !== 'decoration' && s.trackingGlyphs.length > 0);
    if (trackSegments.length === 0) trackSegments = view.segments.filter(s => s.trackingGlyphs.length > 0);

    const revealDoneTime = trackSegments.length > 0
        ? Math.max(...trackSegments.map(segment => segment.trackingGlyphs.at(-1)?.startTime ?? view.shot.endTime))
        : view.shot.endTime;
    const breathWeight = resolveSonnetBreathWeight(time, revealDoneTime);
    if (breathWeight > 0) {
        const breathPhase = (hashSonnetSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2;
        const breath = resolveSonnetCameraBreath(time, breathPhase);
        cameraFrame.x += breath.x * breathWeight;
        cameraFrame.y += breath.y * breathWeight;
        cameraFrame.scale += breath.scale * breathWeight;
        cameraFrame.rotation += breath.rotation * breathWeight;
    }

    let currentFocusX = view.basePivotX;
    let currentFocusY = view.basePivotY;
    if (trackSegments.length > 0) {
        const focusRanges = trackSegments.map(segment => ({
            startTime: segment.trackingGlyphs[0]?.startTime ?? view.shot.startTime,
            endTime: segment.trackingGlyphs.at(-1)?.startTime ?? view.shot.endTime,
        }));
        const resolveFocusAtTime = (focusTime: number) => {
            let focusX = 0;
            let focusY = 0;
            const focusWeights = resolveSonnetFocusWeights(focusRanges, focusTime);
            for (let i = 0; i < trackSegments.length; i += 1) {
                const segment = trackSegments[i];
                if (segment.trackingGlyphs.length === 0) continue;
                const weight = focusWeights[i] ?? 0;
                const position = resolveSonnetSegmentCameraFocus(segment.trackingGlyphs, focusTime);
                focusX += position.x * weight;
                focusY += position.y * weight;
            }
            return { x: focusX, y: focusY };
        };
        const focusTime = Math.max(view.shot.startTime, Math.min(time, view.shot.endTime));
        const smoothed = resolveSonnetSmoothedCameraFocus(focusTime, view.shot.startTime, view.shot.endTime, resolveFocusAtTime);
        currentFocusX = smoothed.x;
        currentFocusY = smoothed.y;
    }

    const transform: TransformParams = {
        x: view.baseX + (cameraFrame.x * width + shake.x * width) * camera,
        y: view.baseY + (cameraFrame.y * height + shake.y * height) * camera,
        pivotX: view.basePivotX + (currentFocusX - view.basePivotX) * camera,
        pivotY: view.basePivotY + (currentFocusY - view.basePivotY) * camera,
        scale: view.shot.camera.zoom * (1 + (cameraFrame.scale - 1) * camera),
        rotation: (view.shot.camera.rotation + cameraFrame.rotation + shake.rotation) * camera,
    };
    return { transform, cameraFrame, shake, camera };
};

/** 没有运镜（强度为 0）时镜头容器的变换。 */
const restTransform = (view: ShotView): TransformParams => ({
    x: view.baseX,
    y: view.baseY,
    pivotX: view.basePivotX,
    pivotY: view.basePivotY,
    scale: view.shot.camera.zoom,
    rotation: 0,
});

const activeShotAt = (scene: SceneView, time: number) => {
    for (let i = scene.shots.length - 1; i >= 0; i -= 1) {
        if (time >= scene.shots[i].shot.startTime) return i;
    }
    return 0;
};

const updateShot = (context: KernelContext, view: ShotView, time: number, width: number, height: number) => {
    const tuning = packTuning(context);
    const motion = tuning.typographyMotion * resolveSonnetAnimationScale(context.theme) * context.tunings.kernel.motion.typography;
    const { transform, cameraFrame, shake, camera } = resolveShotCamera(context, view, time, width, height);
    view.container.pivot.set(transform.pivotX, transform.pivotY);
    view.container.scale.set(transform.scale);
    view.container.rotation = transform.rotation;
    view.container.x = transform.x;
    view.container.y = transform.y;

    if (view.mgParticleLayer) {
        view.mgParticleLayer.position.set(
            (cameraFrame.x * width + shake.x * width) * camera * 0.4,
            (cameraFrame.y * height + shake.y * height) * camera * 0.4,
        );
        view.mgParticleLayer.rotation = (time - view.shot.startTime) * 0.05;
        view.mgParticleLayer.scale.set(1 + (cameraFrame.scale - 1) * 0.3);
    }
    if (view.mgFixedGeoLayer) view.mgFixedGeoLayer.rotation = -view.container.rotation;

    const audio = context.audioAt(time);
    const mgLayer = view.mgLayer as unknown as { updateTime?: (...args: unknown[]) => void };
    mgLayer.updateTime?.(time, view.shot.cues, view.shot.startTime, view.shot.endTime, audio.bass, audio.power, audio.vocal);

    view.segments.forEach(segmentView => {
        const guide = segmentView.guide as typeof segmentView.guide & { update?: (progress: number) => void };
        const guideActive = time >= guide.startTime && time <= guide.endTime;
        guide.container.visible = guideActive && tuning.showGuide && !tuning.showOnlyText;
        if (guideActive) {
            const guideProgress = clamp01((time - guide.startTime) / Math.max(0.001, guide.endTime - guide.startTime));
            if (guide.update) {
                guide.container.alpha = guide.maxAlpha;
                guide.update(guideProgress);
            } else {
                const eased = easeSonnetInOut(guideProgress);
                guide.container.alpha = Math.sin(eased * Math.PI) * guide.maxAlpha;
                guide.container.scale.set(0.76 + eased * 0.24);
            }
        }

        const frameDecor = segmentView.frameDecor;
        if (frameDecor) {
            const frameVisible = tuning.showFixedGeo && !tuning.showOnlyText;
            frameDecor.container.visible = frameVisible;
            if (frameVisible) {
                frameDecor.update(clamp01((time - frameDecor.startTime) / Math.max(0.001, frameDecor.endTime - frameDecor.startTime)));
            }
        }

        segmentView.glyphs.forEach(glyph => {
            const glyphProgress = resolveSegmentProgress(glyph.startTime, glyph.settleTime, time);
            const waiting = time < glyph.startTime;
            const offset = (1 - glyphProgress) * motion;
            const coreAlpha = waiting ? 0 : 0.16 + glyphProgress * 0.84;
            const haloAlpha = waiting ? 0 : 1 - glyphProgress * 0.28;
            const scale = isSonnetEmphasisRole(segmentView.role) && (view.shot.typography ?? view.shot.kind) === 'type-impact'
                ? 0.52 + glyphProgress * 0.48
                : 0.86 + glyphProgress * 0.14;
            const x = glyph.baseX + glyph.enterX * offset;
            const y = glyph.baseY + glyph.enterY * offset;
            const rotation = glyph.finalRotation + glyph.entryRotation * offset;
            const isGiantDecorativeText = segmentView.role === 'decoration';
            const showTextGlyph = glyph.isTextGlyph !== false;
            const glyphVisible = tuning.showOnlyText
                ? showTextGlyph && (!isGiantDecorativeText || tuning.showGiantDecorativeText)
                : (!glyph.isBackgroundShape || tuning.showBackgroundDecor)
                    && (!isGiantDecorativeText || tuning.showGiantDecorativeText);

            const depth = glyph.zDepth || 0;
            const parallaxX = (cameraFrame.x * width + shake.x * width) * camera * depth * 2.5;
            const parallaxY = (cameraFrame.y * height + shake.y * height) * camera * depth * 2.5;
            const depthScale = 1 + depth * 0.45;

            glyph.display.alpha = coreAlpha;
            glyph.display.visible = glyphVisible;
            glyph.display.scale.set(scale * depthScale);
            glyph.display.position.set(x + parallaxX, y + parallaxY);
            glyph.display.rotation = rotation;
            if (glyph.halo) {
                glyph.halo.alpha = haloAlpha;
                glyph.halo.scale.set(scale * (1.08 - glyphProgress * 0.08));
                glyph.halo.position.set(x, y);
                glyph.halo.rotation = rotation;
            }

            if (glyph.caWrapper && glyph.caCyan && glyph.caRed && glyph.caOffset) {
                const ca = glyph.caWrapper;
                ca.visible = glyphVisible && !tuning.showOnlyText;
                ca.alpha = coreAlpha;
                ca.scale.copyFrom(glyph.display.scale);
                ca.position.copyFrom(glyph.display.position);
                ca.rotation = rotation;
                const mergeEased = easeSonnetInOut(glyphProgress);
                const currentOffset = glyph.caOffset * (1 - mergeEased * 0.8);
                glyph.caCyan.position.set(-currentOffset, currentOffset * 0.5);
                glyph.caRed.position.set(currentOffset, -currentOffset * 0.5);
            }

            if (glyph.ghosts && glyph.ghostDuration) {
                const ghostProgress = clamp01((time - glyph.startTime) / glyph.ghostDuration);
                const ghostActive = glyphVisible && ghostProgress > 0 && ghostProgress < 1;
                const envelope = ghostProgress <= 0.2
                    ? ghostProgress / 0.2
                    : Math.pow(1 - (ghostProgress - 0.2) / 0.8, 2);
                const spread = 1 - Math.pow(1 - ghostProgress, 3);
                for (const ghost of glyph.ghosts) {
                    ghost.node.visible = ghostActive;
                    if (!ghostActive) continue;
                    ghost.node.position.set(ghost.dirX * spread, ghost.dirY * spread);
                    ghost.node.alpha = envelope * ghost.alphaBase;
                }
            }

            glyph.updateAnimation?.(time);
        });
    });
};

const destroyScene = (scene: SceneView) => {
    scene.container.parent?.removeChild(scene.container);
    unloadSonnetDisplayTree(scene.container);
    scene.container.filters = null;
    scene.shots.forEach(shot => {
        shot.haloLayer.filters = null;
    });
    scene.postProcessFilters.forEach(filter => filter.destroy());
    destroySonnetDisplayTree(scene.container);
};

export const createSonnetAdapter = (): PackAdapter => {
    const iconTextures = new Map<string, import('pixi.js').Texture>();
    const iconUrls = new Set<string>();
    let iconsKey = '';
    let pixiRef: typeof import('pixi.js') | null = null;

    const releaseIcons = () => {
        if (!pixiRef) return;
        const pool = getSonnetTexturePool(pixiRef);
        iconUrls.forEach(url => pool.release(url));
        iconUrls.clear();
        iconTextures.clear();
    };

    return {
        id: 'sonnet',
        prepare: async context => {
            pixiRef = context.pixi;
            const tuning = packTuning(context);
            const { theme } = context;
            const wanted = tuning.showOnlyText || !tuning.showBackgroundDecor
                ? ''
                : JSON.stringify([theme.lyricsIcons, theme.accentColor, theme.secondaryColor, theme.primaryColor, tuning.textureResolution]);
            if (wanted === iconsKey) return;
            releaseIcons();
            iconsKey = wanted;
            if (!wanted) return;
            const names = resolveSonnetIconNames(theme.lyricsIcons);
            const pool = getSonnetTexturePool(context.pixi);
            await Promise.all(names.map(async (name, index) => {
                const size = 192 + (index % 4) * 32;
                const color = [theme.accentColor, theme.secondaryColor, theme.primaryColor][index % 3];
                const key = buildSonnetIconTextureKey(name, color, 3.5, size, tuning.textureResolution);
                const url = buildSonnetIconDataUrl(name, color, 3.5, size);
                if (!url) return;
                try {
                    iconTextures.set(key, await pool.acquire(url));
                    iconUrls.add(url);
                } catch {
                    // 无效图标可以跳过，几何 MG 仍然可用。
                }
            }));
        },
        buildUnit: (context, unit): UnitView => {
            const paragraph = unit.native.paragraph as SonnetParagraph;
            const scene = buildSonnetScene(context.pixi, {
                programSeed: context.programSeed,
                host: context.host,
                theme: context.theme,
                tuning: builderTuning(packTuning(context)),
                lyricsFontScale: context.lyricsFontScale,
                staticMode: false,
                transparentBackground: false,
            }, iconTextures, paragraph);
            const transitionSeed = hashSonnetSeed(`${context.programSeed}:${paragraph.id}:transition-frame`);
            return {
                unit,
                container: scene.container,
                wipeColor: context.theme.primaryColor,
                exitFlowAngle: 0,
                enterFlowAngle: 0,
                transitionSeed,
                update: ({ time, width, height }, transitionsEnabled) => {
                    const activeShotIndex = activeShotAt(scene, time);
                    const shotFrame = resolveSonnetShotTransitionFrame(
                        scene.shotTimeline,
                        activeShotIndex,
                        time,
                        transitionsEnabled,
                        transitionSeed,
                    );
                    scene.shots.forEach((shot, shotIndex) => {
                        const active = shotIndex === activeShotIndex;
                        shot.container.visible = active;
                        if (active) updateShot(context, shot, time, width, height);
                    });
                    if (scene.activeShotIndex !== activeShotIndex) {
                        const previous = scene.shots[scene.activeShotIndex];
                        if (previous) unloadSonnetDisplayTree(previous.container);
                        scene.activeShotIndex = activeShotIndex;
                    }
                    return shotFrame === IDLE_SONNET_TRANSITION_FRAME ? null : fromSonnetFrame(shotFrame);
                },
                camera: time => {
                    const view = scene.shots[activeShotAt(scene, time)];
                    if (!view) return null;
                    return {
                        matrix: cameraBetween(restTransform(view), resolveShotCamera(context, view, time, context.width, context.height).transform),
                        shotId: view.shot.id,
                        shotStart: view.shot.startTime,
                    };
                },
                hide: () => {
                    const previous = scene.shots[scene.activeShotIndex];
                    if (previous) unloadSonnetDisplayTree(previous.container);
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
            if (packTuning(context).showOnlyText || !hasSonnetCreditsMetadata(context.metadata)) return null;
            const container = new context.pixi.Container();
            container.addChild(buildSonnetCreditsPoster(context.pixi, context.theme, context.metadata, context.width, context.height, 1));
            return {
                container,
                centered: false,
                resolveFrame: resolveSonnetCreditsFrame,
                update: () => undefined,
                destroy: () => destroySonnetDisplayTree(container),
            };
        },
        buildOverlay: context => {
            const tuning = packTuning(context);
            if (tuning.showOnlyText || tuning.outerFrameMode === 'none') return null;
            const { pixi, width, height } = context;
            const container = new pixi.Container();
            const g = new pixi.Graphics();
            const paddingX = Math.max(30, width * 0.05);
            const paddingY = Math.max(30, height * 0.05);
            const primary = pixi.Color.shared.setValue(context.theme.primaryColor).toNumber();
            const alpha = 0.5;
            g.rect(paddingX, paddingY, 30, 4).fill({ color: primary, alpha: 0.8 });
            g.moveTo(paddingX, paddingY + 16).lineTo(paddingX, paddingY + 120).stroke({ color: primary, width: 1, alpha });
            g.rect(width - paddingX - 4, height - paddingY - 16, 4, 16).fill({ color: primary, alpha: 0.8 });
            g.moveTo(width - paddingX - 160, height - paddingY).lineTo(width - paddingX - 20, height - paddingY).stroke({ color: primary, width: 1, alpha });
            g.moveTo(width - paddingX, height - paddingY - 180).lineTo(width - paddingX, height - paddingY - 30).stroke({ color: primary, width: 1, alpha });
            const drawCross = (cx: number, cy: number, size: number) => {
                g.moveTo(cx - size, cy).lineTo(cx + size, cy).stroke({ color: primary, width: 1, alpha: 0.8 });
                g.moveTo(cx, cy - size).lineTo(cx, cy + size).stroke({ color: primary, width: 1, alpha: 0.8 });
            };
            drawCross(width - paddingX, paddingY + 20, 6);
            g.moveTo(paddingX, height - paddingY - 4).lineTo(paddingX + 4, height - paddingY).lineTo(paddingX, height - paddingY + 4).lineTo(paddingX - 4, height - paddingY).fill({ color: primary, alpha: 0.7 });
            const star = new pixi.Text({
                text: '✦',
                style: new pixi.TextStyle({ fontFamily: 'sans-serif', fontSize: 12, fill: primary }),
            });
            star.alpha = 0.6;
            star.position.set(width - paddingX - 10, height - paddingY);
            star.anchor.set(1, 0.5);
            container.addChild(g, star);
            return container;
        },
        dispose: () => {
            releaseIcons();
            iconsKey = '';
        },
    };
};
