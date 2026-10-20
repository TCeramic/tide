// src/kernel/layers.ts
// 内核自己画的层：背景、唯一的后处理链、译文字幕、擦除色块。
import type { Line, Theme } from '@/core/types';
import { mixColors, parseColorChannels } from '@/engine/shared/colorMix';
import { resolveThemeFontStack, resolveThemeFontWeight } from '@/engine/shared/fontStacks';
import { destroyPixiDisplayTree } from '@/engine/shared/pixiDisplayResources';
import { createSonnetLensFilter } from '@/packs/sonnet/sonnetLensFilter';
import { createSonnetPrintFilters } from '@/packs/sonnet/sonnetPrintFilters';
import type { KernelTuning } from './tuning';

type PixiModule = typeof import('pixi.js');
type Container = import('pixi.js').Container;
type Filter = import('pixi.js').Filter;

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

// ---------------------------------------------------------------------------------------------
// 背景：必须画在 Pixi 里——tempera 的镂空构图要透出它，文字反色要读到它，导出也要包含它。

export interface BackgroundLayer {
    container: Container;
    destroy: () => void;
}

export const buildBackground = (
    pixi: PixiModule,
    width: number,
    height: number,
    theme: Theme,
    tuning: KernelTuning['background'],
    cover: import('pixi.js').Texture | null,
    renderResolution: number,
): BackgroundLayer => {
    const container = new pixi.Container();
    const filters: Filter[] = [];
    container.addChild(new pixi.Graphics().rect(0, 0, width, height).fill({ color: colorNumber(pixi, theme.backgroundColor) }));
    if (tuning.mode === 'cover' && cover) {
        const sprite = new pixi.Sprite(cover);
        const scale = Math.max(width / cover.width, height / cover.height) * 1.08;
        sprite.anchor.set(0.5);
        sprite.scale.set(scale);
        sprite.position.set(width / 2, height / 2);
        if (tuning.coverBlur > 0) {
            const blur = new pixi.BlurFilter({ strength: tuning.coverBlur, quality: 3, resolution: renderResolution * 0.5 });
            blur.repeatEdgePixels = true;
            sprite.filters = [blur];
            filters.push(blur);
        }
        container.addChild(sprite);
        container.addChild(new pixi.Graphics().rect(0, 0, width, height)
            .fill({ color: colorNumber(pixi, theme.backgroundColor), alpha: Math.min(1, Math.max(0, tuning.coverDim)) }));
    }
    return {
        container,
        destroy: () => {
            container.children.forEach(child => {
                child.filters = null;
            });
            filters.forEach(filter => filter.destroy());
            // 底色 / 压暗是自建 context 的 Graphics，逐节点销毁才会连 context 一起放掉。
            destroyPixiDisplayTree(container);
        },
    };
};

// ---------------------------------------------------------------------------------------------
// 后处理：整个 world 只有这一条链。每个 pass 都用 'inherit' 分辨率（pixi 对同一数组取最小值，
// 默认的硬编码 1 会把画面糊掉；tempera 文字反色也依赖这一点，见 packs/tempera/temperaSceneFilters.ts）。

export const buildPostProcessChain = (
    pixi: PixiModule,
    tuning: KernelTuning['postProcess'],
    seed: number,
): Filter[] => {
    if (!tuning.enabled) return [];
    const filters: Filter[] = [];
    if (tuning.lensDistortion > 0 || tuning.lensDispersion > 0) {
        filters.push(createSonnetLensFilter(pixi, { distortion: tuning.lensDistortion, dispersion: tuning.lensDispersion }));
    }
    if (tuning.grain > 0) {
        filters.push(new pixi.NoiseFilter({ noise: tuning.grain * 0.35, seed: (seed % 10_000) / 10_000, antialias: 'on' }));
    }
    if (tuning.contrast > 0) {
        const matrix = new pixi.ColorMatrixFilter();
        matrix.contrast(tuning.contrast * 0.5, false);
        matrix.antialias = 'on';
        filters.push(matrix);
    }
    filters.push(...createSonnetPrintFilters(pixi, {
        rgbShift: tuning.rgbShift,
        halftone: tuning.halftone,
        vignette: tuning.vignette,
    }));
    filters.forEach(filter => {
        filter.resolution = 'inherit';
    });
    return filters;
};

// ---------------------------------------------------------------------------------------------
// 译文字幕

const readable = (text: string | undefined | null) => Boolean(text && text.trim() && text.trim() !== '......');

export const resolveSubtitleText = (line: Line | null, mode: KernelTuning['subtitles']['mode']) => {
    if (!line || mode === 'none') return null;
    const text = mode === 'translation' ? line.translation : line.romanization;
    return readable(text) ? text!.trim() : null;
};

