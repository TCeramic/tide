// src/kernel/runtime.ts
// 内核：唯一的 Pixi app。调度场景单元（按绝对时间，缓存 ±1）、施加段落转场、画背景 / 译文 /
// 片尾 / 画框 / 擦除色块、挂唯一的后处理链。renderAt(t) 是纯粹由 t 决定的一帧：预览的 ticker
// 与逐帧导出走同一条路径。
import type { Line, Theme } from '@/core/types';
import { sampleAudioFrame, type AudioAnalysis } from '@/core/audio/analysis';
import { withRandomStream } from '@/core/rng';
import { evaluateClip, type AssetClip, type AssetSlot, type ResolvedAssetClip } from '@/core/assets/clips';
import type { ResolvedBackgroundClip } from '@/core/assets/background';
import { BackgroundTrack } from './backgroundTrack';
import { buildClipEffect, EffectTextureCache, type ClipEffectLayers } from './assetEffects';
import { decompose, fromParams, invert, multiply, resolveFollow, type Affine, type CameraSample } from './cameraFollow';
import type { LumiProgram, PackId } from '@/compiler/types';
import { loadPixi } from '@/engine/shared/loadPixi';
import { destroyPixiDisplayTree, setPixiDisplayTreeVisibility } from '@/engine/shared/pixiDisplayResources';
import { createSonnetGlitchEffect, type SonnetGlitchEffect } from '@/packs/sonnet/sonnetGlitchFilter';
import { hashTemperaSeed } from '@/packs/tempera/temperaRandom';
import type { MotionValue } from '@/packs/_compat/motion';
import { getPack, getTransition, listPacks } from '@/packs/registry';
import type { CreditsView, KernelContext, KernelTunings, PackAdapter, SongMetadata, UnitView } from './adapters/types';
import {
    buildBackground,
    buildPostProcessChain,
    buildSubtitleLayer,
    drawWipe,
    type BackgroundLayer,
    type SubtitleLayer,
} from './layers';
import { IDLE_FRAME, resolveEnterDuration, resolveTransitionFrame, type KernelTransitionFrame } from './transitions';
import type { KernelTuning } from './tuning';
import { buildUnits, findUnitIndexAtTime, type GuestUnit, type SceneUnit } from './units';

type PixiModule = typeof import('pixi.js');
type Container = import('pixi.js').Container;

import type { KernelLayer } from './layerIds';
export { KERNEL_LAYERS, type KernelLayer } from './layerIds';

export interface KernelLook {
    /** 已经套上歌词字体设置的主题。 */
    theme: Theme;
    /** 歌词字号倍率，默认 1。 */
    lyricsFontScale?: number;
    /** 字幕用的主题（套上字幕字体）；不给则与歌词相同。 */
    subtitleTheme?: Theme;
    tunings: KernelTunings;
    metadata: SongMetadata;
    coverColors: string[];
    cover: Blob | null;
    layerImages: Map<string, Blob>;
}

export interface KernelOptions extends KernelLook {
    /** 逻辑画幅（排版坐标系）。 */
    width: number;
    height: number;
    /** 渲染倍率：画布像素 = 逻辑尺寸 × resolution。 */
    resolution: number;
    program: LumiProgram;
    /** 译文字幕取自这些行（编译前的歌词行）。 */
    lines: Line[];
    audio: AudioAnalysis | null;
    /** 预览：画布挂到这里；导出不传。 */
    mount?: HTMLElement;
    /** 预览：ticker 每帧读它；导出直接调 renderAt。 */
    clock?: MotionValue<number>;
    /** 导出：保留绘图缓冲，便于逐帧读取画布。 */
    preserveDrawingBuffer?: boolean;
    /** 背景视频：预览用 <video> 跟随时钟（realtime），导出逐帧精确解码（exact）。默认：有 mount 时 realtime。 */
    videoMode?: 'realtime' | 'exact';
    /** 分层导出：画布带透明通道（清屏为透明，最底层由背景层自己铺满）。 */
    transparent?: boolean;
    /** Tide integration: leave the host responsible for deterministic renderAt() calls. */
    manualRender?: boolean;
    /** Tide integration: omit the opaque background while keeping the canvas transparent. */
    omitBackground?: boolean;
}

interface GuestSlot {
    guest: GuestUnit;
    view: UnitView;
    /** 客画幅（逻辑像素）。 */
    width: number;
    height: number;
    visible: boolean;
}

interface UnitSlot {
    view: UnitView;
    guests: GuestSlot[];
    visible: boolean;
    blur: import('pixi.js').BlurFilter | null;
    glitch: SonnetGlitchEffect | null;
    attached: string;
}

const BLUR_ACTIVE = 0.01;

