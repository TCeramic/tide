// src/packs/hanabi/credits.ts
// 花火的片尾卡：最后一句唱完，一发升空尾迹从底边升起，在曲名上方开一朵大金冠，两侧跟着千輪；
// 曲名作为一行「歌词」逐字弹出、带色带（与歌词同一个文字引擎），艺人在下、专辑在上慢慢显出。
// 全部只由片尾开始后的时间决定。
import type { Container, TextStyleFontWeight } from 'pixi.js';
import type { Line, Theme } from '@/core/types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '@/engine/shared/fontStacks';
import type { CreditsFrame, SongMetadata } from '@/kernel/adapters/types';
import { burstPreset } from './catalog';
import { resolveHanabiPalette } from './color';
import { createFireworks } from './mg/fireworks';
import { createHanabiGlow } from './mg/glow';
import { createHanabiText } from './text/lyricText';
import type { BurstEvent, HanabiTextures, HanabiTuning, LaunchEvent, PixiModule, TextSpec } from './types';

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** 大烟花开花 / 曲名第一个字被唱到的时刻（片尾卡内的时间）。 */
const BLOOM_AT = 1.1;
const TITLE_START = 1.45;
const TITLE_STEP = 0.12;
const TITLE_SPAN = 2;

const clean = (value: string | null | undefined) => value?.trim() ?? '';

export const hasHanabiCredits = (metadata: SongMetadata) => Boolean(clean(metadata.title) || clean(metadata.artist) || clean(metadata.album));

/** 歌词 1.2 秒内淡出；片尾卡 0.3 秒起 0.8 秒淡入。 */
export const resolveHanabiCreditsFrame = (time: number, finalEndTime: number): CreditsFrame => {
    const elapsed = time - finalEndTime;
    if (elapsed <= 0) return { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 1 };
    const exit = smooth(elapsed / 1.2);
    return {
        active: true,
        lyricAlpha: 1 - exit,
        lyricBlur: exit * 6,
        posterAlpha: smooth((elapsed - 0.3) / 0.8),
        posterOffsetY: 0,
        posterScale: 1,
    };
};

/** 曲名做成一行「歌词」：每个字依次被唱到。 */
const titleLine = (title: string): Line => {
    const chars = Array.from(title);
    const step = Math.min(TITLE_STEP, TITLE_SPAN / Math.max(chars.length, 1));
    return {
        fullText: title,
        startTime: TITLE_START,
        endTime: TITLE_START + step * chars.length + 0.4,
        words: chars.map((text, i) => ({ text, startTime: TITLE_START + i * step, endTime: TITLE_START + (i + 1) * step })),
    };
};

const TITLE_SPEC: TextSpec = {
    layout: 'center',
    heroSize: 0.11,
    emphasis: 0.2,
    tilt: 0,
    block: 'band',
    enter: 'pop',
    sing: 'color',
    exit: 'ascend',
    stagger: 0.05,
    outline: false,
    hardShadow: true,
};

export interface HanabiCredits {
    view: Container;
    update: (elapsed: number) => void;
    destroy: () => void;
}

