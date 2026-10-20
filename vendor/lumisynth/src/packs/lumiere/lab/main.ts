// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/lab/main.ts
// 绘光 L0 实验页（只在 dev 服务器下：/lab/lumiere.html）。直接挂场景，不走编译器与内核，
// 用来对着参考图调观感，验证单元挂转场 filter / 透明底时光的合成，以及 4K 单帧耗时。
// window.__lumiereLab 给自动化用。
import type { Application, BlurFilter } from 'pixi.js';
import type { Line, Theme } from '@/core/types';
import { loadPixi } from '@/engine/shared/loadPixi';
import { createLightSprites, type LightSprites } from '../light/sprites';
import { createLightField } from '../light/lightFieldShader';
import { compressLight, lightAt, resolveBeams, type LightRig } from '../light/rig';
import { createRng } from '@/core/rng';
import { LUMIERE_PROFILES } from '../catalog';
import { createLumiereScene, type LumiereScene } from '../scene';
import type { WindowTypography } from '../text/lyricWindow';
import { DEFAULT_LUMIERE_TUNING, type LumiereProfile, type LumiereTuning } from '../types';

const WIDTH = 1280;
const HEIGHT = 720;
const START = 0;
const END = 22;

const PROFILES: Record<string, LumiereProfile> = Object.fromEntries(LUMIERE_PROFILES.map(profile => [profile.kind, profile]));

const DARK_THEME: Theme = {
    name: 'lab-dark',
    backgroundColor: '#07060a',
    primaryColor: '#f3e6c8',
    accentColor: '#e8c98a',
    secondaryColor: '#8a8fa3',
    fontStyle: 'serif',
    animationIntensity: 'normal',
};

const LIGHT_THEME: Theme = { ...DARK_THEME, name: 'lab-light', backgroundColor: '#f1ebe0' };

/** 示例关键字与图标（AI 生成主题时写进 wordColors / lyricsIcons 的那种），对着下面的示例歌词挑的。 */
const EXAMPLE_THEME_EXTRAS: Pick<Theme, 'wordColors' | 'lyricsIcons'> = {
    wordColors: [
        { word: '叶', color: '#5fd38a' },
        { word: '晨雾', color: '#7fb6ff' },
        { word: '黑暗', color: '#b07cff' },
        { word: 'light', color: '#ff7a59' },
    ],
    lyricsIcons: ['Sun', 'Leaf', 'Moon', 'Sparkles', 'Feather'],
};

/** 每个字均分时长的示例歌词。 */
const makeLine = (text: string, start: number, end: number): Line => {
    const chars = Array.from(text);
    const step = (end - start - 0.6) / chars.length;
    return {
        fullText: text,
        startTime: start,
        endTime: end,
        words: chars.map((char, i) => ({ text: char, startTime: start + i * step, endTime: start + (i + 1) * step })),
    };
};

const LINES: Line[] = [
    makeLine('光落在未命名的叶上', 1.5, 5.5),
    makeLine('6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', 5.5, 10),
    makeLine('我把名字写进晨雾里', 10, 14),
    makeLine('直到黑暗也学会发亮', 14, 18),
    makeLine('Lumière, draw me with light', 18, 21.5),
];

interface LabState {
    kind: string;
    time: number;
    playing: boolean;
    resolution: number;
    lightTheme: boolean;
    transparent: boolean;
    transitionBlur: boolean;
    forceBurst: boolean;
    /** mixed：每行一个镜头，排版轮换（验证镜头间换排版的连续性）。 */
    typography: 'auto' | 'mixed' | WindowTypography;
    /** 非空时每行一个镜头，光位按这个列表轮换（看镜头交接时光源怎么移动）。 */
    sequence: string[];
    starfall: boolean;
    /** 主题带上示例关键字与图标。 */
    themeExtras: boolean;
    tuning: LumiereTuning;
}

const state: LabState = {
    kind: 'zenith-shaft',
    time: 6.2,
    playing: false,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    lightTheme: false,
    transparent: false,
    transitionBlur: false,
    forceBurst: false,
    typography: 'auto',
    sequence: [],
    starfall: true,
    themeExtras: false,
    tuning: { ...DEFAULT_LUMIERE_TUNING },
};