/** 当前行（或刚唱完、下一行还没开始的行）。唱完 3 秒后不再显示。 */
export const findSubtitleLine = (lines: Line[], time: number): { line: Line; index: number } | null => {
    let index = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startTime <= time) {
            index = i;
            break;
        }
    }
    if (index < 0) return null;
    const line = lines[index];
    if (time > line.endTime + 3) return null;
    return { line, index };
};

export interface SubtitleLayer {
    container: Container;
    update: (time: number) => void;
    destroy: () => void;
}

// 字幕的颜色跟着底下的画面走：主题色是按主题底色配的，镜头自己铺了浅色底（凝彩的色块、绘光的光斑……）
// 时照原样画就看不清。做法与凝彩歌词的反色一样，在 GPU 上读已经画好的画面：底亮就用深字 + 浅色衬底，
// 底暗就用浅字 + 深色衬底。字与衬底画在同一个容器里，分别用绿、红两个通道画出覆盖率，由滤镜上色。

const luminance = (color: string) => {
    const channels = parseColorChannels(color);
    return channels ? (channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722) / 255 : 0.5;
};

/** 把颜色往白 / 黑推，直到亮度过了 bound（保留一点原来的色相）。 */
const pushLuminance = (color: string, toward: 'light' | 'dark', bound: number) => {
    const target = toward === 'light' ? '#ffffff' : '#0a0a0a';
    const passes = (value: string) => (toward === 'light' ? luminance(value) >= bound : luminance(value) <= bound);
    for (let step = 0; step <= 10; step += 1) {
        const mixed = mixColors(color, target, step / 10);
        if (passes(mixed)) return mixed;
    }
    return target;
};

/** 字幕的两套配色：浅字配深衬底、深字配浅衬底。 */
export const subtitlePalette = (theme: Theme) => ({
    lightText: pushLuminance(theme.secondaryColor, 'light', 0.74),
    darkText: pushLuminance(theme.secondaryColor, 'dark', 0.16),
    darkHalo: pushLuminance(theme.backgroundColor, 'dark', 0.2),
    lightHalo: pushLuminance(theme.backgroundColor, 'light', 0.86),
});

const subtitleVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const subtitleFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBackTexture;
uniform highp vec4 uInputSize;
uniform vec3 uLightText;
uniform vec3 uDarkText;
uniform vec3 uLightHalo;
uniform vec3 uDarkHalo;
uniform float uThreshold;
uniform float uFallbackLuminance;
uniform float uSampleRadius;

float backLuminance(vec2 uv) {
    vec4 back = texture(uBackTexture, uv);
    // 渲染目标是预乘的；什么都没画的地方（分层导出的透明底）当作主题底色。
    vec3 straight = back.rgb / max(back.a, 1e-4);
    float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
    return mix(uFallbackLuminance, lum, clamp(back.a * 3.0, 0.0, 1.0));
}