export const createHanabiCredits = (pixi: PixiModule, options: {
    width: number;
    height: number;
    resolution: number;
    theme: Theme;
    metadata: SongMetadata;
    tuning: HanabiTuning;
    textures: HanabiTextures;
    fontScale?: number;
}): HanabiCredits => {
    const { width, height, theme, tuning } = options;
    const palette = resolveHanabiPalette('festival', theme, tuning.colorMode);
    const title = clean(options.metadata.title);
    const artist = clean(options.metadata.artist);
    const album = clean(options.metadata.album);

    const view = new pixi.Container();
    const sky = new pixi.Container();
    view.addChild(sky);

    // 烟花：尾迹 0.65 秒从底边升起，1.1 秒在曲名上方开金冠，随后两侧千輪、最后一朵双层。
    const fireworks = createFireworks(pixi, options.textures, {
        width, height, palette, amount: Math.max(0, tuning.sparkAmount), maxParticles: 1400,
    });
    sky.addChild(fireworks.view);
    const glow = tuning.glow > 0 ? createHanabiGlow(pixi, Math.min(2, tuning.glow)) : null;
    if (glow) sky.filters = [glow];
    const bursts: BurstEvent[] = [
        { x: width * 0.5, y: height * 0.34, at: BLOOM_AT, spec: { ...burstPreset('kamuro', [0, 1, 3]), count: 150, radius: 0.46, duration: 4.2 }, seed: 'hanabi:credits:crown', scale: 1 },
        { x: width * 0.2, y: height * 0.3, at: BLOOM_AT + 0.55, spec: burstPreset('senrin', [1, 2, 3]), seed: 'hanabi:credits:left', scale: 0.8 },
        { x: width * 0.8, y: height * 0.27, at: BLOOM_AT + 0.8, spec: burstPreset('senrin', [2, 3, 0]), seed: 'hanabi:credits:right', scale: 0.8 },
        { x: width * 0.5, y: height * 0.22, at: BLOOM_AT + 2.2, spec: burstPreset('willow-ring', [3, 0, 1]), seed: 'hanabi:credits:finale', scale: 0.9 },
    ];
    const launches: LaunchEvent[] = bursts.map((burst, k) => ({
        fromX: burst.x + (k % 2 === 0 ? -1 : 1) * width * 0.02,
        fromY: height * 1.03,
        toX: burst.x,
        toY: burst.y,
        at: burst.at - 0.45,
        duration: 0.45,
        color: palette.glow,
        seed: `hanabi:credits:launch${k}`,
    }));

    const text = title
        ? createHanabiText({
            pixi,
            width,
            height,
            resolution: options.resolution,
            theme,
            line: titleLine(title),
            regionWidth: width * 0.72,
            regionHeight: height * 0.26,
            spec: { ...TITLE_SPEC, heroSize: TITLE_SPEC.heroSize * (options.fontScale ?? 1) },
            palette,
            seed: 'hanabi:credits:title',
            enterAt: BLOOM_AT - 0.1,
            // 片尾卡一直停在最后一帧，字不退场。
            exitAt: 1e6,
            exitDuration: 1,
            motion: Math.max(0, tuning.textMotion),
            blockOpacity: Math.min(1, Math.max(0, tuning.blockOpacity)),
        })
        : null;
    if (text) {
        text.view.position.set(width / 2, height * 0.5);
        view.addChild(text.view);
    }

    const font = resolveThemeFontStack(theme);
    const detailSize = Math.max(13, height * 0.03);
    const detailStyle = (size: number, spacing: number) => new pixi.TextStyle({
        fontFamily: font,
        fontWeight: String(resolveThemeFontWeight(theme, 600)) as TextStyleFontWeight,
        fontSize: size,
        fill: palette.paper,
        letterSpacing: size * spacing,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: width * 0.7,
    });
    const titleDone = TITLE_START + Math.min(TITLE_SPAN, TITLE_STEP * Array.from(title).length);
    const details = [
        artist ? { text: artist.toLocaleUpperCase(), y: 0.66, size: detailSize, spacing: 0.3, delay: title ? titleDone : 1.2 } : null,
        album ? { text: album, y: 0.35, size: detailSize * 0.8, spacing: 0.16, delay: (title ? titleDone : 1.2) + 0.3 } : null,
    ].filter(item => item !== null).map(item => {
        const label = new pixi.Text({ text: item.text, style: detailStyle(item.size, item.spacing), resolution: options.resolution });
        label.anchor.set(0.5);
        label.position.set(width / 2, item.y * height);
        label.alpha = 0;
        view.addChild(label);
        return { label, delay: item.delay, y: item.y * height };
    });

    const update = (elapsed: number) => {
        const time = Math.max(0, elapsed);
        fireworks.update(time, bursts.filter(burst => time >= burst.at && time <= burst.at + burst.spec.duration + 0.1), launches);
        text?.update(time);
        details.forEach(({ label, delay, y }) => {
            const k = smooth((time - delay) / 0.9);
            label.alpha = k * 0.92;
            label.position.y = y + (1 - k) * height * 0.02;
        });
    };
    update(0);

    return {
        view,
        update,
        destroy: () => {
            sky.filters = [];
            glow?.destroy();
            fireworks.destroy();
            text?.destroy();
            view.destroy({ children: true });
        },
    };
};