const pixi = await loadPixi();
const mount = document.getElementById('mount')!;
let app: Application;
let sprites: LightSprites;
let scene: LumiereScene | null = null;
let unit: import('pixi.js').Container;
let blur: BlurFilter | null = null;

const createApp = async () => {
    app = new pixi.Application();
    await app.init({
        width: WIDTH,
        height: HEIGHT,
        resolution: state.resolution,
        autoDensity: true,
        antialias: true,
        backgroundAlpha: state.transparent ? 0 : 1,
        background: (state.lightTheme ? LIGHT_THEME : DARK_THEME).backgroundColor,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        useBackBuffer: true,
        preserveDrawingBuffer: true,
    });
    mount.replaceChildren(app.canvas);
    mount.classList.toggle('checker', state.transparent);
    sprites = createLightSprites(pixi);
    unit = new pixi.Container();
    app.stage.addChild(unit);
};

const MIXED: WindowTypography[] = ['horizontal', 'crossed', 'vertical'];

const labShots = () => {
    // 「强制十字爆闪」：给任何光位都加上（行首一口气扫过整行）；不勾时用光位自己的设置。
    const burst = state.forceBurst ? { mode: 'sweep' as const, density: 0.5, every: 1, offset: 0, size: 4, tint: [1, 0.6, 0.4] as [number, number, number] } : undefined;
    const profile = PROFILES[state.kind]!;
    if (state.sequence.length > 0) {
        return LINES.map((line, index) => ({
            profile: PROFILES[state.sequence[index % state.sequence.length]!] ?? profile,
            startTime: index === 0 ? START : line.startTime,
            endTime: index === LINES.length - 1 ? END : LINES[index + 1]!.startTime,
            lines: [index],
            burst,
        }));
    }
    if (state.typography !== 'mixed') {
        return [{ profile, startTime: START, endTime: END, lines: LINES.map((_, index) => index), burst }];
    }
    return LINES.map((line, index) => ({
        profile,
        startTime: index === 0 ? START : line.startTime,
        endTime: index === LINES.length - 1 ? END : LINES[index + 1]!.startTime,
        lines: [index],
        burst,
        typography: MIXED[index % MIXED.length],
    }));
};

const rebuildScene = () => {
    scene?.destroy();
    scene = createLumiereScene(pixi, {
        width: WIDTH,
        height: HEIGHT,
        resolution: state.resolution,
        seed: 'lab',
        theme: { ...(state.lightTheme ? LIGHT_THEME : DARK_THEME), ...(state.themeExtras ? EXAMPLE_THEME_EXTRAS : {}) },
        tuning: state.tuning,
        lines: LINES,
        shots: labShots(),
        startTime: START,
        endTime: END,
        sprites,
        opening: true,
        fadeOut: { start: END - 0.9, end: END },
        typography: state.typography === 'auto' || state.typography === 'mixed' ? undefined : state.typography,
        starfall: state.starfall ? undefined : null,
    });
    unit.addChild(scene.view);
    blur?.destroy();
    blur = state.transitionBlur ? new pixi.BlurFilter({ strength: 1.5, quality: 2 }) : null;
    unit.filters = blur ? [blur] : [];
    render();
};

const rebuildAll = async () => {
    scene?.destroy();
    scene = null;
    sprites?.destroy();
    app?.destroy(true);
    await createApp();
    rebuildScene();
};

const timeLabel = document.getElementById('time')!;
const scrub = document.getElementById('scrub') as HTMLInputElement;
scrub.max = String(END);

