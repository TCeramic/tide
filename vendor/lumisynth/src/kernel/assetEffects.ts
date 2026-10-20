// src/kernel/assetEffects.ts
// 素材片段的附加效果（见 core/assets/clips.ts 的 ClipEffect）：用和图片同形状的纯色剪影画在原图下面。
// 剪影在画布上生成——把图画上去，再用 source-in 填成纯色，外发光先模糊再填——按「素材 × 颜色 × 半径」缓存，
// 同一张图、同一种效果只生成一次。每帧只改这几层精灵的缩放与透明度，只由时间决定。
import type { Container, Sprite, Texture } from 'pixi.js';
import { ECHO_LAYERS, echoLayers, glowRadiusOf, normalizeClipEffect, shadowOffsetOf, type ResolvedAssetClip } from '@/core/assets/clips';

type PixiModule = typeof import('pixi.js');

type Drawable = CanvasImageSource & { width: number; height: number };

const makeCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
};

/** 纯色剪影；blur > 0 时先模糊（外发光），四周留出模糊的余量。 */
const silhouetteCanvas = (image: Drawable, color: string, blur: number) => {
    const pad = Math.ceil(blur * 2.5);
    const canvas = makeCanvas(image.width + pad * 2, image.height + pad * 2);
    const context = canvas.getContext('2d')!;
    if (blur > 0) {
        context.filter = `blur(${blur}px)`;
        // 画两遍：只画一遍的模糊边缘太淡，光晕看不出来。
        context.drawImage(image, pad, pad);
        context.drawImage(image, pad, pad);
        context.filter = 'none';
    } else {
        context.drawImage(image, pad, pad);
    }
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
};

/** 效果纹理的缓存；每次同步片段之后丢掉没人用的。 */
export class EffectTextureCache {
    private entries = new Map<string, Texture>();
    private used = new Set<string>();

    constructor(private readonly pixi: PixiModule) {}

    get(assetId: string, image: Drawable, color: string, blur: number): Texture {
        // 半径取整到 2px：拖滑块时不会每一帧都重新生成。
        const radius = blur > 0 ? Math.max(2, Math.round(blur / 2) * 2) : 0;
        const key = `${assetId}|${color}|${radius}`;
        this.used.add(key);
        let texture = this.entries.get(key);
        if (!texture) {
            texture = this.pixi.Texture.from(silhouetteCanvas(image, color, radius));
            this.entries.set(key, texture);
        }
        return texture;
    }

    /** 开始一轮同步：之后 get 到的才算在用。 */
    begin() {
        this.used.clear();
    }

    /** 结束一轮同步：销毁这一轮没用到的纹理。 */
    end() {
        this.entries.forEach((texture, key) => {
            if (this.used.has(key)) return;
            texture.destroy(true);
            this.entries.delete(key);
        });
    }

    /** 素材的文件换了：它的剪影全部作废。 */
    dropAsset(assetId: string) {
        this.entries.forEach((texture, key) => {
            if (!key.startsWith(`${assetId}|`)) return;
            texture.destroy(true);
            this.entries.delete(key);
        });
    }

    destroy() {
        this.entries.forEach(texture => texture.destroy(true));
        this.entries.clear();
    }
}

export interface ClipEffectLayers {
    /** 画在原图之下的效果精灵（重影扩张有 ECHO_LAYERS 层，其余一层）。 */
    sprites: Sprite[];
    update: (clip: ResolvedAssetClip, time: number) => void;
}

/** 给片段建效果层（没有效果时返回 null）。精灵的坐标以原图中心为原点、以原图像素为单位。 */
export const buildClipEffect = (
    pixi: PixiModule,
    cache: EffectTextureCache,
    clip: ResolvedAssetClip,
    image: Drawable,
    parent: Container,
): ClipEffectLayers | null => {
    const effect = normalizeClipEffect(clip.effect);
    if (effect.type === 'none' || effect.opacity <= 0) return null;
    const sprite = (texture: Texture) => {
        const item = new pixi.Sprite(texture);
        item.anchor.set(0.5);
        parent.addChild(item);
        return item;
    };

    if (effect.type === 'glow') {
        const glow = sprite(cache.get(clip.assetId, image, effect.color, glowRadiusOf(effect) * image.height));
        glow.alpha = effect.opacity;
        return { sprites: [glow], update: () => undefined };
    }

    const silhouette = cache.get(clip.assetId, image, effect.color, 0);
    if (effect.type === 'shadow') {
        const shadow = sprite(silhouette);
        const offset = shadowOffsetOf(effect) * image.height;
        shadow.position.set(offset, offset);
        shadow.alpha = effect.opacity;
        return { sprites: [shadow], update: () => undefined };
    }

    const layers = Array.from({ length: ECHO_LAYERS }, () => sprite(silhouette));
    return {
        sprites: layers,
        update: (current, time) => {
            echoLayers(effect, time - current.start).forEach((frame, index) => {
                layers[index].scale.set(frame.scale);
                layers[index].alpha = frame.alpha;
            });
        },
    };
};
