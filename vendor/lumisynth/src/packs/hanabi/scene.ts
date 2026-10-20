// src/packs/hanabi/scene.ts
// 一个场景单元（段内一串连续的花火镜头）：世界整体上升，每个镜头在世界里各自的高度上组装
// 烟花（主烟花、被唱到的小烟花、升空尾迹）、装饰件、字底色块、素材层与字（docs/HANABI.md「画面分层」「上升」）。
//   view
//   └ stage（镜头内运镜：推近、摆动、入场震动）
//      ├ ambient.back（屏幕坐标，按 rise 自己做视差）
//      ├ world（y = rise(t)）
//      │  └ 每个镜头一个 shot 容器：fireworks → ornaments(back) → text.blocks → mid → text.glyphs → ornaments(front)
//      └ ambient.front
// 烟花事件在构建时按镜头算好（纯数据），每帧筛出活跃的；只更新可见时间附近的镜头。每帧画面只由 t 决定。
import type { Container } from 'pixi.js';
import type { Line, Theme } from '@/core/types';
import { createRng } from '@/core/rng';
import type { TransformParams } from '@/kernel/cameraFollow';
import { burstPreset } from './catalog';
import { keywordColorOf, resolveHanabiPalette } from './color';
import { createAmbient } from './mg/ambient';
import { createFireworks } from './mg/fireworks';
import { createHanabiGlow } from './mg/glow';
import { createOrnament } from './mg/ornaments';
import { createHanabiText } from './text/lyricText';
import { buildTimeline, LAUNCH_DURATION, type ShotTiming, type Timeline, type TimelineShot } from './timeline';
import type {
    AmbientLayer,
    BurstEvent,
    BurstSpec,
    FireworksLayer,
    GlyphAnchor,
    HanabiPalette,
    HanabiProfile,
    HanabiTextView,
    HanabiTextures,
    HanabiTuning,
    LaunchEvent,
    OrnamentView,
    PixiModule,
} from './types';

/** 单元里的一个镜头（组件已经套进 profile）。 */
export interface HanabiSceneShot {
    id: string;
    profile: HanabiProfile;
    startTime: number;
    endTime: number;
    isBridge: boolean;
    /** 镜头的文字（切片拼成的一行）；间奏为 null。 */
    line: Line | null;
    /** 借排版的宿主：自己的字隐去，烟花与装饰照常。 */
    textHidden?: boolean;
}

export interface HanabiSceneOptions {
    width: number;
    height: number;
    resolution: number;
    seed: string;
    theme: Theme;
    tuning: HanabiTuning;
    shots: HanabiSceneShot[];
    startTime: number;
    endTime: number;
    textures: HanabiTextures;
    /** 歌词字号倍率（工程的字体设置）。 */
    fontScale?: number;
    /** 段落出场转场开始的时刻：最后一个镜头的字在这之后退场。 */
    exitStart?: number | null;
}

export interface HanabiScene {
    view: Container;
    timeline: Timeline;
    /** 各镜头预先算好的烟花事件（调试与测试用）。 */
    events: Array<{ bursts: BurstEvent[]; launches: LaunchEvent[] }>;
    /** time 时刻所在镜头的素材插入层。 */
    midLayer: (time: number) => Container | null;
    camera: (time: number) => TransformParams;
    rest: TransformParams;
    update: (time: number) => void;
    setLayerVisibility: (layers: { graphics: boolean; text: boolean; mid: boolean }) => void;
    destroy: () => void;
}

/** 一个镜头烟花精灵池的上限（同时可见的镜头一般不超过两个，整单元约 1500）。 */
const SHOT_PARTICLES = 750;
/** 被唱到的小烟花、碎成火花的退场，一个镜头最多放多少朵。 */
const MAX_SUNG_BURSTS = 28;
const MAX_DISSOLVE_BURSTS = 24;
/** 退场碎成火花时，每个字心放的小火花。 */
const DISSOLVE_SPARK: BurstSpec = { kind: 'botan', count: 10, radius: 0.03, duration: 0.65, colors: [0, 1, 2], trail: 0.25, twinkle: 0.6 };
/** 间奏的连发里轮换的烟花。 */
const BRIDGE_KINDS: BurstSpec['kind'][] = ['mine', 'senrin', 'kiku', 'botan', 'ring', 'crossette', 'willow-ring', 'strobe'];

