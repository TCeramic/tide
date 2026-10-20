// src/kernel/backgroundTrack.ts
// 背景轨（叠在默认背景之上）：每个片段一个容器——画面（纯色 / 渐变 / 封面 / 图片 / 视频）、压暗层、
// 模糊（只在真的模糊时挂 filter）。每帧按 evaluateBackground 设可见、透明度、推近；视频片段每帧更新纹理。
import type { Theme } from '@/core/types';
import { backgroundAssetId, evaluateBackground, type ResolvedBackgroundClip } from '@/core/assets/background';
import { createExactVideoSource, createRealtimeVideoSource, type KernelVideoSource } from './videoSource';
import { destroyPixiDisplayTree } from '@/engine/shared/pixiDisplayResources';

type PixiModule = typeof import('pixi.js');
type Container = import('pixi.js').Container;
type Texture = import('pixi.js').Texture;

export interface BackgroundTrackLook {
    width: number;
    height: number;
    theme: Theme;
    cover: Texture | null;
    images: Map<string, Blob>;
    renderResolution: number;
}

interface Item {
    clip: ResolvedBackgroundClip;
    container: Container;
    sprite: import('pixi.js').Sprite | null;
    video: KernelVideoSource | null;
    /** 本片段自己创建、需要销毁的纹理。 */
    ownTexture: Texture | null;
}

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

export class BackgroundTrack {
    readonly container: Container;
    private items: Item[] = [];
    /** 图片纹理按素材缓存（同一张图可以用在多个片段上）；视频源按片段各自一个（时间不同）。 */
    private imageTextures = new Map<string, { blob: Blob; texture: Texture }>();
    private generation = 0;
    private destroyed = false;

    constructor(
        private readonly pixi: PixiModule,
        private readonly mode: 'realtime' | 'exact',
        /** 预览里暂停时视频定位完成：请内核重画当前帧。 */
        private readonly onFrame: () => void,
    ) {
        this.container = new pixi.Container();
    }

    /** 重建全部片段（片段或观感变了）。图片解码、视频准备好之后才返回。 */
    async setClips(clips: ResolvedBackgroundClip[], look: BackgroundTrackLook) {
        const generation = ++this.generation;
        const neededImages = new Set(clips.filter(clip => clip.source.type === 'image').map(clip => backgroundAssetId(clip.source)!));
        this.imageTextures.forEach((entry, id) => {
            if (!neededImages.has(id) || look.images.get(id) !== entry.blob) {
                this.items.forEach(item => { if (item.sprite?.texture === entry.texture) item.sprite.texture = this.pixi.Texture.EMPTY; });
                entry.texture.destroy(true);
                this.imageTextures.delete(id);
            }
        });
        await Promise.all([...neededImages].map(async id => {
            const blob = look.images.get(id);
            if (!blob || this.imageTextures.has(id)) return;
            try {
                const texture = this.pixi.Texture.from(await createImageBitmap(blob));
                if (generation !== this.generation || this.destroyed) {
                    texture.destroy(true);
                    return;
                }
                this.imageTextures.set(id, { blob, texture });
            } catch {
                // 解码失败的图片不画。
            }
        }));
        if (generation !== this.generation || this.destroyed) return;
        const videos = clips.filter(clip => clip.source.type === 'video').map(clip => {
            const blob = look.images.get(backgroundAssetId(clip.source)!);
            if (!blob) return null;
            return this.mode === 'exact' ? createExactVideoSource(blob) : createRealtimeVideoSource(blob, this.onFrame);
        });
        await Promise.all(videos.map(video => video?.ready));
        if (generation !== this.generation || this.destroyed) {
            videos.forEach(video => video?.destroy());
            return;
        }
        this.clearItems();
        let videoIndex = 0;
        clips.forEach(clip => {
            const video = clip.source.type === 'video' ? videos[videoIndex++] ?? null : null;
            this.items.push(this.buildItem(clip, look, video));
        });
    }