export class LumiKernel {
    private readonly adapters = new Map<PackId, PackAdapter>();
    private units: SceneUnit[] = [];
    private readonly slots = new Map<string, UnitSlot>();
    private context!: KernelContext;
    private world!: Container;
    private backgroundHolder!: Container;
    private sceneContainer!: Container;
    private subtitleHolder!: Container;
    private creditsHolder!: Container;
    private overlayHolder!: Container;
    private wipe!: import('pixi.js').Graphics;
    /** 素材层的三个层级。 */
    private assetHolders!: Record<AssetSlot, Container>;
    private assetClips: ResolvedAssetClip[] = [];
    /** 每个片段一个容器：效果层（在下）+ 原图精灵（在上）；摆放、跟随运镜、淡入淡出都作用在容器上。 */
    private assetSprites = new Map<string, { clip: ResolvedAssetClip; node: Container; sprite: import('pixi.js').Sprite; effect: ClipEffectLayers | null }>();
    private effectTextures!: EffectTextureCache;
    /** 素材 id → 纹理（以及解码它的那个文件，文件换了就重新解码）。 */
    private assetTextures = new Map<string, { blob: Blob; texture: import('pixi.js').Texture }>();
    private assetGeneration = 0;
    private backgroundTrack!: BackgroundTrack;
    private backgroundClips: ResolvedBackgroundClip[] = [];
    /** 分层导出：只画这些层（null = 全部）。 */
    private layerMask: Set<KernelLayer> | null = null;
    private postActive = true;
    private maskApplied = false;
    private effectHolder!: import('pixi.js').Graphics;
    private background: BackgroundLayer | null = null;
    private subtitles: SubtitleLayer | null = null;
    private credits: { pack: PackId; view: CreditsView } | null = null;
    private overlays = new Map<PackId, Container | null>();
    private postFilters: import('pixi.js').Filter[] = [];
    private coverTexture: import('pixi.js').Texture | null = null;
    private coverBlob: Blob | null = null;
    private look: KernelLook;
    private program: LumiProgram;
    private lines: Line[];
    private audio: AudioAnalysis | null;
    private destroyed = false;
    private playing = false;
    private lookGeneration = 0;
    private lastTime = 0;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly app: import('pixi.js').Application,
        private options: KernelOptions,
    ) {
        this.look = options;
        this.program = options.program;
        this.lines = options.lines;
        this.audio = options.audio;
        listPacks().forEach(pack => this.adapters.set(pack.id, pack.createAdapter()));
    }

    /** 包的适配器；包在内核创建之后才注册时按需创建（它的异步资源在下次 setLook 时准备）。 */
    private adapterFor(pack: PackId): PackAdapter {
        let adapter = this.adapters.get(pack);
        if (!adapter) {
            adapter = getPack(pack).createAdapter();
            this.adapters.set(pack, adapter);
        }
        return adapter;
    }

    static async create(options: KernelOptions): Promise<LumiKernel> {
        const pixi = await loadPixi();
        const app = new pixi.Application();
        await app.init({
            width: options.width,
            height: options.height,
            resolution: options.resolution,
            autoDensity: true,
            antialias: true,
            backgroundAlpha: options.transparent ? 0 : 1,
            background: options.theme.backgroundColor,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
            // tempera 的文字反色 filter 声明了 blendRequired；没有 back buffer 时整个 filter 栈会被跳过。
            useBackBuffer: true,
            preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        });
        const kernel = new LumiKernel(pixi, app, options);
        kernel.installStage();
        await kernel.applyLook(options, true);
        kernel.setProgram(options.program, options.lines);
        if (options.mount) {
            app.canvas.style.cssText = 'width:100%;height:100%;display:block';
            options.mount.appendChild(app.canvas);
        }
        if (!options.manualRender) app.ticker.add(kernel.tick);
        return kernel;
    }

    get canvas(): HTMLCanvasElement {
        return this.app.canvas;
    }

    get size() {
        return { width: this.options.width, height: this.options.height, resolution: this.options.resolution };
    }

    // -----------------------------------------------------------------------------------------
    // 舞台

    private installStage() {
        const { pixi } = this;
        this.effectTextures = new EffectTextureCache(pixi);
        this.world = new pixi.Container();
        this.backgroundHolder = new pixi.Container();
        this.sceneContainer = new pixi.Container();
        // 转场窗口里两个单元同屏，必须按时间顺序叠放。
        this.sceneContainer.sortableChildren = true;
        this.subtitleHolder = new pixi.Container();
        this.creditsHolder = new pixi.Container();
        this.overlayHolder = new pixi.Container();
        this.wipe = new pixi.Graphics();
        this.wipe.visible = false;
        this.assetHolders = { back: new pixi.Container(), mid: new pixi.Container(), front: new pixi.Container(), overlay: new pixi.Container() };
        this.backgroundTrack = new BackgroundTrack(pixi, this.options.videoMode ?? (this.options.mount ? 'realtime' : 'exact'), () => {
            if (!this.options.manualRender && !this.playing) this.renderAt(this.lastTime);
        });
        this.world.addChild(
            this.backgroundHolder,
            this.backgroundTrack.container,
            this.assetHolders.back,
            this.sceneContainer,
            // 包没有插入层时，「场景之上、歌词之下」的素材退到这里（整个场景之上）。
            this.assetHolders.mid,
            this.assetHolders.front,
            this.subtitleHolder,
            this.creditsHolder,
            this.overlayHolder,
            this.wipe,
            this.assetHolders.overlay,
        );
        this.app.stage.addChild(this.world);
        this.effectHolder = new pixi.Graphics();
        this.effectHolder.visible = false;
        this.app.stage.addChild(this.effectHolder);
    }

    private buildContext(): KernelContext {
        const { width, height, resolution } = this.options;
        return {
            pixi: this.pixi,
            width,
            height,
            renderResolution: resolution,
            programSeed: this.program.seed,
            theme: this.look.theme,
            lyricsFontScale: this.look.lyricsFontScale ?? 1,
            tunings: this.look.tunings,
            metadata: this.look.metadata,
            coverColors: this.look.coverColors,
            host: { clientWidth: width, clientHeight: height } as HTMLDivElement,
            images: this.look.layerImages,
            audioAt: time => sampleAudioFrame(this.audio, time),
        };
    }

    /**
     * 换主题 / tuning / 封面 / 图片 / 歌曲信息：所有已构建的场景作废。
     * 包的异步资源（图标、图片纹理）准备好之后才重建，避免先画一帧缺图的。
     */
    async setLook(look: KernelLook) {
        await this.applyLook(look, false);
    }

    private async applyLook(look: KernelLook, initial: boolean) {
        const generation = ++this.lookGeneration;
        this.look = look;
        this.context = this.buildContext();
        const context = this.context;
        await Promise.all([...this.adapters.values()].map(adapter => adapter.prepare(context)));
        if (look.cover !== this.coverBlob) {
            this.coverBlob = look.cover;
            const next = look.cover ? await this.decodeCover(look.cover) : null;
            this.coverTexture?.destroy(true);
            this.coverTexture = next;
        }
        if (this.destroyed || generation !== this.lookGeneration) return;
        // 分层导出要透明清屏。pixi 清屏不按 alpha 预乘颜色，清成 (主题色, 0) 会把主题色残留在 RGB 里，
        // 叠加到每个半透明像素上，所以透明时清成纯黑；设颜色会把透明度重置为 1，之后再设回 0。
        this.app.renderer.background.color = this.options.transparent ? 0x000000 : look.theme.backgroundColor;
        if (this.options.transparent) this.app.renderer.background.alpha = 0;
        this.clearUnits();
        this.rebuildStatic();
        // 素材库的文件、封面可能换了：素材精灵与背景片段跟着重建。
        await Promise.all([this.syncAssetSprites(), this.syncBackground()]);
        if (this.destroyed || generation !== this.lookGeneration) return;
        if (!initial && !this.options.manualRender) this.renderAt(this.lastTime);
    }

    private async decodeCover(blob: Blob) {
        try {
            return this.pixi.Texture.from(await createImageBitmap(blob));
        } catch {
            return null;
        }
    }

    /** 背景、译文、画框、片尾、后处理：随 look 或画幅变化重建。 */
    private rebuildStatic() {
        const { pixi } = this;
        const { width, height, resolution } = this.options;
        const { theme, tunings } = this.look;
        this.background?.destroy();
        this.background = this.options.omitBackground
            ? null
            : buildBackground(pixi, width, height, theme, tunings.kernel.background, this.coverTexture, resolution);
        if (this.background) this.backgroundHolder.addChild(this.background.container);

        this.subtitles?.destroy();
        this.subtitles = buildSubtitleLayer(pixi, width, height, this.look.subtitleTheme ?? theme, tunings.kernel.subtitles, this.lines, resolution);
        this.subtitleHolder.addChild(this.subtitles.container);

        // 画框是包自建 context 的 Graphics，逐节点销毁才会连 GPU 批数据一起放掉（见 destroyPixiDisplayTree）。
        this.overlays.forEach(overlay => { if (overlay) destroyPixiDisplayTree(overlay); });
        this.overlays.clear();
        this.disposeCredits();

        this.world.filters = null;
        this.postFilters.forEach(filter => filter.destroy());
        this.postFilters = buildPostProcessChain(pixi, tunings.kernel.postProcess, hashTemperaSeed(this.program.seed));
        if (this.postFilters.length > 0) {
            this.world.filterArea = new pixi.Rectangle(0, 0, width, height);
            if (this.postActive) this.world.filters = this.postFilters;
        }
    }

    private disposeCredits() {
        if (!this.credits) return;
        this.creditsHolder.removeChildren();
        this.credits.view.destroy();
        this.credits = null;
    }

    private overlayFor(pack: PackId): Container | null {
        if (!this.overlays.has(pack)) {
            const overlay = this.adapterFor(pack).buildOverlay(this.context);
            if (overlay) {
                overlay.visible = false;
                this.overlayHolder.addChild(overlay);
            }
            this.overlays.set(pack, overlay);
        }
        return this.overlays.get(pack) ?? null;
    }

    private creditsFor(pack: PackId): CreditsView | null {
        if (this.credits?.pack === pack) return this.credits.view;
        this.disposeCredits();
        const view = this.adapterFor(pack).buildCredits(this.context);
        if (!view) return null;
        this.credits = { pack, view };
        this.creditsHolder.addChild(view.container);
        return view;
    }

    // -----------------------------------------------------------------------------------------
    // 分层

    /** 只画 layers 里的层（null 恢复全部）。在下一次 renderAt 时生效。 */
    setLayerMask(layers: Iterable<KernelLayer> | null) {
        this.layerMask = layers ? new Set(layers) : null;
    }

    /** 后处理链是否作用在这一遍上（分层导出时只加在选定的那一组上）。 */
    setPostProcessActive(active: boolean) {
        this.postActive = active;
        this.world.filters = active && this.postFilters.length > 0 ? this.postFilters : null;
    }

    private applyLayerMask() {
        const has = (layer: KernelLayer) => !this.layerMask || this.layerMask.has(layer);
        this.backgroundHolder.renderable = has('background');
        this.backgroundTrack.container.renderable = has('background');
        this.assetHolders.back.renderable = has('assetsBack');
        this.assetHolders.mid.renderable = has('assetsMid');
        this.assetHolders.front.renderable = has('assetsFront');
        this.assetHolders.overlay.renderable = has('assetsTop');
        this.subtitleHolder.renderable = has('subtitles');
        this.creditsHolder.renderable = has('overlay');
        this.overlayHolder.renderable = has('overlay');
        this.wipe.renderable = has('graphics');
        const graphics = has('graphics');
        const text = has('text');
        const mid = has('assetsMid');
        this.slots.forEach(slot => {
            const apply = (view: UnitView) => {
                if (view.setLayerVisibility) {
                    view.container.renderable = true;
                    view.setLayerVisibility({ graphics, text, mid });
                } else {
                    view.container.renderable = graphics || text || mid;
                }
            };
            apply(slot.view);
            slot.guests.forEach(guest => apply(guest.view));
        });
    }

    /**
     * 渲染到画布。透明模式（分层导出）下先把画布清成透明：Pixi 用 back buffer 时，最后一步是把 back buffer
     * 以普通混合画到画布上、不清屏；导出又保留了绘图缓冲，于是这一遍会叠在上一遍（不透明的那组）之上。
     */
    private presentFrame() {
        if (this.options.transparent) {
            const gl = (this.app.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
            if (gl) {
                const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
                const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
                const scissor = gl.isEnabled(gl.SCISSOR_TEST);
                const colorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.disable(gl.SCISSOR_TEST);
                gl.colorMask(true, true, true, true);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
                gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
                if (scissor) gl.enable(gl.SCISSOR_TEST);
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            }
        }
        this.app.renderer.render(this.app.stage);
    }

    /**
     * 分层导出里单独成层的后处理效果：只画这个效果本身。
     * vignette：与黑色按比例混合（与合成里的暗角完全一致），输出黑色 + 透明度，普通混合叠回去；
     * grain：画在 50% 灰上，线性光 50% 叠回去 = 与合成里的颗粒相同的加减。
     */
    renderEffect(effect: 'vignette' | 'grain', amount: number, time: number) {
        if (this.destroyed) return;
        const { width, height } = this.options;
        // 强度由调用方给：分层导出时这个效果已从后处理链里去掉（look 里是 0）。
        const only = { ...this.look.tunings.kernel.postProcess, enabled: true, grain: 0, contrast: 0, rgbShift: 0, halftone: 0, vignette: 0, lensDistortion: 0, lensDispersion: 0 };
        const filters = buildPostProcessChain(this.pixi, { ...only, [effect]: amount }, hashTemperaSeed(this.program.seed));
        this.updateFrame(time, false);
        this.effectHolder.clear();
        if (effect === 'vignette') this.effectHolder.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.002 });
        else this.effectHolder.rect(0, 0, width, height).fill({ color: 0x808080, alpha: 1 });
        this.effectHolder.filterArea = new this.pixi.Rectangle(0, 0, width, height);
        this.effectHolder.filters = filters;
        this.world.visible = false;
        this.effectHolder.visible = true;
        this.presentFrame();
        this.effectHolder.visible = false;
        this.effectHolder.filters = null;
        filters.forEach(filter => filter.destroy());
        this.world.visible = true;
    }

    // -----------------------------------------------------------------------------------------
    // 背景轨

    /** 设置背景片段（时间已按当前编排解析好）。图片解码、视频准备好之后才返回。 */
    async setBackgroundClips(clips: ResolvedBackgroundClip[]) {
        this.backgroundClips = clips;
        await this.syncBackground();
        if (!this.destroyed) this.renderAt(this.lastTime);
    }

    private syncBackground() {
        const { width, height, resolution } = this.options;
        return this.backgroundTrack.setClips(this.backgroundClips, {
            width,
            height,
            theme: this.look.theme,
            cover: this.coverTexture,
            images: this.look.layerImages,
            renderResolution: resolution,
        });
    }

    /** 导出：渲染 time 这一帧之前，先把要用的视频帧解码好。 */
    async prepareAt(time: number) {
        await this.backgroundTrack.prepareAt(time);
    }

    // -----------------------------------------------------------------------------------------
    // 素材层

    /** 设置素材片段（时间已按当前编排解析好）。纹理解码完成、精灵建好之后才返回。 */
    async setAssetClips(clips: ResolvedAssetClip[]) {
        this.assetClips = clips;
        await this.syncAssetSprites();
        if (!this.destroyed) this.renderAt(this.lastTime);
    }

    private async syncAssetSprites() {
        const generation = ++this.assetGeneration;
        const images = this.look.layerImages;
        const needed = new Set(this.assetClips.map(clip => clip.assetId));
        // 丢掉不再需要或文件已换的纹理。
        this.assetTextures.forEach((entry, id) => {
            if (!needed.has(id) || images.get(id) !== entry.blob) {
                this.assetSprites.forEach(item => {
                    if (item.clip.assetId !== id) return;
                    item.sprite.texture = this.pixi.Texture.EMPTY;
                    item.effect?.sprites.forEach(effect => { effect.texture = this.pixi.Texture.EMPTY; });
                });
                entry.texture.destroy(true);
                this.effectTextures.dropAsset(id);
                this.assetTextures.delete(id);
            }
        });
        await Promise.all([...needed].map(async id => {
            const blob = images.get(id);
            if (!blob || this.assetTextures.has(id)) return;
            try {
                const texture = this.pixi.Texture.from(await createImageBitmap(blob));
                if (generation !== this.assetGeneration || this.destroyed || this.assetTextures.has(id)) {
                    texture.destroy(true);
                    return;
                }
                this.assetTextures.set(id, { blob, texture });
            } catch {
                // 解码失败的素材不画。
            }
        }));
        if (generation !== this.assetGeneration || this.destroyed) return;
        // 只销毁精灵与容器；纹理归 assetTextures 与效果缓存管。
        this.assetSprites.forEach(item => item.node.destroy({ children: true }));
        this.assetSprites.clear();
        this.effectTextures.begin();
        this.assetClips.forEach(clip => {
            const entry = this.assetTextures.get(clip.assetId);
            if (!entry) return;
            const node = new this.pixi.Container();
            node.visible = false;
            const image = entry.texture.source.resource as CanvasImageSource & { width: number; height: number };
            const effect = buildClipEffect(this.pixi, this.effectTextures, clip, image, node);
            const sprite = new this.pixi.Sprite(entry.texture);
            sprite.anchor.set(0.5);
            sprite.blendMode = clip.blend;
            node.addChild(sprite);
            this.assetHolders[clip.slot].addChild(node);
            this.assetSprites.set(clip.id, { clip, node, sprite, effect });
        });
        this.effectTextures.end();
    }

    /** time 所在单元的运镜（没有单元、单元还没构建或包不提供时为 null）。 */
    private cameraAt = (time: number): CameraSample | null => {
        if (this.units.length === 0) return null;
        const unit = this.units[findUnitIndexAtTime(this.units, time)];
        return this.slots.get(unit.key)?.view.camera?.(time) ?? null;
    };

    /** 素材片段在 time 时刻要套的跟随运镜变换（编辑器的画布手柄用它对齐）。 */
    clipFollowAt(clip: Pick<AssetClip, 'follow' | 'followAmount'>, time: number): Affine {
        return resolveFollow(clip.follow, clip.followAmount, time, this.cameraAt, this.options.width, this.options.height);
    }

    /**
     * 「场景之上、歌词之下」：把素材放进这一刻所在镜头的插入层，返回它在插入层里的变换
     * （= 插入层全局变换的逆 × 屏幕上的变换，所以屏幕上的位置不受镜头、转场影响）。
     * 包没有插入层、或者场景正在转场时留在内核的 mid 容器里（整个场景之上）。
     */
    private placeInMidLayer(sprite: Container, screen: Affine, time: number): Affine {
        const unit = this.units.length > 0 ? this.units[findUnitIndexAtTime(this.units, time)] : null;
        let target = unit ? this.slots.get(unit.key)?.view.midLayer?.(time) ?? null : null;
        // 场景正在转场（整体淡化、模糊、故障……）或镜头之间交接时，插入层会跟着变淡 / 变糊，素材就会闪。
        // 这一帧先回到场景之上（这时歌词本身也在淡出，看不出层级的差别）。
        for (let node: import('pixi.js').Container | null = target; node && node !== this.world; node = node.parent) {
            if (!node.visible || node.alpha < 0.999 || (node.filters && (node.filters as unknown[]).length > 0)) {
                target = null;
                break;
            }
        }
        const parent = target ?? this.assetHolders.mid;
        if (sprite.parent !== parent) parent.addChild(sprite);
        if (!target) return screen;
        const global = target.getGlobalTransform(undefined, false);
        const inverse = invert({ a: global.a, b: global.b, c: global.c, d: global.d, tx: global.tx, ty: global.ty });
        return multiply(inverse, screen);
    }

    private updateAssets(time: number) {
        const { width, height } = this.options;
        this.assetSprites.forEach(({ clip, node, sprite, effect }) => {
            const frame = evaluateClip(clip, time);
            node.visible = frame.visible && clip.opacity > 0;
            if (!node.visible) return;
            effect?.update(clip, time);
            const follow = this.clipFollowAt(clip, time);
            // 屏幕上的变换（画面坐标）：位置、等比缩放、角度。
            let screen = multiply(follow, fromParams({
                x: (clip.x + frame.dx) * width,
                y: (clip.y + frame.dy) * height,
                pivotX: 0,
                pivotY: 0,
                scale: (clip.scale * height) / Math.max(1, sprite.texture.height) * frame.scale,
                rotation: clip.rotation + frame.rotation,
            }));
            if (clip.slot === 'mid') screen = this.placeInMidLayer(node, screen, time);
            const parts = decompose(screen, 0, 0);
            node.position.set(screen.tx, screen.ty);
            node.scale.set(parts.scale * (clip.flipX ? -1 : 1), parts.scale);
            node.rotation = parts.rotation;
            node.alpha = clip.opacity * frame.alpha;
        });
    }

    // -----------------------------------------------------------------------------------------
    // 程序与单元

    setProgram(program: LumiProgram, lines: Line[], renderAtTime = this.lastTime) {
        const seedChanged = program.seed !== this.program.seed;
        this.program = program;
        const linesChanged = lines !== this.lines;
        this.lines = lines;
        this.units = buildUnits(program);
        if (seedChanged) {
            // 场景里的随机都挂在 programSeed 上，换 seed 就得全部重建。
            this.context = this.buildContext();
            this.clearUnits();
            this.rebuildStatic();
        } else {
            // 重编后仍然存在的单元（同一段、同一组 shot）保留已构建的场景。
            const alive = new Set(this.units.map(unit => unit.key));
            this.slots.forEach((slot, key) => {
                if (!alive.has(key)) this.destroySlot(key);
            });
            if (linesChanged) this.rebuildStatic();
        }
        if (!this.options.manualRender) this.renderAt(renderAtTime);
    }

    setAudio(audio: AudioAnalysis | null) {
        this.audio = audio;
        this.context = this.buildContext();
        this.clearUnits();
        if (!this.options.manualRender) this.renderAt(this.lastTime);
    }

    private clearUnits() {
        [...this.slots.keys()].forEach(key => this.destroySlot(key));
    }

    private destroySlot(key: string) {
        const slot = this.slots.get(key);
        if (!slot) return;
        // 放在这个单元插入层里的素材先收回来，免得跟着单元一起销毁。
        this.assetSprites.forEach(({ node: item }) => {
            for (let node = item.parent; node; node = node.parent) {
                if (node !== slot.view.container) continue;
                item.visible = false;
                this.assetHolders.mid.addChild(item);
                break;
            }
        });
        // 客单元挂在宿主的容器里：先摘下来单独销毁，宿主销毁时不会连带。
        slot.guests.forEach(guest => {
            guest.view.container.removeFromParent();
            guest.view.destroy();
        });
        slot.view.container.filters = null;
        slot.blur?.destroy();
        slot.glitch?.filter.destroy();
        slot.view.destroy();
        this.slots.delete(key);
    }

    private ensureSlot(index: number): UnitSlot | null {
        const unit = this.units[index];
        if (!unit) return null;
        const existing = this.slots.get(unit.key);
        if (existing) return existing;
        // 每个单元一个随机流：场景内容只取决于 seed 与单元所在的位置（原生段落 id），与构建顺序
        // 无关，也不会因为改了同段另一个镜头的风格而变化。
        const view = withRandomStream(`${this.program.seed}:${unit.native.id}`, () => this.adapterFor(unit.pack).buildUnit(this.context, unit));
        view.container.zIndex = index;
        view.container.visible = false;
        this.sceneContainer.addChild(view.container);
        const guests = unit.guests.map(guest => this.buildGuest(guest, view));
        const slot: UnitSlot = { view, guests, visible: false, blur: null, glitch: null, attached: '' };
        this.slots.set(unit.key, slot);
        return slot;
    }

    /**
     * 跨包借排版：客包用只画字的 tuning、按对齐后的客画幅构建单镜头场景，挂在宿主单元的容器里，
     * 随宿主一起受段落转场与 filter 影响。客包的文字区域中心对齐宿主的文字区域中心。
     */
    private buildGuest(guest: GuestUnit, host: UnitView): GuestSlot {
        const { width, height } = this.options;
        const { hostRegion, guestRegion } = guest;
        const guestWidth = Math.max(64, Math.round((hostRegion.w * width) / Math.max(0.05, guestRegion.w)));
        const guestHeight = Math.max(64, Math.round((hostRegion.h * height) / Math.max(0.05, guestRegion.h)));
        const pack = getPack(guest.unit.pack);
        const tunings = this.context.tunings;
        const packTuning = pack.tuning.normalize(tunings.packs[pack.id]);
        const context: KernelContext = {
            ...this.context,
            width: guestWidth,
            height: guestHeight,
            host: { clientWidth: guestWidth, clientHeight: guestHeight } as HTMLDivElement,
            tunings: { ...tunings, packs: { ...tunings.packs, [pack.id]: pack.textOnlyTuning ? pack.textOnlyTuning(packTuning) : packTuning } },
        };
        const view = withRandomStream(`${this.program.seed}:${guest.unit.native.id}`, () => this.adapterFor(pack.id).buildUnit(context, guest.unit));
        const container = view.container;
        container.pivot.set(guestRegion.cx * guestWidth, guestRegion.cy * guestHeight);
        container.position.set(hostRegion.cx * width, hostRegion.cy * height);
        container.rotation = hostRegion.rotation - guestRegion.rotation;
        container.visible = false;
        host.container.addChild(container);
        return { guest, view, width: guestWidth, height: guestHeight, visible: false };
    }

    private updateGuests(slot: UnitSlot, time: number) {
        slot.guests.forEach(guest => {
            const { unit } = guest.guest;
            const active = time >= unit.startTime && time < unit.endTime;
            if (!active) {
                if (guest.visible) {
                    setPixiDisplayTreeVisibility(guest.view.container, false);
                    guest.view.hide();
                    guest.visible = false;
                }
                return;
            }
            guest.view.container.visible = true;
            guest.visible = true;
            guest.view.update({ time, width: guest.width, height: guest.height }, false);
        });
    }

    private pruneSlots(activeIndex: number) {
        this.slots.forEach((slot, key) => {
            const index = this.units.findIndex(unit => unit.key === key);
            if (index >= 0 && Math.abs(index - activeIndex) <= 1) return;
            this.destroySlot(key);
        });
    }

    /** 只在真正模糊 / 故障时把 filter 挂上去，绝不停放 disabled 的 filter（见 tempera 的反色约束）。 */
    private applyFilters(slot: UnitSlot, blur: number, glitch: number, glitchSeed: number) {
        const wantBlur = blur > BLUR_ACTIVE;
        const wantGlitch = glitch > 0.01;
        if (wantBlur) {
            slot.blur ??= Object.assign(new this.pixi.BlurFilter({
                strength: 0,
                quality: 1,
                kernelSize: 5,
                resolution: this.options.resolution * 0.5,
            }), { repeatEdgePixels: true });
            slot.blur.strength = blur;
        }
        if (wantGlitch) {
            slot.glitch ??= createSonnetGlitchEffect(this.pixi);
            slot.glitch.update(glitch, glitchSeed);
            slot.glitch.filter.enabled = true;
        }
        const signature = `${wantBlur ? 'b' : ''}${wantGlitch ? 'g' : ''}`;
        if (signature === slot.attached) return;
        slot.attached = signature;
        const filters: import('pixi.js').Filter[] = [];
        if (wantBlur && slot.blur) filters.push(slot.blur);
        if (wantGlitch && slot.glitch) filters.push(slot.glitch.filter);
        slot.view.container.filters = filters;
    }

    // -----------------------------------------------------------------------------------------
    // 一帧

    /**
     * @param prebuild 预览时顺便为下一段预构建一个场景（每帧最多一个）；导出时不做，
     *                 需要的场景在需要的那一帧同步构建。
     */
    private updateFrame(time: number, prebuild: boolean) {
        this.lastTime = time;
        const { width, height } = this.options;
        const kernelTuning = this.look.tunings.kernel;
        const transitionsEnabled = kernelTuning.enableTransitions;
        this.subtitles?.update(time);
        this.backgroundTrack.update(time, this.playing);
        if (this.units.length === 0) {
            this.slots.forEach(slot => { slot.view.container.visible = false; });
            this.overlays.forEach(overlay => { if (overlay) overlay.visible = false; });
            this.creditsHolder.visible = false;
            drawWipe(this.pixi, this.wipe, 0, 0, width, height, '#000');
            this.updateAssets(time);
            return;
        }

        const activeIndex = findUnitIndexAtTime(this.units, time);
        const active = this.units[activeIndex];
        let built = false;
        if (!this.slots.has(active.key)) built = true;
        this.ensureSlot(activeIndex);

        const outgoing = active.transitionOut;
        const outgoingDef = outgoing ? getTransition(outgoing.id) : undefined;
        const preRoll = transitionsEnabled
            && outgoing !== null
            && outgoingDef?.preRoll === true
            && time >= outgoing.startTime
            && activeIndex + 1 < this.units.length;
        if (preRoll) {
            if (!this.slots.has(this.units[activeIndex + 1].key)) built = true;
            this.ensureSlot(activeIndex + 1);
        }
        if (prebuild && !built) {
            if (activeIndex + 1 < this.units.length && !this.slots.has(this.units[activeIndex + 1].key)) this.ensureSlot(activeIndex + 1);
            else if (activeIndex > 0 && !this.slots.has(this.units[activeIndex - 1].key)) this.ensureSlot(activeIndex - 1);
        }
        this.pruneSlots(activeIndex);

        const finalUnit = this.units[this.units.length - 1];
        const credits = this.creditsFor(finalUnit.pack);
        const creditsFrame = credits?.resolveFrame(time, finalUnit.endTime) ?? null;
        let wipeDrawn = false;

        this.units.forEach((unit, index) => {
            const slot = this.slots.get(unit.key);
            if (!slot) return;
            const isActive = index === activeIndex;
            const isIncoming = preRoll && index === activeIndex + 1;
            const visible = isActive || isIncoming;
            if (!visible) {
                if (slot.visible) {
                    setPixiDisplayTreeVisibility(slot.view.container, false);
                    slot.view.hide();
                    slot.guests.forEach(guest => {
                        if (!guest.visible) return;
                        guest.view.container.visible = false;
                        guest.view.hide();
                        guest.visible = false;
                    });
                    slot.visible = false;
                }
                return;
            }
            if (!slot.visible) {
                slot.view.container.visible = true;
                slot.visible = true;
            }

            const previous = index > 0 ? this.units[index - 1].transitionOut : null;
            const previousDef = previous ? getTransition(previous.id) : undefined;
            let frame: KernelTransitionFrame = IDLE_FRAME;
            if (transitionsEnabled) {
                if (isIncoming && outgoing) {
                    // 预卷：下一段在转场窗口里沿自己的 flow 进入。
                    frame = resolveTransitionFrame(outgoing.id, 'enter',
                        (time - outgoing.startTime) / Math.max(0.001, outgoing.endTime - outgoing.startTime),
                        { transitionSeed: slot.view.transitionSeed, flowAngle: slot.view.enterFlowAngle });
                } else if (previous && previousDef && !previousDef.preRoll) {
                    const enterDuration = resolveEnterDuration(previousDef, previous.startTime, previous.endTime);
                    if (time >= unit.startTime && time <= unit.startTime + enterDuration) {
                        frame = resolveTransitionFrame(previous.id, 'enter', (time - unit.startTime) / Math.max(enterDuration, 0.001), {
                            transitionSeed: slot.view.transitionSeed,
                            flowAngle: slot.view.enterFlowAngle,
                        });
                    }
                }
                if (frame === IDLE_FRAME && unit.transitionOut && time >= unit.transitionOut.startTime) {
                    const out = unit.transitionOut;
                    frame = resolveTransitionFrame(out.id, 'exit',
                        (time - out.startTime) / Math.max(out.endTime - out.startTime, 0.001),
                        { transitionSeed: slot.view.transitionSeed, flowAngle: slot.view.exitFlowAngle });
                }
            }
            const shotFrame = slot.view.update({ time, width, height }, transitionsEnabled);
            if (shotFrame) frame = shotFrame;
            if (slot.guests.length > 0) this.updateGuests(slot, time);

            const isFinal = index === this.units.length - 1;
            const lyricAlpha = isFinal && creditsFrame ? creditsFrame.lyricAlpha : 1;
            const outroBlur = isFinal && creditsFrame?.active ? creditsFrame.lyricBlur : 0;
            const container = slot.view.container;
            container.alpha = frame.alpha * lyricAlpha;
            container.pivot.set(width / 2, height / 2);
            container.position.set(width / 2 + frame.x * width, height / 2 + frame.y * height);
            container.scale.set(frame.scale);
            container.rotation = frame.rotation;
            this.applyFilters(slot, Math.max(frame.blur, outroBlur), frame.glitch, frame.glitchSeed);
            if (frame.wipe > 0.001 && frame.wipe < 1.999) {
                drawWipe(this.pixi, this.wipe, frame.wipe, frame.wipeAngle, width, height, slot.view.wipeColor);
                wipeDrawn = true;
            }
        });
        if (!wipeDrawn) drawWipe(this.pixi, this.wipe, 0, 0, width, height, '#000');

        this.overlays.forEach((overlay, pack) => {
            if (overlay) overlay.visible = pack === active.pack;
        });
        this.overlayFor(active.pack);
        const activeOverlay = this.overlays.get(active.pack);
        if (activeOverlay) activeOverlay.visible = true;

        if (credits && creditsFrame) {
            this.creditsHolder.visible = creditsFrame.active;
            this.creditsHolder.alpha = creditsFrame.posterAlpha;
            if (credits.centered) {
                this.creditsHolder.pivot.set(0, 0);
                this.creditsHolder.position.set(width / 2, height / 2 + creditsFrame.posterOffsetY * height);
            } else {
                this.creditsHolder.pivot.set(width / 2, height / 2);
                this.creditsHolder.position.set(width / 2, height / 2 + creditsFrame.posterOffsetY * height);
            }
            this.creditsHolder.scale.set(creditsFrame.posterScale);
            if (creditsFrame.active) credits.update(time - finalUnit.endTime);
        } else {
            this.creditsHolder.visible = false;
        }
        // 素材放在场景之后更新：跟随运镜要用到这一帧所在的单元（已经确保构建好了）。
        this.updateAssets(time);
    }

    /** 渲染时刻 time 的一帧（同步）。 */
    renderAt(time: number) {
        if (this.destroyed) return;
        this.updateFrame(time, false);
        // 设过遮罩之后要再套一次（null 时把所有层恢复成可见）。
        if (this.layerMask || this.maskApplied) {
            this.applyLayerMask();
            this.maskApplied = this.layerMask !== null;
        }
        this.presentFrame();
    }

    /** Captures the already-current frame on demand for the host's transition snapshot. */
    async captureFrame(): Promise<string | null> {
        if (this.destroyed) return null;
        try {
            return await this.app.renderer.extract.base64({ target: this.app.stage });
        } catch {
            return null;
        }
    }

    // -----------------------------------------------------------------------------------------
    // 预览

    private readonly tick = () => {
        if (this.destroyed || !this.options.clock) return;
        this.updateFrame(this.options.clock.get(), true);
        this.app.renderer.render(this.app.stage);
    };

    setPlaying(playing: boolean) {
        if (this.destroyed || this.playing === playing) return;
        this.playing = playing;
        if (playing) this.app.start();
        else this.app.stop();
    }

    /** 丢掉所有已构建的场景并在当前时刻重建（测试用：让场景的构建顺序可控）。 */
    rebuild() {
        this.clearUnits();
        this.refresh();
    }

    /** 暂停时的刷新（seek、编辑后）。 */
    refresh() {
        if (this.destroyed) return;
        this.renderAt(this.options.clock?.get() ?? this.lastTime);
    }

    resize(width: number, height: number, resolution: number) {
        if (this.destroyed) return;
        if (width === this.options.width && height === this.options.height && resolution === this.options.resolution) return;
        this.options = { ...this.options, width, height, resolution };
        this.app.renderer.resize(width, height, resolution);
        this.context = this.buildContext();
        this.clearUnits();
        this.rebuildStatic();
        const backgroundSync = this.syncBackground();
        if (!this.options.manualRender) {
            void backgroundSync.then(() => this.refresh());
            this.refresh();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.app.ticker.remove(this.tick);
        this.app.stop();
        this.clearUnits();
        this.disposeCredits();
        this.overlays.forEach(overlay => { if (overlay) destroyPixiDisplayTree(overlay); });
        this.overlays.clear();
        this.subtitles?.destroy();
        this.background?.destroy();
        this.world.filters = null;
        this.postFilters.forEach(filter => filter.destroy());
        this.adapters.forEach(adapter => adapter.dispose());
        this.assetSprites.forEach(item => item.node.destroy({ children: true }));
        this.assetTextures.forEach(entry => entry.texture.destroy(true));
        this.effectTextures.destroy();
        this.backgroundTrack.destroy();
        this.coverTexture?.destroy(true);
        this.app.destroy({ removeView: true }, { children: true, texture: true });
    }
}