const MOTION: Record<Theme['animationIntensity'], number> = { calm: 0.6, normal: 1, chaotic: 1.4 };

/** 文字视图本地坐标 → 镜头容器坐标（视图自己的位置 / 缩放 / 旋转）。 */
const toShot = (view: Container, x: number, y: number) => {
    const px = (x - view.pivot.x) * view.scale.x;
    const py = (y - view.pivot.y) * view.scale.y;
    const cos = Math.cos(view.rotation);
    const sin = Math.sin(view.rotation);
    return { x: view.position.x + px * cos - py * sin, y: view.position.y + px * sin + py * cos };
};

const sungRange = (line: Line | null) => {
    const words = (line?.words ?? []).filter(word => word.text.trim().length > 0);
    if (words.length === 0) return { first: line?.startTime ?? null, last: line?.endTime ?? null };
    return { first: words[0]!.startTime, last: Math.max(...words.map(word => word.endTime)) };
};

/** 从一串里等距取不超过 max 个。 */
const thin = <T>(items: T[], max: number) => {
    if (items.length <= max) return items;
    const step = items.length / max;
    return Array.from({ length: max }, (_, k) => items[Math.floor(k * step)]!);
};

interface ShotRig {
    fireworks: FireworksLayer | null;
    ornaments: OrnamentView[];
}

interface BuiltShot {
    shot: HanabiSceneShot;
    timing: ShotTiming;
    palette: HanabiPalette;
    container: Container;
    fireworksHolder: Container;
    ornBack: Container;
    ornFront: Container;
    mid: Container;
    text: HanabiTextView | null;
    bursts: BurstEvent[];
    launches: LaunchEvent[];
    lifeStart: number;
    lifeEnd: number;
    rig: ShotRig | null;
}