/** 同内核的 presentFrame：透明底时先清画布（Pixi 的 back buffer 以普通混合画回画布、不清屏）。 */
const present = () => {
    if (state.transparent) {
        const gl = (app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
        const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    }
    app.render();
};

const render = () => {
    if (!scene) return;
    scene.update(state.time);
    present();
    timeLabel.textContent = state.time.toFixed(2);
    scrub.value = String(state.time);
};

let lastFrame = 0;
const loop = (now: number) => {
    if (state.playing) {
        const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
        state.time = state.time + dt > END ? START : state.time + dt;
        render();
    }
    lastFrame = now;
    requestAnimationFrame(loop);
};

scrub.addEventListener('input', () => {
    state.time = Number(scrub.value);
    render();
});
const playButton = document.getElementById('play')!;
playButton.addEventListener('click', () => {
    state.playing = !state.playing;
    playButton.textContent = state.playing ? '暂停' : '播放';
});

// ---------------------------------------------------------------------------------------------
// 面板

const panel = document.getElementById('panel')!;
const add = (element: HTMLElement) => panel.appendChild(element);

const select = (label: string, options: string[], value: string, onChange: (value: string) => void) => {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const input = document.createElement('select');
    options.forEach(option => input.add(new Option(PROFILES[option]?.label ? `${PROFILES[option]!.label} ${option}` : option, option)));
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    wrap.appendChild(input);
    add(wrap);
    return input;
};

const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (value: number) => void) => {
    const wrap = document.createElement('label');
    const title = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const refresh = () => { title.textContent = `${label} ${Number(input.value).toFixed(2)}`; };
    refresh();
    input.addEventListener('change', () => { set(Number(input.value)); refresh(); rebuildScene(); });
    input.addEventListener('input', refresh);
    wrap.append(title, input);
    add(wrap);
};

const checkbox = (label: string, get: () => boolean, set: (value: boolean) => void, full = false) => {
    const wrap = document.createElement('label');
    wrap.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => {
        set(input.checked);
        void (full ? rebuildAll() : rebuildScene());
    });
    wrap.append(input, document.createTextNode(label));
    add(wrap);
};

const kindSelect = select('光位', Object.keys(PROFILES), state.kind, value => { state.kind = value; rebuildScene(); });
{
    const wrap = document.createElement('label');
    wrap.textContent = '排版';
    const input = document.createElement('select');
    ([['auto', '随光位'], ['horizontal', '横排为主'], ['vertical', '竖排为主'], ['crossed', '纵横交错'], ['mixed', '逐行轮换']] as const)
        .forEach(([value, label]) => input.add(new Option(label, value)));
    input.value = state.typography;
    input.addEventListener('change', () => { state.typography = input.value as LabState['typography']; rebuildScene(); });
    wrap.appendChild(input);
    add(wrap);
}
slider('崩解', 0, 2, 0.05, () => state.tuning.decay, v => { state.tuning.decay = v; });
slider('背景歌词', 0, 3, 0.05, () => state.tuning.echo, v => { state.tuning.echo = v; });
slider('光强', 0, 2, 0.05, () => state.tuning.lightIntensity, v => { state.tuning.lightIntensity = v; });
slider('烟雾', 0, 2, 0.05, () => state.tuning.fogDensity, v => { state.tuning.fogDensity = v; });
slider('浮尘', 0, 2, 0.05, () => state.tuning.moteAmount, v => { state.tuning.moteAmount = v; });
slider('图形 bloom', 0, 2, 0.05, () => state.tuning.bloom, v => { state.tuning.bloom = v; });
slider('文字 bloom', 0, 2, 0.05, () => state.tuning.textBloom, v => { state.tuning.textBloom = v; });
slider('未唱字', 0, 0.5, 0.01, () => state.tuning.unlitOpacity, v => { state.tuning.unlitOpacity = v; });
checkbox('所有换位都走轨迹线', () => state.tuning.trails, v => { state.tuning.trails = v; });
slider('烟雾倍频', 2, 6, 1, () => state.tuning.fogOctaves, v => { state.tuning.fogOctaves = v; });
checkbox('显示下一行（邻行 2）', () => state.tuning.windowNeighbors === 2, v => { state.tuning.windowNeighbors = v ? 2 : 1; });
checkbox('线稿', () => state.tuning.lineArt, v => { state.tuning.lineArt = v; });
checkbox('前景散景', () => state.tuning.frontBokeh, v => { state.tuning.frontBokeh = v; });
checkbox('示例关键字与图标（主题 wordColors / lyricsIcons）', () => state.themeExtras, v => { state.themeExtras = v; });
checkbox('关键字着色', () => state.tuning.keywordColors, v => { state.tuning.keywordColors = v; });
checkbox('主题图标', () => state.tuning.themeIcons, v => { state.tuning.themeIcons = v; });
checkbox('星空点亮（开场倾泻 + 光雨）', () => state.starfall, v => { state.starfall = v; });
checkbox('强制十字爆闪（EVA）', () => state.forceBurst, v => { state.forceBurst = v; });
checkbox('单元挂转场 blur（验证合成）', () => state.transitionBlur, v => { state.transitionBlur = v; });
checkbox('透明底（分层导出）', () => state.transparent, v => { state.transparent = v; }, true);
checkbox('浅色主题（验证暗场底）', () => state.lightTheme, v => { state.lightTheme = v; }, true);