    private buildItem(clip: ResolvedBackgroundClip, look: BackgroundTrackLook, video: KernelVideoSource | null): Item {
        const { pixi } = this;
        const { width, height } = look;
        const container = new pixi.Container();
        container.pivot.set(width / 2, height / 2);
        container.position.set(width / 2, height / 2);
        container.visible = false;
        let sprite: import('pixi.js').Sprite | null = null;
        let ownTexture: Texture | null = null;
        const source = clip.source;
        if (source.type === 'theme') {
            container.addChild(new pixi.Graphics().rect(0, 0, width, height).fill({ color: colorNumber(pixi, look.theme.backgroundColor) }));
        } else if (source.type === 'gradient') {
            ownTexture = this.gradientTexture(source.from, source.to, source.angle);
            sprite = new pixi.Sprite(ownTexture);
            sprite.width = width;
            sprite.height = height;
            container.addChild(sprite);
        } else {
            let texture: Texture | null = null;
            if (source.type === 'cover') texture = look.cover;
            else if (source.type === 'image') texture = this.imageTextures.get(source.assetId)?.texture ?? null;
            else if (video) {
                ownTexture = pixi.Texture.from(video.canvas);
                texture = ownTexture;
            }
            if (texture) {
                sprite = new pixi.Sprite(texture);
                sprite.anchor.set(0.5);
                const fit = clip.fit === 'contain' ? Math.min : Math.max;
                sprite.scale.set(fit(width / Math.max(1, texture.width), height / Math.max(1, texture.height)));
                sprite.position.set(width / 2, height / 2);
                container.addChild(sprite);
            }
        }
        if (clip.dim > 0) {
            container.addChild(new pixi.Graphics().rect(0, 0, width, height).fill({ color: colorNumber(pixi, look.theme.backgroundColor), alpha: Math.min(1, clip.dim) }));
        }
        if (clip.blur > 0 && sprite) {
            sprite.filters = [Object.assign(new pixi.BlurFilter({ strength: clip.blur, quality: 3, resolution: look.renderResolution * 0.5 }), { repeatEdgePixels: true })];
        }
        this.container.addChild(container);
        return { clip, container, sprite, video, ownTexture };
    }

    /** 画在一张小画布上的线性渐变（角度为度，0 = 从上到下）。 */
    private gradientTexture(from: string, to: string, angle: number): Texture {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d')!;
        const radians = (angle * Math.PI) / 180;
        const dx = Math.sin(radians) * size / 2;
        const dy = Math.cos(radians) * size / 2;
        const gradient = context.createLinearGradient(size / 2 - dx, size / 2 - dy, size / 2 + dx, size / 2 + dy);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
        return this.pixi.Texture.from(canvas);
    }

    /** 导出：把这一帧要用的视频帧都解码好。 */
    async prepareAt(time: number) {
        await Promise.all(this.items.map(async item => {
            if (!item.video) return;
            const frame = evaluateBackground(item.clip, time, item.video.duration);
            if (!frame.visible || frame.videoTime === null) return;
            await item.video.prepare(frame.videoTime);
            item.sprite?.texture.source.update();
        }));
    }

    update(time: number, playing: boolean) {
        this.items.forEach(item => {
            const frame = evaluateBackground(item.clip, time, item.video?.duration);
            item.container.visible = frame.visible;
            if (!frame.visible) {
                if (item.video && this.mode === 'realtime') item.video.sync(0, false);
                return;
            }
            item.container.alpha = frame.alpha;
            item.container.scale.set(frame.zoom);
            if (item.video && frame.videoTime !== null && this.mode === 'realtime') {
                item.video.sync(frame.videoTime, playing);
                item.sprite?.texture.source.update();
            }
        });
    }

    get hasClips() {
        return this.items.length > 0;
    }

    private clearItems() {
        this.items.forEach(item => {
            item.video?.destroy();
            if (item.sprite) item.sprite.filters = null;
            // 主题底色 / 压暗是自建 context 的 Graphics，逐节点销毁才会连 context 一起放掉；纹理照旧单独处理。
            destroyPixiDisplayTree(item.container);
            item.ownTexture?.destroy(true);
        });
        this.items = [];
    }

    destroy() {
        this.destroyed = true;
        this.clearItems();
        this.imageTextures.forEach(entry => entry.texture.destroy(true));
        this.imageTextures.clear();
        this.container.destroy({ children: true });
    }
}
