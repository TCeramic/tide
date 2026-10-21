import type { LyricLine } from "../../core/lyrics";
import type { PerformanceTier, YrcLine } from "../../shared/contract";
import type { LumiKernelHandle, LumiLine } from "./engine";
import { toLumiLines } from "./lines";
import { mountBitStage } from "./pixel-bit";

export type LyricStagePack = "sonnet" | "tempera" | "lumiere" | "hanabi" | "pixel-bit";

export interface LyricStageTheme {
  name?: string;
  backgroundColor: string;
  primaryColor: string;
  accentColor: string;
  secondaryColor: string;
  fontStyle: "sans" | "serif" | "mono";
  fontFamily?: string;
  /** Clean family names; lumisynth re-quotes each entry, so a raw CSS stack
   * must never be passed as a single `fontFamily` (it becomes one giant quoted
   * name and the browser silently falls back to 10px sans-serif). */
  fontFamilyStack?: string[];
  animationIntensity?: "calm" | "normal" | "chaotic";
}

export interface LyricStageState {
  trackId: string | null;
  pack: LyricStagePack | null;
  yrc: readonly YrcLine[];
  original: readonly LyricLine[];
  translation: readonly LyricLine[];
  romanization: readonly LyricLine[];
  durationMs?: number;
  positionMs: number;
  playing: boolean;
  metadata: { title: string; artist: string; album?: string };
  theme: LyricStageTheme;
  coverBlob: Blob | null;
  coverColors: string[];
  performance: PerformanceTier;
  /** Optional multiplier for the pack's base lyric size (phones use < 1 in portrait). */
  lyricsScale?: number;
}

export interface LyricStageHandle {
  ready: Promise<void>;
  update(state: LyricStageState): void;
  setVisible(visible: boolean): void;
  captureFrame(): Promise<string | null>;
  destroy(): void;
}

export type LyricStageErrorHandler = (error: unknown) => void;

const PACK_IDS = ["sonnet", "tempera", "lumiere", "hanabi"] as const;
const isLumiPack = (pack: LyricStagePack): pack is typeof PACK_IDS[number] => (PACK_IDS as readonly string[]).includes(pack);
const FRAME_INTERVAL_MS: Record<PerformanceTier, number> = { smooth: 1000 / 30, balanced: 1000 / 45, vivid: 1000 / 60 };
const QUALITY: Record<PerformanceTier, number> = { smooth: 0.72, balanced: 0.9, vivid: 1 };
// Phones report 2.5-3.5 DPR; capping at 2 keeps text crisp on a 1080p panel without
// paying for a 3x backing store. Desktop keeps the original 1.5 cap.
const MOBILE_DPR_CAP: Record<PerformanceTier, number> = { smooth: 1, balanced: 1.5, vivid: 2 };

const fallbackTheme: LyricStageTheme = {
  name: "Tide",
  backgroundColor: "#111923",
  primaryColor: "#f5f2ed",
  accentColor: "#83ddf1",
  secondaryColor: "#a8b8c8",
  fontStyle: "serif",
  animationIntensity: "normal",
};

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

function objectId(value: object | null | undefined): number {
  if (!value) return 0;
  let id = objectIds.get(value);
  if (!id) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
}

function safeTheme(theme: LyricStageTheme | undefined): LyricStageTheme {
  const value = theme ?? fallbackTheme;
  const color = (input: string | undefined, fallback: string) => /^#[\da-f]{3,8}$/i.test(input ?? "") ? input! : fallback;
  return {
    ...fallbackTheme,
    ...value,
    backgroundColor: color(value.backgroundColor, fallbackTheme.backgroundColor),
    primaryColor: color(value.primaryColor, fallbackTheme.primaryColor),
    accentColor: color(value.accentColor, fallbackTheme.accentColor),
    secondaryColor: color(value.secondaryColor, fallbackTheme.secondaryColor),
  };
}