const perf = document.createElement('div');
perf.id = 'perf';
const perfButton = document.createElement('button');
perfButton.textContent = '4K 单帧计时';
add(perfButton);
add(perf);

/** 在当前场景上按 3840×2160 逐帧渲染 n 帧，readPixels 1 像素强制同步，取平均。 */
const measure4k = async (frames = 12) => {
    const previous = state.resolution;
    state.resolution = 3;
    await rebuildAll();
    const gl = (app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    const pixel = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    scene!.update(state.time);
    app.render();
    sync();
    const samples: number[] = [];
    for (let i = 0; i < frames; i += 1) {
        const begin = performance.now();
        scene!.update(state.time + i / 30);
        app.render();
        sync();
        samples.push(performance.now() - begin);
    }
    state.resolution = previous;
    await rebuildAll();
    samples.sort((a, b) => a - b);
    const result = {
        median: samples[Math.floor(samples.length / 2)]!,
        mean: samples.reduce((a, b) => a + b, 0) / samples.length,
        max: samples[samples.length - 1]!,
    };
    perf.textContent = `3840×2160（${state.kind}）\n中位 ${result.median.toFixed(1)} ms / 平均 ${result.mean.toFixed(1)} ms / 最慢 ${result.max.toFixed(1)} ms`;
    return result;
};
perfButton.addEventListener('click', () => void measure4k());

await createApp();
rebuildScene();
requestAnimationFrame(loop);

/** 调试：把画布的一块区域（逻辑像素）放大铺满窗口，便于截图看细节；unzoom 收起。 */
const zoomLayer = document.createElement('canvas');
zoomLayer.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:10;display:none;background:#000;object-fit:contain';
document.body.appendChild(zoomLayer);
const zoom = (x: number, y: number, w: number, h: number) => {
    render();
    const scale = app.canvas.width / WIDTH;
    zoomLayer.width = Math.round(w * scale);
    zoomLayer.height = Math.round(h * scale);
    zoomLayer.getContext('2d')!.drawImage(app.canvas, x * scale, y * scale, w * scale, h * scale, 0, 0, zoomLayer.width, zoomLayer.height);
    zoomLayer.style.display = 'block';
};
const unzoom = () => { zoomLayer.style.display = 'none'; };

/**
 * 光束公式的 TS / GLSL 对拍：只画光场（烟雾中和：tyndallBase = 1、ambient = 0，没有眩光），白光，
 * 带条纹与三种窗影；读回像素的 alpha（= 压缩后的最大通道）与 CPU 的 1 − exp(−lightAt) 比较。
 */
const parity = (samples = 240) => {
    const aspect = WIDTH / HEIGHT;
    const rig: LightRig = {
        beams: [
            { x: 0.5, y: -0.05, angle: Math.PI / 2, spread: 0.12, width: 0.06, length: 0.9, softness: 0.5, intensity: 1.1, streaks: 0.6, streakFreq: 7, streakSpeed: 0.1, core: 0.6,
                gobo: { pattern: 'blinds', frequency: 11, duty: 0.5, drift: 0.05 } },
            { x: 0.05, y: 0.1, angle: 0.5, spread: 0.1, width: 0.2, length: 1.2, softness: 0.4, intensity: 0.8, streaks: 0.3, streakFreq: 5, streakSpeed: 0, core: 0.3,
                gobo: { pattern: 'lattice', frequency: 8, duty: 0.6, drift: 0.02 } },
            { x: 0.95, y: 0.05, angle: 2.4, spread: 0.15, width: 0.1, length: 1, softness: 0.7, intensity: 0.7, streaks: 0.5, streakFreq: 12, streakSpeed: -0.05, core: 0.5,
                gobo: { pattern: 'leaves', frequency: 6, duty: 0.45, drift: 0.1 } },
            // 会聚（负张角，过焦点再散开）+ 射程。
            { x: 0.3, y: 0.3, angle: 0.2, spread: -0.12, width: 0.24, length: 2, softness: 0.5, intensity: 0.9, streaks: 0, streakFreq: 1, streakSpeed: 0, core: 0.4, reach: 1.1 },
        ],
        fog: { density: 0, tyndallBase: 1, scale: 2, driftX: 0, driftY: 0, warp: 0, ambient: 0 },
        glare: null,
    };
    const time = 3.3;
    const beams = resolveBeams(rig, time, aspect, { intensity: 1, bass: 0, color: [1, 1, 1] });
    const field = createLightField(pixi, WIDTH, HEIGHT);
    field.update({ beams, rig, time, fogScale: 1, color: [1, 1, 1], glareScale: 1, dark: [0, 0, 0, 0], octaves: 3 });
    const target = pixi.RenderTexture.create({ width: WIDTH, height: HEIGHT, resolution: 1 });
    app.renderer.render({ container: field.view, target, clear: true });
    const { pixels, width } = app.renderer.extract.pixels(target);
    const random = createRng('parity');
    let maxError = 0;
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < samples; i += 1) {
        const px = Math.floor(random() * WIDTH);
        const py = Math.floor(random() * HEIGHT);
        // 像素中心（与片元着色器的采样点一致）。
        const expected = compressLight(lightAt(beams, (px + 0.5) / HEIGHT, (py + 0.5) / HEIGHT));
        const actual = pixels[(py * width + px) * 4 + 3]! / 255;
        const error = Math.abs(actual - expected);
        maxError = Math.max(maxError, error);
        sum += error;
        if (expected > 0.05) lit += 1;
    }
    field.destroy();
    target.destroy(true);
    return { maxError, meanError: sum / samples, litSamples: lit, samples };
};