export const createHanabiScene = (pixi: PixiModule, options: HanabiSceneOptions): HanabiScene => {
    const { width, height, tuning, theme, textures } = options;
    const unit = Math.min(width, height);
    const motion = MOTION[theme.animationIntensity] ?? 1;
    const fontScale = options.fontScale ?? 1;
    const graphicsOn = !tuning.textOnly;
    const keywordColor = keywordColorOf(theme);

    const paletteCache = new Map<string, HanabiPalette>();
    const paletteOf = (profile: HanabiProfile) => {
        let palette = paletteCache.get(profile.palette);
        if (!palette) {
            palette = resolveHanabiPalette(profile.palette, theme, tuning.colorMode);
            paletteCache.set(profile.palette, palette);
        }
        return palette;
    };

    const timelineShots: TimelineShot[] = options.shots.map(shot => {
        const sung = sungRange(shot.line);
        return {
            startTime: shot.startTime,
            endTime: shot.endTime,
            firstSung: shot.isBridge ? null : sung.first,
            lastSungEnd: shot.isBridge ? null : sung.last,
            isBridge: shot.isBridge,
            camera: shot.profile.camera,
        };
    });
    const timeline = buildTimeline(timelineShots, {
        unitStart: options.startTime,
        unitEnd: options.endTime,
        height,
        // 借给别的包时（只画字）字要停在宿主的文字区里，不随世界上漂。
        riseSpeed: graphicsOn ? Math.max(0, tuning.riseSpeed) : 0,
        motion: motion * Math.max(0, tuning.textMotion),
        exitStart: options.exitStart ?? null,
    });

    const view = new pixi.Container();
    const stage = new pixi.Container();
    const world = new pixi.Container();
    view.addChild(stage);

    // 环境层整单元一份，按屏幕坐标画、自己做视差，所以放在世界外面。
    const lead = options.shots[0];
    const distantRate = options.shots.reduce((sum, shot) => sum + ({ quiet: 0.08, neutral: 0.2, loud: 0.35 }[shot.profile.mood]), 0)
        / Math.max(options.shots.length, 1);
    const ambient: AmbientLayer | null = graphicsOn && tuning.ambient > 0 && lead
        ? createAmbient({
            pixi,
            textures,
            width,
            height,
            seed: `${options.seed}:ambient`,
            palette: paletteOf(lead.profile),
            startTime: options.startTime,
            endTime: options.endTime,
            density: Math.min(2, tuning.ambient),
            distantBursts: distantRate,
        })
        : null;
    if (ambient) stage.addChild(ambient.back);
    stage.addChild(world);
    if (ambient) stage.addChild(ambient.front);

    // 辉光整单元一个 filter，挂在各镜头的烟花层上。
    const glow = graphicsOn && tuning.glow > 0 ? createHanabiGlow(pixi, Math.min(2, tuning.glow)) : null;

    /** 画面坐标 (sx, sy) 在 time 时刻对应的镜头容器坐标（不计镜头内运镜）。 */
    const screenToShot = (built: { region: HanabiProfile['region']; timing: ShotTiming }, sx: number, sy: number, time: number) => ({
        x: sx - built.region.cx * width,
        y: sy - (built.region.cy * height + built.timing.worldY + timeline.rise(time)),
    });

    const built: BuiltShot[] = options.shots.map((shot, index) => {
        const { profile } = shot;
        const timing = timeline.shots[index]!;
        const palette = paletteOf(profile);
        const region = profile.region;
        const container = new pixi.Container();
        container.position.set(region.cx * width, region.cy * height + timing.worldY);
        const fireworksHolder = new pixi.Container();
        const ornBack = new pixi.Container();
        const ornFront = new pixi.Container();
        const mid = new pixi.Container();
        container.addChild(fireworksHolder, ornBack);

        const text: HanabiTextView | null = shot.line && !shot.isBridge
            ? createHanabiText({
                pixi,
                width,
                height,
                resolution: options.resolution,
                theme,
                line: shot.line,
                regionWidth: region.w * width,
                regionHeight: region.h * height,
                spec: { ...profile.text, heroSize: profile.text.heroSize * fontScale },
                palette,
                seed: `${options.seed}:${shot.id}:text`,
                enterAt: timing.enterAt,
                exitAt: timing.exitAt,
                exitDuration: timing.exitDuration,
                motion: Math.max(0, tuning.textMotion),
                blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity)),
                keywordColor,
            })
            : null;
        if (text) {
            container.addChild(text.view);
            // 素材层插在色块与字之间：字在哪个容器里，就插在那个容器里字的前面。
            const glyphParent = text.glyphs.parent;
            if (glyphParent) glyphParent.addChildAt(mid, glyphParent.getChildIndex(text.glyphs));
            else container.addChild(mid);
        } else {
            container.addChild(mid);
        }
        container.addChild(ornFront);
        world.addChild(container);

        const { bursts, launches } = graphicsOn
            ? planShotEvents({ shot, index, timing, palette, text, region, seed: options.seed, screenToShot, width, height, unit, tuning })
            : { bursts: [], launches: [] };
        const burstEnd = Math.max(...bursts.map(event => event.at + event.spec.duration), -Infinity);
        const launchEnd = Math.max(...launches.map(event => event.at + event.duration + 0.7), -Infinity);
        return {
            shot,
            timing,
            palette,
            container,
            fireworksHolder,
            ornBack,
            ornFront,
            mid,
            text,
            bursts,
            launches,
            lifeStart: Math.min(timing.launchAt, timing.enterAt) - 0.1,
            lifeEnd: Math.max(timing.exitAt + timing.exitDuration + 0.3, burstEnd + 0.05, launchEnd),
            rig: null,
        };
    });

    const buildRig = (item: BuiltShot): ShotRig => {
        if (!graphicsOn) return { fireworks: null, ornaments: [] };
        const fireworks = createFireworks(pixi, textures, {
            width,
            height,
            palette: item.palette,
            amount: Math.max(0, tuning.sparkAmount),
            maxParticles: SHOT_PARTICLES,
        });
        item.fireworksHolder.addChild(fireworks.view);
        if (glow) item.fireworksHolder.filters = [glow];
        const region = item.shot.profile.region;
        const bounds = item.text?.bounds ?? { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height };
        const text = item.text;
        const anchorsAt = text ? (time: number) => text.anchors(time) : () => [] as GlyphAnchor[];
        const ornaments = tuning.ornamentAmount > 0
            ? item.shot.profile.ornaments.map((spec, k) => {
                const ornament = createOrnament(spec, {
                    pixi,
                    textures,
                    width,
                    height,
                    seed: `${options.seed}:${item.shot.id}:ornament${k}`,
                    palette: item.palette,
                    bounds,
                    anchorsAt,
                    enterAt: item.timing.enterAt,
                    exitAt: item.timing.exitAt,
                    exitDuration: item.timing.exitDuration,
                    amount: Math.min(2, tuning.ornamentAmount),
                });
                (spec.layer === 'front' ? item.ornFront : item.ornBack).addChild(ornament.view);
                return ornament;
            })
            : [];
        return { fireworks, ornaments };
    };

    const releaseRig = (item: BuiltShot) => {
        if (!item.rig) return;
        item.fireworksHolder.filters = [];
        item.rig.fireworks?.destroy();
        item.rig.ornaments.forEach(ornament => ornament.destroy());
        item.rig = null;
    };

    let layers = { graphics: true, text: true, mid: true };
    const applyLayers = () => {
        if (ambient) {
            ambient.back.renderable = layers.graphics;
            ambient.front.renderable = layers.graphics;
        }
        for (const item of built) {
            item.fireworksHolder.renderable = layers.graphics;
            item.ornBack.renderable = layers.graphics;
            item.ornFront.renderable = layers.graphics;
            item.mid.renderable = layers.mid;
            if (item.text) {
                const shown = layers.text && !item.shot.textHidden;
                item.text.blocks.renderable = shown;
                item.text.glyphs.renderable = shown;
            }
        }
    };
    applyLayers();

    const rest: TransformParams = { x: width / 2, y: height / 2, pivotX: width / 2, pivotY: height / 2, scale: 1, rotation: 0 };
    const camera = (time: number): TransformParams => {
        const offset = timeline.camera(time);
        return { ...rest, x: rest.x + offset.dx, y: rest.y + offset.dy, scale: offset.scale, rotation: offset.rotation };
    };

    const activeBursts: BurstEvent[] = [];
    const activeLaunches: LaunchEvent[] = [];

    const update = (time: number) => {
        const transform = camera(time);
        stage.pivot.set(transform.pivotX, transform.pivotY);
        stage.position.set(transform.x, transform.y);
        stage.scale.set(transform.scale);
        stage.rotation = transform.rotation;
        const rise = timeline.rise(time);
        world.y = rise;
        ambient?.update(time, rise);

        for (const item of built) {
            const visible = time >= item.lifeStart && time <= item.lifeEnd;
            item.container.visible = visible;
            if (!visible) {
                releaseRig(item);
                continue;
            }
            if (!item.rig) item.rig = buildRig(item);
            item.text?.update(time);
            if (item.rig.fireworks) {
                activeBursts.length = 0;
                activeLaunches.length = 0;
                for (const event of item.bursts) {
                    if (event.at > time) break;
                    if (time <= event.at + event.spec.duration + 0.1) activeBursts.push(event);
                }
                for (const event of item.launches) {
                    if (event.at <= time && time <= event.at + event.duration + 0.7) activeLaunches.push(event);
                }
                item.rig.fireworks.update(time, activeBursts, activeLaunches);
            }
            item.rig.ornaments.forEach(ornament => ornament.update(time));
        }
    };

    const midLayer = (time: number) => built[timeline.shotAt(time)]?.mid ?? null;

    return {
        view,
        timeline,
        events: built.map(item => ({ bursts: item.bursts, launches: item.launches })),
        midLayer,
        camera,
        rest,
        update,
        setLayerVisibility: next => {
            layers = { ...next };
            applyLayers();
        },
        destroy: () => {
            built.forEach(item => {
                releaseRig(item);
                item.text?.destroy();
            });
            ambient?.destroy();
            glow?.destroy();
            view.destroy({ children: true });
        },
    };
};