function programFor(pack: LyricStagePack, lines: LumiLine[], seed: string): unknown {
  const engine = window.TideLumiStageEngine;
  if (!engine) throw new Error("LumiSynth engine was not loaded");
  return engine.compileLumiProgram({
    lines,
    seed,
    direction: { mode: "single", pack, shotMixing: false },
  });
}

function stageLines(state: LyricStageState): LumiLine[] {
  return toLumiLines({
    yrc: state.yrc,
    original: state.original,
    translation: state.translation,
    romanization: state.romanization,
  }, state.durationMs);
}

let engineLoadPromise: Promise<NonNullable<Window["TideLumiStageEngine"]>> | null = null;

/** Load the bundled Pixi runtime only when a user selects a lyric stage. */
function ensureLyricStageEngine(): Promise<NonNullable<Window["TideLumiStageEngine"]>> {
  const loaded = window.TideLumiStageEngine;
  if (loaded) return Promise.resolve(loaded);
  if (engineLoadPromise) return engineLoadPromise;

  const pending: Promise<NonNullable<Window["TideLumiStageEngine"]>> = new Promise<NonNullable<Window["TideLumiStageEngine"]>>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./lyric-stage-engine.js", document.baseURI).toString();
    script.async = true;
    script.dataset.tideLyricStageEngine = "true";
    script.onload = () => {
      const engine = window.TideLumiStageEngine;
      if (engine) resolve(engine);
      else {
        script.remove();
        reject(new Error("LumiSynth bundle loaded without exporting its runtime"));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Unable to load the local LumiSynth stage bundle"));
    };
    document.head.appendChild(script);
  }).catch(error => {
    engineLoadPromise = null;
    throw error;
  });
  engineLoadPromise = pending;
  return pending;
}

interface CachedLyrics {
  trackId: string | null;
  pack: LyricStagePack;
  yrc: readonly YrcLine[];
  original: readonly LyricLine[];
  translation: readonly LyricLine[];
  romanization: readonly LyricLine[];
  durationMs: number | undefined;
  version: number;
  lines: LumiLine[];
  signature: string;
}

interface CachedLook {
  theme: LyricStageTheme;
  metadata: { title: string | null; artist: string | null; album: string | null };
  coverColors: string[];
  cover: Blob | null;
  layerImages: Map<string, Blob>;
  signature: string;
  version: number;
}

function validColor(color: string): boolean {
  return /^#[\da-f]{3,8}$/i.test(color);
}

class LyricStageView implements LyricStageHandle {
  readonly element: HTMLDivElement;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private readySettled = false;

  private state: LyricStageState;
  private kernel: LumiKernelHandle | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private visible = true;
  private destroyed = false;
  private createEpoch = 0;
  private creatingSignature: string | null = null;
  private lookEpoch = 0;
  private lookPending = false;
  private programSignature = "";
  private compiledSignature = "";
  private compiledProgram: unknown;
  private lookSignature = "";
  private cachedLyrics: CachedLyrics | null = null;
  private lyricVersion = 0;
  private lookVersion = 0;
  private cachedLookInputs: { theme: LyricStageTheme; metadata: LyricStageState["metadata"]; colors: string[]; cover: Blob | null } | null = null;
  private cachedLook: CachedLook | null = null;
  private cachedTuningEngine: object | null = null;
  private cachedTunings: { kernel: unknown; packs: Record<string, unknown> } | null = null;
  private failureSignature = "";
  private lastRenderedPosition = Number.NaN;
  private lastRenderAt = 0;
  private dirty = true;
  private lastPerformance: PerformanceTier;
  private renderedCover: Blob | null = null;