/** 联系表：把几个光位在同一时刻依次渲染，缩小拼成一张网格图（dataURL），用来一次看一族。 */
const contactSheet = (kinds: string[], time: number, cols = 5, cellWidth = 384) => {
    const cellHeight = Math.round((cellWidth * HEIGHT) / WIDTH);
    const rows = Math.ceil(kinds.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cellWidth;
    sheet.height = rows * cellHeight;
    const context = sheet.getContext('2d')!;
    context.fillStyle = '#000';
    context.fillRect(0, 0, sheet.width, sheet.height);
    const previous = state.kind;
    kinds.forEach((kind, index) => {
        state.kind = kind;
        kindSelect.value = kind;
        rebuildScene();
        state.time = time;
        render();
        context.drawImage(app.canvas, (index % cols) * cellWidth, Math.floor(index / cols) * cellHeight, cellWidth, cellHeight);
        context.fillStyle = 'rgba(255,255,255,0.8)';
        context.font = '14px sans-serif';
        context.fillText(`${PROFILES[kind]?.label ?? ''} ${kind}`, (index % cols) * cellWidth + 8, Math.floor(index / cols) * cellHeight + 20);
    });
    state.kind = previous;
    kindSelect.value = previous;
    rebuildScene();
    return sheet.toDataURL('image/png');
};

(window as unknown as { __lumiereLab: unknown }).__lumiereLab = {
    parity,
    contactSheet,
    kinds: () => Object.keys(PROFILES),
    zoom,
    unzoom,
    state,
    burstTimes: () => scene?.burstTimes ?? [],
    lineAnchor: (lineIndex: number, time: number) => scene?.lineAnchor(lineIndex, time),
    seek: (time: number) => { state.time = time; render(); },
    setKind: (kind: string) => { state.kind = kind; kindSelect.value = kind; rebuildScene(); },
    setSequence: (kinds: string[]) => { state.sequence = kinds; rebuildScene(); },
    setThemeExtras: (on: boolean) => { state.themeExtras = on; rebuildScene(); },
    rebuild: () => rebuildAll(),
    measure4k,
};