void main(void) {
    vec4 front = texture(uTexture, vTextureCoord);
    if (front.a <= 0.0) {
        finalColor = vec4(0.0);
        return;
    }
    // 取一圈（约半个字宽）的平均亮度，细碎的纹理不会让一个字里深浅来回跳。
    vec2 r = uInputSize.zw * uSampleRadius;
    vec2 d = r * 0.7071;
    float lum = backLuminance(vTextureCoord) * 0.2
        + (backLuminance(vTextureCoord + vec2(r.x, 0.0)) + backLuminance(vTextureCoord - vec2(r.x, 0.0))
            + backLuminance(vTextureCoord + vec2(0.0, r.y)) + backLuminance(vTextureCoord - vec2(0.0, r.y))
            + backLuminance(vTextureCoord + d) + backLuminance(vTextureCoord - d)
            + backLuminance(vTextureCoord + vec2(d.x, -d.y)) + backLuminance(vTextureCoord + vec2(-d.x, d.y))) * 0.1;
    float dark = step(uThreshold, lum);
    vec3 text = mix(uLightText, uDarkText, dark);
    vec3 halo = mix(uDarkHalo, uLightHalo, dark);
    // 绿通道是字的覆盖率，红通道是字底下露出来的衬底（预乘的「字盖在衬底上」）。
    finalColor = vec4(text * front.g + halo * front.r, front.a);
}
`;

const rgbOf = (color: string) => {
    const channels = parseColorChannels(color) ?? { r: 128, g: 128, b: 128 };
    return new Float32Array([channels.r / 255, channels.g / 255, channels.b / 255]);
};

const createSubtitleContrastFilter = (pixi: PixiModule, theme: Theme, sampleRadius: number, padding: number) => {
    const palette = subtitlePalette(theme);
    const uniforms = new pixi.UniformGroup({
        uLightText: { value: rgbOf(palette.lightText), type: 'vec3<f32>' },
        uDarkText: { value: rgbOf(palette.darkText), type: 'vec3<f32>' },
        uLightHalo: { value: rgbOf(palette.lightHalo), type: 'vec3<f32>' },
        uDarkHalo: { value: rgbOf(palette.darkHalo), type: 'vec3<f32>' },
        uThreshold: { value: (luminance(palette.lightText) + luminance(palette.darkText)) / 2, type: 'f32' },
        uFallbackLuminance: { value: luminance(theme.backgroundColor), type: 'f32' },
        uSampleRadius: { value: sampleRadius, type: 'f32' },
    });
    return new pixi.Filter({
        glProgram: pixi.GlProgram.from({ vertex: subtitleVertex, fragment: subtitleFragment, name: 'subtitle-contrast' }),
        // blendRequired：Pixi 把滤镜范围里已经画好的像素拷进 uBackTexture。
        blendRequired: true,
        resources: { subtitleUniforms: uniforms, uBackTexture: pixi.Texture.EMPTY },
        // 衬底模糊后比它自己的包围盒大，范围不留出来就会被裁成方块。
        padding,
        // 必须是 'inherit'，理由见 packs/tempera/temperaDifferenceFilter.ts：输入与背景纹理的像素尺寸要一致。
        resolution: 'inherit',
    });
};

export const buildSubtitleLayer = (
    pixi: PixiModule,
    width: number,
    height: number,
    theme: Theme,
    tuning: KernelTuning['subtitles'],
    lines: Line[],
    renderResolution = 1,
): SubtitleLayer => {
    const container = new pixi.Container();
    const glow = new pixi.Graphics();
    const glowStrength = 24;
    const glowBlur = new pixi.BlurFilter({ strength: glowStrength, quality: 3 });
    glow.filters = [glowBlur];
    const fontSize = Math.round(Math.min(width, height) * 0.036 * tuning.scale);
    // 颜色由滤镜上：字画在绿通道、衬底画在红通道。
    const text = new pixi.Text({
        text: '',
        style: new pixi.TextStyle({
            fontFamily: resolveThemeFontStack(theme),
            fontWeight: String(resolveThemeFontWeight(theme, 500)) as import('pixi.js').TextStyleFontWeight,
            fontSize,
            fill: '#00ff00',
            align: 'center',
            wordWrap: true,
            wordWrapWidth: width * 0.8,
            breakWords: true,
        }),
    });
    text.anchor.set(0.5, 1);
    container.addChild(glow, text);
    const contrast = createSubtitleContrastFilter(pixi, theme, fontSize * 0.6 * renderResolution, glowStrength * 2);
    container.filters = [contrast];
    const baseY = height - Math.max(28, height * 0.075);
    let shownIndex = -2;

    const update = (time: number) => {
        const current = findSubtitleLine(lines, time);
        const content = current ? resolveSubtitleText(current.line, tuning.mode) : null;
        if (!current || !content) {
            container.visible = false;
            shownIndex = -2;
            return;
        }
        if (current.index !== shownIndex) {
            shownIndex = current.index;
            text.text = content;
            glow.clear();
            const w = text.width + fontSize * 3;
            const h = text.height + fontSize * 1.6;
            glow.ellipse(width / 2, baseY - text.height / 2, w / 2, h / 2).fill({ color: 0xff0000, alpha: 0.8 });
        }
        // 与 folia 的 DOM 字幕一样：换行时 0.24s 淡入并上移 10px。
        const enter = Math.min(1, Math.max(0, (time - current.line.startTime) / 0.24));
        const eased = 1 - Math.pow(1 - enter, 3);
        container.visible = true;
        container.alpha = tuning.opacity * eased;
        text.position.set(width / 2, baseY + (1 - eased) * 10);
    };

    return {
        container,
        update,
        destroy: () => {
            container.filters = null;
            contrast.destroy();
            glow.filters = null;
            glowBlur.destroy();
            destroyPixiDisplayTree(container);
        },
    };
};

// ---------------------------------------------------------------------------------------------
// tempera 的擦除色块：travel 0..2，1 为满覆盖（场景在此刻切换）。

export const drawWipe = (
    pixi: PixiModule,
    wipe: import('pixi.js').Graphics,
    travel: number,
    angle: number,
    width: number,
    height: number,
    color: string,
) => {
    if (travel <= 0.001 || travel >= 1.999) {
        if (wipe.visible) {
            wipe.clear();
            wipe.visible = false;
        }
        return;
    }
    const span = Math.hypot(width, height);
    const notch = span * 0.08;
    const length = span + notch * 2;
    const start = -span / 2 - notch + (travel - 1) * length;
    const end = start + length;
    const half = span / 2;
    wipe.clear();
    wipe.poly([start, -half, end, -half, end + notch, 0, end, half, start, half, start + notch, 0])
        .fill({ color: colorNumber(pixi, color) });
    wipe.pivot.set(0, 0);
    wipe.position.set(width / 2, height / 2);
    wipe.rotation = angle;
    wipe.scale.set(1, 1);
    wipe.visible = true;
};