  constructor(
    private readonly parent: HTMLElement,
    initial: LyricStageState,
    private readonly onError?: LyricStageErrorHandler,
  ) {
    this.state = initial;
    this.lastPerformance = initial.performance;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.element = document.createElement("div");
    this.element.className = "tide-lyric-stage-host";
    this.element.setAttribute("aria-hidden", "true");
    this.element.dataset.pack = initial.pack ?? "none";
    Object.assign(this.element.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "0",
      contain: "strict",
    });
    parent.prepend(this.element);
    this.observeSize();
    void this.reconcile(initial);
  }

  update(state: LyricStageState): void {
    if (this.destroyed) return;
    const previous = this.state;
    this.state = state;
    this.element.dataset.pack = state.pack ?? "none";
    if (state.positionMs !== previous.positionMs) this.dirty = true;
    if (state.performance !== this.lastPerformance) {
      this.lastPerformance = state.performance;
      this.resizeKernel();
    }
    if (!this.visible) return;
    void this.reconcile(state);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    this.element.hidden = !visible;
    if (!visible) {
      this.disposeKernel();
      this.failureSignature = "";
      return;
    }
    this.dirty = true;
    void this.reconcile(this.state);
  }

  async captureFrame(): Promise<string | null> {
    if (!this.kernel || this.destroyed) return null;
    try {
      this.renderCurrentFrame();
      return await this.kernel.captureFrame();
    } catch {
      return null;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposeKernel();
    this.markReady();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element.remove();
  }

  private observeSize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed || !this.visible) {
        this.dirty = true;
        return;
      }
      this.resizeKernel();
    });
    this.resizeObserver.observe(this.parent);
  }

  private dimensions() {
    const rect = this.parent.getBoundingClientRect();
    const mobile = document.documentElement.dataset.mobile === "true";
    const cap = mobile ? MOBILE_DPR_CAP[this.state.performance] : 1.5;
    return {
      width: Math.max(1, Math.round(rect.width || window.innerWidth)),
      height: Math.max(1, Math.round(rect.height || window.innerHeight)),
      resolution: Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * QUALITY[this.state.performance]),
    };
  }

  private resizeKernel(): void {
    if (!this.kernel) {
      this.dirty = true;
      return;
    }
    try {
      const { width, height, resolution } = this.dimensions();
      this.kernel.resize(width, height, resolution);
      this.renderCurrentFrame();
    } catch (error) {
      this.fail(error, this.failureKeyFor(this.state, this.lyricsFor(this.state), this.lookFor(this.state)));
    }
  }

  private currentTimeSeconds(state = this.state): number {
    return Math.max(0, Number.isFinite(state.positionMs) ? state.positionMs : 0) / 1_000;
  }

  private markReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.resolveReady();
  }

  /** All drawing is driven by Tide's clock; this hook carries only the live canvas reference. */
  private renderCurrentFrame(state = this.state, kernel = this.kernel): void {
    if (!kernel) return;
    const positionMs = Number.isFinite(state.positionMs) ? Math.max(0, state.positionMs) : 0;
    kernel.renderAt(positionMs / 1_000);
    this.lastRenderedPosition = positionMs / 1_000;
    this.lastRenderAt = performance.now();
    this.dirty = false;
    this.markReady();
    window.dispatchEvent(new CustomEvent("tide:lyric-stage-frame", {
      detail: { canvas: kernel.canvas, trackId: state.trackId, pack: state.pack, positionMs, handle: this },
    }));
  }

  private lyricsFor(state: LyricStageState): CachedLyrics | null {
    const pack = state.pack;
    if (!pack || !isLumiPack(pack)) return null;
    const cached = this.cachedLyrics;
    if (cached
      && cached.trackId === state.trackId
      && cached.pack === pack
      && cached.yrc === state.yrc
      && cached.original === state.original
      && cached.translation === state.translation
      && cached.romanization === state.romanization
      && cached.durationMs === state.durationMs) return cached;

    const version = ++this.lyricVersion;
    const result: CachedLyrics = {
      trackId: state.trackId,
      pack,
      yrc: state.yrc,
      original: state.original,
      translation: state.translation,
      romanization: state.romanization,
      durationMs: state.durationMs,
      version,
      lines: stageLines(state),
      signature: `${pack}:${state.trackId ?? "untitled"}:${version}`,
    };
    this.cachedLyrics = result;
    return result;
  }

  private tuningsFor(engine: NonNullable<Window["TideLumiStageEngine"]>) {
    if (this.cachedTuningEngine === engine && this.cachedTunings) return this.cachedTunings;
    const tunings = {
      kernel: engine.DEFAULT_KERNEL_TUNING,
      packs: Object.fromEntries(PACK_IDS.map(id => [id, engine.getPack(id).tuning.defaults])),
    };
    this.cachedTuningEngine = engine;
    this.cachedTunings = tunings;
    return tunings;
  }

  private lookFor(state: LyricStageState): CachedLook {
    const cachedInputs = this.cachedLookInputs;
    if (cachedInputs
      && cachedInputs.theme === state.theme
      && cachedInputs.metadata === state.metadata
      && cachedInputs.colors === state.coverColors
      && cachedInputs.cover === state.coverBlob
      && this.cachedLook) return this.cachedLook;

    const theme = safeTheme(state.theme);
    const look: CachedLook = {
      theme,
      metadata: {
        title: state.metadata.title || null,
        artist: state.metadata.artist || null,
        album: state.metadata.album || null,
      },
      coverColors: state.coverColors.filter(validColor).slice(0, 8),
      cover: state.coverBlob,
      layerImages: new Map<string, Blob>(),
      signature: "",
      version: ++this.lookVersion,
    };
    look.signature = `${look.version}:${JSON.stringify([look.theme, look.metadata, look.coverColors])}`;
    this.cachedLookInputs = { theme: state.theme, metadata: state.metadata, colors: state.coverColors, cover: state.coverBlob };
    this.cachedLook = look;
    return look;
  }

  private failureKeyFor(state: LyricStageState, lyrics: CachedLyrics | null, look: CachedLook | null): string {
    const lookSignature = look?.signature ?? this.cachedLook?.signature ?? [
      objectId(state.theme),
      objectId(state.metadata),
      objectId(state.coverColors),
      objectId(state.coverBlob),
    ].join(":");
    return `${state.pack ?? "no-pack"}:${lyrics?.signature ?? "no-lyrics"}:${lookSignature}`;
  }

  private async reconcile(state: LyricStageState): Promise<void> {
    if (this.destroyed || !this.visible) return;
    const pack = state.pack;
    if (!pack || !isLumiPack(pack)) {
      this.element.hidden = true;
      this.failureSignature = "";
      this.disposeKernel();
      this.markReady();
      return;
    }

    let lyrics: CachedLyrics | null = null;
    let look: CachedLook | null = null;
    let failureKey = "";
    try {
      lyrics = this.lyricsFor(state);
      if (!lyrics || lyrics.lines.length === 0) {
        // 刚切到新曲、歌词还没到时保留上一帧继续上屏；只有从未出过帧才隐藏，
        // 避免舞台先退回常规歌词页再切回来的闪回。
        if (this.kernel) {
          this.dirty = true;
          this.markReady();
          return;
        }
        this.element.hidden = true;
        this.failureSignature = "";
        this.disposeKernel();
        this.markReady();
        return;
      }
      look = this.lookFor(state);
      failureKey = this.failureKeyFor(state, lyrics, look);
      if (this.failureSignature === failureKey) return;
      const engine = await ensureLyricStageEngine();
      await this.reconcileActive(state, lyrics, look, engine);
      if (failureKey === this.failureKeyFor(this.state, this.lyricsFor(this.state), this.cachedLook)) this.failureSignature = "";
    } catch (error) {
      const currentLyrics = this.lyricsFor(this.state);
      const currentFailureKey = this.failureKeyFor(this.state, currentLyrics, this.cachedLook);
      // A rejected async create/look for a superseded track or look must not tear down the newer one.
      if (failureKey && failureKey !== currentFailureKey) return;
      failureKey ||= currentFailureKey;
      this.fail(error, failureKey);
    }
  }

  private async reconcileActive(
    state: LyricStageState,
    lyrics: CachedLyrics,
    look: CachedLook,
    engine: NonNullable<Window["TideLumiStageEngine"]>,
  ): Promise<void> {
    if (this.lookPending) return;
    const latestLyrics = this.lyricsFor(this.state);
    const latestLook = this.lookFor(this.state);
    if (latestLyrics !== lyrics || latestLook.signature !== look.signature) {
      void this.reconcile(this.state);
      return;
    }
    this.element.hidden = false;

    if (!this.kernel) {
      if (this.creatingSignature && this.creatingSignature !== lyrics.signature) {
        this.createEpoch += 1;
        this.creatingSignature = null;
      }
      if (this.creatingSignature === lyrics.signature) return;

      const epoch = ++this.createEpoch;
      this.creatingSignature = lyrics.signature;
      const program = this.programFor(lyrics);
      const { width, height, resolution } = this.dimensions();
      try {
        const kernel = await engine.LumiKernel.create({
          width,
          height,
          resolution,
          program,
          lines: lyrics.lines,
          audio: null,
          theme: look.theme,
          lyricsFontScale: this.fontScaleFor(lyrics) * (state.lyricsScale ?? 1),
          tunings: this.tuningsFor(engine),
          metadata: look.metadata,
          coverColors: look.coverColors,
          cover: look.cover,
          layerImages: look.layerImages,
          // 舞台画布要被 dock 的透镜按帧采样（drawImage 读取 WebGL 缓冲），
          // 默认的 preserveDrawingBuffer:false 会读到空帧。
          preserveDrawingBuffer: document.documentElement.dataset.mobile !== "true",
          manualRender: true,
          omitBackground: true,
          transparent: true,
          videoMode: "realtime",
        });
        if (this.destroyed || epoch !== this.createEpoch || !this.visible) {
          kernel.destroy();
          return;
        }
        const latestLyrics = this.lyricsFor(this.state);
        const latestLook = this.lookFor(this.state);
        if (latestLyrics !== lyrics || latestLook.signature !== look.signature) {
          kernel.destroy();
          if (epoch === this.createEpoch) this.creatingSignature = null;
          void this.reconcile(this.state);
          return;
        }
        this.kernel = kernel;
        this.creatingSignature = null;
        this.element.appendChild(kernel.canvas);
        kernel.canvas.classList.add("tide-lyric-stage-canvas");
        Object.assign(kernel.canvas.style, { pointerEvents: "none", width: "100%", height: "100%", display: "block" });
        this.programSignature = lyrics.signature;
        this.compiledSignature = lyrics.signature;
        this.lookSignature = look.signature;
        this.renderedCover = look.cover;
        // manualRender suppresses every upstream setter-driven draw. Present only
        // Tide's latest audio-clock position once the asynchronous scene is ready.
        this.renderCurrentFrame(this.state, kernel);
        if (this.state !== state) void this.reconcile(this.state);
      } catch (error) {
        if (this.destroyed || epoch !== this.createEpoch) return;
        if (this.creatingSignature === lyrics.signature) this.creatingSignature = null;
        throw error;
      }
      return;
    }

    const kernel = this.kernel;
    if (lyrics.signature !== this.programSignature) {
      const program = this.programFor(lyrics);
      kernel.setProgram(program, lyrics.lines, this.currentTimeSeconds());
      this.programSignature = lyrics.signature;
      this.renderCurrentFrame(this.state, kernel);
    }

    if (look.signature !== this.lookSignature || look.cover !== this.renderedCover) {
      const epoch = ++this.lookEpoch;
      this.lookPending = true;
      try {
        await kernel.setLook({ ...look, lyricsFontScale: (state.pack === "sonnet" ? 1.65 : state.pack === "tempera" ? 1.5 : 1) * (state.lyricsScale ?? 1), tunings: this.tuningsFor(engine) });
        if (this.destroyed || this.kernel !== kernel || epoch !== this.lookEpoch) return;
        this.lookPending = false;
        if (this.lookFor(this.state).signature !== look.signature) {
          void this.reconcile(this.state);
          return;
        }
        this.lookSignature = look.signature;
        this.renderedCover = look.cover;
        this.renderCurrentFrame(this.state, kernel);
        if (this.state !== state) void this.reconcile(this.state);
      } catch (error) {
        if (this.destroyed || this.kernel !== kernel || epoch !== this.lookEpoch) return;
        this.lookPending = false;
        if (this.lookFor(this.state).signature !== look.signature) {
          void this.reconcile(this.state);
          return;
        }
        throw error;
      }
      return;
    }
    this.renderIfDue();
  }

  // Both Sònnet and Tempera derive one base size per shot and then scale the hero word
  // far above the supporting words. Latin lines split into many short words, so that
  // shared base lands small and the support words read like captions. Giving Latin
  // scripts a larger base restores the support words without touching the packs; CJK
  // lines keep the size that was tuned for them.
  private fontScaleFor(lyrics: CachedLyrics): number {
    const text = lyrics.lines.map(line => line.fullText).join("");
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    return latin > cjk * 2 ? 1.3 : 0.85;
  }

  private programFor(lyrics: CachedLyrics): unknown {
    if (this.compiledSignature !== lyrics.signature) {
      this.compiledProgram = programFor(lyrics.pack, lyrics.lines, lyrics.trackId ?? `tide-${lyrics.pack}`);
      this.compiledSignature = lyrics.signature;
    }
    return this.compiledProgram;
  }

  private renderIfDue(): void {
    if (!this.kernel || !this.visible || this.destroyed || this.lookPending) return;
    const time = this.currentTimeSeconds();
    if (!this.dirty && time === this.lastRenderedPosition) return;
    const now = performance.now();
    if (this.state.playing && now - this.lastRenderAt < FRAME_INTERVAL_MS[this.state.performance]) return;
    try {
      this.renderCurrentFrame();
    } catch (error) {
      this.fail(error, this.failureKeyFor(this.state, this.lyricsFor(this.state), this.lookFor(this.state)));
    }
  }

  private disposeKernel(): void {
    const hasPendingWork = this.kernel !== null || this.creatingSignature !== null || this.lookPending;
    if (hasPendingWork) {
      this.createEpoch += 1;
      this.lookEpoch += 1;
    }
    this.creatingSignature = null;
    this.lookPending = false;
    this.kernel?.destroy();
    this.kernel = null;
    this.programSignature = "";
    this.lookSignature = "";
    this.lastRenderedPosition = Number.NaN;
    this.dirty = true;
  }

  private fail(error: unknown, signature: string): void {
    if (this.destroyed) return;
    this.failureSignature = signature;
    this.element.hidden = true;
    this.disposeKernel();
    this.markReady();
    this.reportError(error);
  }

  private reportError(error: unknown): void {
    try { this.onError?.(error); } catch { /* Consumer callbacks cannot break teardown. */ }
    const message = error instanceof Error ? error.message : String(error);
    window.dispatchEvent(new CustomEvent("tide:lyric-stage-error", { detail: { message, handle: this } }));
  }
}

/** Mounts one original LumiSynth scene over Tide's lyrics; Tide owns time, visibility and teardown. */
export function mountLyricStage(host: HTMLElement, initialState: LyricStageState, onError?: LyricStageErrorHandler): LyricStageHandle {
  if (initialState.pack === "pixel-bit") return mountBitStage(host, initialState, onError);
  return new LyricStageView(host, initialState, onError);
}