// ─── 烟花事件（构建时算好） ─────────────────────────────────────────────

interface PlanInput {
    shot: HanabiSceneShot;
    index: number;
    timing: ShotTiming;
    palette: HanabiPalette;
    text: HanabiTextView | null;
    region: HanabiProfile['region'];
    seed: string;
    screenToShot: (built: { region: HanabiProfile['region']; timing: ShotTiming }, sx: number, sy: number, time: number) => { x: number; y: number };
    width: number;
    height: number;
    unit: number;
    tuning: HanabiTuning;
}

/**
 * 一个镜头的烟花：主烟花（文字入场时开，burstAt 决定位置，带升空尾迹）、被唱到的字各放一朵小花、
 * 碎成火花的退场；间奏镜头是一串スターマイン / 千輪。位置都在镜头容器坐标里。
 */
const planShotEvents = (input: PlanInput): { bursts: BurstEvent[]; launches: LaunchEvent[] } => {
    const { shot, index, timing, palette, text, region, width, height, unit, tuning } = input;
    const { profile } = shot;
    const random = createRng(`${input.seed}:${shot.id}:${index}:events`);
    const bursts: BurstEvent[] = [];
    const launches: LaunchEvent[] = [];
    const locate = (sx: number, sy: number, time: number) => input.screenToShot({ region, timing }, sx, sy, time);
    const launchColor = palette.glow;
    const withLaunch = profile.launch && tuning.launches;

    /** 从画面底边升到 (x, y)（镜头坐标），到达时刻 = arrive。 */
    const launchTo = (x: number, y: number, arrive: number, key: string) => {
        const at = arrive - LAUNCH_DURATION;
        const bottom = locate(0, height * 1.03, at).y;
        launches.push({
            fromX: x + (random() - 0.5) * width * 0.08,
            fromY: Math.max(bottom, y + height * 0.2),
            toX: x,
            toY: y,
            at,
            duration: LAUNCH_DURATION,
            color: launchColor,
            seed: `${input.seed}:${shot.id}:${key}:launch`,
        });
    };

    const shape = (spec: BurstSpec) => (spec.kind === 'ring' || spec.kind === 'willow-ring' || spec.kind === 'heart' || spec.kind === 'star'
        ? { squash: spec.kind === 'ring' ? 0.4 + random() * 0.5 : 1, rotation: (random() - 0.5) * 0.6 }
        : {});

    if (shot.isBridge) {
        // 间奏：スターマイン / 千輪 连发，沿画面随机高处开，每朵都有尾迹（スターマイン 从底边喷）。
        const from = timing.start + 0.15;
        const to = timing.end - 0.3;
        const duration = Math.max(0, to - from);
        const count = Math.max(1, Math.min(10, Math.round(duration / 0.75)));
        const kinds = profile.burst ? [profile.burst.kind, ...BRIDGE_KINDS] : BRIDGE_KINDS;
        for (let k = 0; k < count; k += 1) {
            const at = from + (count === 1 ? 0 : (k / (count - 1)) * duration * 0.85) + random() * 0.12;
            const kind = kinds[Math.floor(random() * kinds.length)]!;
            const spec = burstPreset(kind, [k % 5, (k + 1) % 5, (k + 2) % 5]);
            if (kind === 'mine') {
                const p = locate(width * (0.2 + random() * 0.6), height * 0.94, at);
                bursts.push({ x: p.x, y: p.y, at, spec, seed: `${input.seed}:${shot.id}:b${k}`, scale: 0.8 + random() * 0.3 });
                continue;
            }
            const p = locate(width * (0.15 + random() * 0.7), height * (0.14 + random() * 0.34), at);
            bursts.push({ x: p.x, y: p.y, at, spec, seed: `${input.seed}:${shot.id}:b${k}`, scale: 0.55 + random() * 0.4, ...shape(spec) });
            if (tuning.launches) launchTo(p.x, p.y, at, `b${k}`);
        }
        bursts.sort((a, b) => a.at - b.at);
        return { bursts, launches };
    }

    const bounds = text?.bounds ?? { x: -region.w * width / 2, y: -region.h * height / 2, width: region.w * width, height: region.h * height };
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // 主烟花。
    const main = profile.burst;
    if (main) {
        const radius = main.radius * unit;
        const at = timing.enterAt;
        const key = `${input.seed}:${shot.id}:main`;
        const minY = height * 0.12 - region.cy * height;
        const maxX = width * 0.42;
        const points: Array<{ x: number; y: number; at: number }> = [];
        if (main.kind === 'mine') {
            // スターマイン 从画面底边往上喷。
            const sx = profile.burstAt === 'sides' ? [0.25, 0.75] : [0.3 + random() * 0.4];
            sx.forEach((x, k) => points.push({ x: x * width - region.cx * width, y: height * 0.94 - region.cy * height, at: at + k * 0.15 }));
        } else if (profile.burstAt === 'behind') {
            points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.15, y: centerY - radius * 0.15, at });
        } else if (profile.burstAt === 'above') {
            points.push({ x: centerX + (random() - 0.5) * bounds.width * 0.3, y: Math.max(minY, bounds.y - radius * 0.45), at });
        } else if (profile.burstAt === 'sides') {
            const dx = Math.min(maxX, bounds.width / 2 + radius * 0.35);
            points.push({ x: centerX - dx, y: Math.max(minY, centerY - radius * 0.3), at });
            points.push({ x: centerX + dx, y: Math.max(minY, centerY - radius * 0.3), at: at + 0.15 });
        } else {
            // sky：画面上方随机的高处（按镜头定格时的画面换算）。
            const settled = timing.enterAt + 0.6;
            const p = locate(width * (0.2 + random() * 0.6), height * (0.12 + random() * 0.22), settled);
            points.push({ x: p.x, y: p.y, at });
        }
        points.forEach((point, k) => {
            const x = Math.max(-region.cx * width + width * 0.06, Math.min(width * (1 - region.cx) - width * 0.06, point.x));
            bursts.push({ x, y: point.y, at: point.at, spec: main, seed: `${key}${k}`, scale: 1, ...shape(main) });
            if (withLaunch && main.kind !== 'mine') launchTo(x, point.y, point.at, `main${k}`);
        });
    }

    if (text) {
        const glyphs = text.anchors(timing.enterAt).map((anchor, k) => ({ anchor, k })).filter(({ anchor }) => !anchor.blank);
        // 被唱到的字各放一朵小花。
        const sung = profile.sungBurst;
        if (sung) {
            const candidates = glyphs.filter(({ anchor }) => anchor.sungAt >= timing.enterAt && anchor.sungAt < timing.exitAt);
            thin(candidates, MAX_SUNG_BURSTS).forEach(({ anchor, k }, n) => {
                const now = text.anchors(anchor.sungAt)[k] ?? anchor;
                const p = toShot(text.view, now.x, now.y);
                const colors = sung.colors.length > 0 ? sung.colors.map((_, j) => sung.colors[(j + n) % sung.colors.length]!) : [n];
                bursts.push({
                    x: p.x,
                    y: p.y - now.size * 0.1,
                    at: anchor.sungAt,
                    spec: { ...sung, colors },
                    seed: `${input.seed}:${shot.id}:sung${k}`,
                    scale: Math.max(0.6, Math.min(1.6, now.size / (unit * 0.1))),
                });
            });
        }
        // 碎成火花的退场：每个字心放一朵小火花。
        if (profile.text.exit === 'dissolve') {
            const chosen = thin(glyphs, MAX_DISSOLVE_BURSTS);
            const step = Math.min(0.05, (timing.exitDuration * 0.6) / Math.max(chosen.length, 1));
            chosen.forEach(({ k }, n) => {
                const at = timing.exitAt + n * step;
                const now = text.anchors(at)[k];
                if (!now) return;
                const p = toShot(text.view, now.x, now.y);
                bursts.push({ x: p.x, y: p.y, at, spec: DISSOLVE_SPARK, seed: `${input.seed}:${shot.id}:dissolve${k}`, scale: 1 });
            });
        }
    }

    bursts.sort((a, b) => a.at - b.at);
    return { bursts, launches };
};
