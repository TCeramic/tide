import { isRenderingActive } from "../render-activity";
import { currentLyricIndex, lineEase, lyricPosition, nextLyricOffset, pairLyrics, sweepProgress, wordFill, type LyricLine } from "../../core/lyrics";
import type { LyricPayload, PerformanceTier, YrcLine } from "../../shared/contract";
import type { Track } from "../../core/playback/types";
import { MoreHorizontal } from "lucide";
import { ICON_SIZE, iconButton } from "../icons";
import { paintCover } from "../cover";
import { installCoverHalftone } from "../cover-halftone";
import { measureTextLayout } from "../text-metrics";
import { setAiTrack,setAiLines } from "../ai-context";
import { segmentLyricLines } from "../../core/ai-assist";
import { readAudioClock, onAudioClockChange } from "../audio-clock";
import { onShellView, toggleNowPlaying } from "../view";
import { mountLyricStage, type LyricStageHandle, type LyricStagePack, type LyricStageState, type LyricStageTheme } from "../lyric-stage";

type LyricView = "both" | "original" | "translation" | "romaji";

/** Full lyric text. Default is original stacked with translation. */
export function mountLyrics(root: HTMLElement): {
  setTrack: (track: Track | null) => void;
  setPosition: (positionMs: number) => void;
  captureStageFrame: () => Promise<string | null>;
  destroy: () => void;
} {
  root.replaceChildren();

  const block = document.createElement("div");
  block.className = "lyrics-block";

  const kicker = document.createElement("p");
  kicker.className = "lyrics-kicker";
  kicker.setAttribute("aria-label","潮汐波动");
  const wave=document.createElementNS("http://www.w3.org/2000/svg","svg");wave.setAttribute("viewBox","0 0 160 34");wave.setAttribute("preserveAspectRatio","xMidYMid meet");wave.setAttribute("aria-hidden","true");
  for(let i=0;i<3;i++){const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",`M8 ${12+i*6} Q20 ${2+i*6} 32 ${12+i*6} T80 ${12+i*6} T128 ${12+i*6} Q140 ${22+i*6} 152 ${12+i*6}`);path.setAttribute("fill","none");path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width",String(2.2-i*.45));path.style.animationDelay=`${i*-.6}s`;wave.append(path);}kicker.append(wave);

  const title = document.createElement("p");
  title.className = "lyrics-title";
  const art = document.createElement("div"); art.className = "lyrics-art";
  const artCover = document.createElement("button"); artCover.type = "button"; artCover.className = "lyrics-cover";
  artCover.setAttribute("aria-label", "返回上一页"); artCover.title = "返回上一页";
  artCover.addEventListener("click", toggleNowPlaying); paintCover(artCover, undefined);
  const stopCoverHalftone = installCoverHalftone(artCover);
  const artist=document.createElement("div");artist.className="lyrics-artists";
  const setArtists=(value:string)=>{if(artist.dataset.artists===value)return;artist.dataset.artists=value;artist.replaceChildren();for(const name of [...new Set(value.split(/\s+\/\s+|、/).map(v=>v.trim()).filter(Boolean))]){const link=document.createElement("button");link.type="button";link.className="lyrics-artist";link.textContent=name;link.setAttribute("aria-label",`搜索歌手 ${name}`);link.onclick=()=>window.dispatchEvent(new CustomEvent("tide:artist-search",{detail:name}));artist.append(link);}};
  const sourceNote = document.createElement("p"); sourceNote.className = "lyrics-source";
  const reading = document.createElement("div"); reading.className = "lyrics-reading";

  const tools = document.createElement("div");
  tools.className = "lyric-tools";
  const both = viewButton("双语");
  const original = viewButton("原文");
  const translation = viewButton("翻译");
  const romaji = viewButton("罗马音");
  tools.append(both, original, translation, romaji);

  const offsetMenu = document.createElement("div");
  offsetMenu.className = "lyric-offset-menu";
  const offsetSummary = document.createElement("span");
  offsetSummary.textContent = "偏移量";
  const earlier = viewButton("−0.5s");
  const later = viewButton("+0.5s");
  const offsetLabel = document.createElement("span");
  offsetLabel.className = "lyric-offset";
  offsetMenu.append(offsetSummary, earlier, later, offsetLabel);

  const line = document.createElement("p");
  line.className = "lyrics-line";

  const list = document.createElement("ol");
  list.className = "lyric-list";
  const resume = viewButton("恢复歌词跟随"); resume.classList.add("lyric-resume"); resume.hidden = true;
  let manualUntil = 0;
  const suspendFollow = () => { manualUntil = performance.now() + 6000; resume.hidden = false; };
  list.addEventListener("wheel", suspendFollow, { passive: true });
  list.addEventListener("touchstart", suspendFollow, { passive: true });
  list.addEventListener("keydown", event => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) suspendFollow(); });

  art.append(artCover, kicker, title, artist);
  const options=iconButton("歌词选项","MoreHorizontal",MoreHorizontal,ICON_SIZE.control);options.classList.add("lyric-options-trigger");options.setAttribute("aria-expanded","false");
  const optionsPanel=document.createElement("div");optionsPanel.className="lyric-options-panel";optionsPanel.hidden=true;
  const stagePickerLabel=document.createElement("label");stagePickerLabel.className="lyric-stage-picker";stagePickerLabel.textContent="歌词舞台";
  const stagePicker=document.createElement("select");stagePicker.setAttribute("aria-label","歌词舞台");
  for(const [value,label] of [["","常规"],["sonnet","商籁"],["tempera","凝彩"],["lumiere","绘光"],["hanabi","花火"],["pixel-bit","像素信号"]] as const){const option=document.createElement("option");option.value=value;option.textContent=label;stagePicker.append(option);}
  stagePickerLabel.append(stagePicker);
  const stageStatus=document.createElement("p");stageStatus.className="lyric-stage-status";stageStatus.setAttribute("role","status");stageStatus.setAttribute("aria-live","polite");stageStatus.hidden=true;
  optionsPanel.append(stagePickerLabel,stageStatus,tools,offsetMenu);
  let optionsOpenedAt=0;
  const showOptions=(open:boolean)=>{optionsPanel.hidden=!open;options.setAttribute("aria-expanded",String(open));if(open)optionsOpenedAt=performance.now();};options.addEventListener("click",()=>{showOptions(optionsPanel.hidden);options.blur();});
  // 切进舞台时 .lyrics-reading 会从右栏变成整屏，面板跟着跳到指针底下，浏览器随即派发一次 pointerleave；
  // 刚打开的这一小段窗口内忽略它，否则「选舞台」这一步会把面板自己关掉。
  optionsPanel.addEventListener("pointerleave",()=>{if(performance.now()-optionsOpenedAt<420)return;showOptions(false);});
  reading.append(options,optionsPanel,line,list,resume);
  block.append(art, reading);
  root.append(block);

  // 切歌不再等歌词回来才开始画舞台：当前曲附近 ±5 首的歌词提前取好，
  // 切歌完成后只保留这十一首，避免缓存无限增长。
  const lyricCache = new Map<string, LyricPayload>();
  const lyricCacheLimit = 11;
  let prefetchToken = 0;
  const trimLyricCache = (keep: Iterable<string>) => {
    const wanted = new Set(keep);
    for (const key of [...lyricCache.keys()]) if (!wanted.has(key)) lyricCache.delete(key);
  };
  const prefetchNeighbours = (trackId: string | null) => {
    if (!trackId) return;
    const token = ++prefetchToken;
    void window.tide.getPlayback().then(snapshot => {
      if (token !== prefetchToken) return;
      const queue = snapshot.queue ?? [];
      const at = queue.findIndex(row => row.id === trackId);
      if (at < 0) return;
      const ids = [...queue.slice(Math.max(0, at - 5), at), ...queue.slice(at, at + 6)].map(row => row.id);
      trimLyricCache(ids.slice(0, lyricCacheLimit));
      for (const id of ids) {
        if (lyricCache.has(id)) continue;
        void window.tide.lyric(id).then(result => {
          if (!result.ok || token !== prefetchToken) return;
          lyricCache.set(id, result);
          while (lyricCache.size > lyricCacheLimit) {
            const oldest = lyricCache.keys().next();
            if (oldest.done) break;
            lyricCache.delete(oldest.value);
          }
        }).catch(() => { /* 预取失败留给正式加载重试 */ });
      }
    }).catch(() => { /* 快照不可用时保持单曲加载 */ });
  };
  let generation = 0;
  let shownId: string | null = null;
  let currentTrack: Track | null = null;
  let view: LyricView = "both";
  let offsetMs = 0;
  let positionMs = 0;
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[], yrc: [] as YrcLine[] };
  const emptyLyrics: LyricLine[] = [];
  const emptyYrc: YrcLine[] = [];
  let pendingPosition = 0;
  let paintFrame = 0, paintTimer = 0, lastPaint = 0;
  let disposed = false, linesDirty = true;
  let stageHandle: LyricStageHandle | null = null;
  let selectedStagePack: LyricStagePack | null = null;
  let stageEpoch = 0;
  let projectedStageView: LyricView | null = null;
  let projectedStageSource: typeof bundles | null = null;
  let projectedStageYrc: YrcLine[] | null = null;
  let projectedStageOriginal: LyricLine[] | null = null;
  let projectedStageTranslation: LyricLine[] | null = null;
  let projectedStageRomaji: LyricLine[] | null = null;
  let projectedStageLyrics: Pick<LyricStageState, "yrc" | "original" | "translation" | "romanization"> = {
    yrc: emptyYrc, original: emptyLyrics, translation: emptyLyrics, romanization: emptyLyrics,
  };
  let stageTheme: LyricStageTheme | null = null;
  let stageThemeKey = "";
  let stageMetadata: LyricStageState["metadata"] = { title: "", artist: "" };
  let stageMetadataKey = "";
  let stageCoverColors: string[] = [];
  let stageCoverColorsKey = "";
  let stageInputsDirty = true;
  let stageInputsValue: Pick<LyricStageState, "theme" | "metadata" | "coverColors" | "performance"> | null = null;
  let stageStatusTimer = 0;
  /** 当前曲歌词是否已经得出结论（有歌词或确认没有），切换途中的“未定”状态不退出舞台。 */
  let lyricsSettled = false;
  const colorContext = document.createElement("canvas").getContext("2d");
  const stageVisible = () => isRenderingActive() && document.documentElement.dataset.view === "playing";
  const stageLyrics = (): Pick<LyricStageState, "yrc" | "original" | "translation" | "romanization"> => {
    if (projectedStageView === view
      && projectedStageSource === bundles
      && projectedStageYrc === bundles.yrc
      && projectedStageOriginal === bundles.original
      && projectedStageTranslation === bundles.translation
      && projectedStageRomaji === bundles.romaji) return projectedStageLyrics;
    projectedStageView = view;
    projectedStageSource = bundles;
    projectedStageYrc = bundles.yrc;
    projectedStageOriginal = bundles.original;
    projectedStageTranslation = bundles.translation;
    projectedStageRomaji = bundles.romaji;
    switch (view) {
      case "both":
        projectedStageLyrics = { yrc: bundles.yrc, original: bundles.original, translation: bundles.translation, romanization: bundles.romaji };
        break;
      case "original":
        projectedStageLyrics = { yrc: bundles.yrc, original: bundles.original, translation: emptyLyrics, romanization: emptyLyrics };
        break;
      case "translation":
        projectedStageLyrics = { yrc: emptyYrc, original: bundles.translation, translation: emptyLyrics, romanization: emptyLyrics };
        break;
      case "romaji":
        projectedStageLyrics = { yrc: emptyYrc, original: bundles.romaji, translation: emptyLyrics, romanization: emptyLyrics };
        break;
    }
    return projectedStageLyrics;
  };
  const hasStageLyrics = () => {
    const lyrics = stageLyrics();
    return lyrics.yrc.length > 0 || lyrics.original.length > 0;
  };
  const toStageColor = (value: string, fallback: string): string => {
    if (/^#[\da-f]{3,8}$/i.test(value)) return value;
    if (!colorContext) return fallback;
    try {
      colorContext.fillStyle = fallback;
      colorContext.fillStyle = value;
      return /^#[\da-f]{6}$/i.test(colorContext.fillStyle) ? colorContext.fillStyle : fallback;
    } catch { return fallback; }
  };
  const stageInputs = (): Pick<LyricStageState, "theme" | "metadata" | "coverColors" | "performance"> => {
    if (!stageInputsDirty && stageInputsValue) return stageInputsValue;
    stageInputsDirty = false;
    const rootStyle = getComputedStyle(document.documentElement);
    const readingStyle = getComputedStyle(reading);
    const fontPreset = document.documentElement.dataset.font;
    const performanceValue = document.documentElement.dataset.performance;
    const performanceTier: PerformanceTier = performanceValue === "vivid" || performanceValue === "balanced" ? performanceValue : "smooth";
    const fontStack = readingStyle.fontFamily
      .split(",")
      .map(part => part.replace(/["\\']/g, "").trim())
      .filter(Boolean);
    const themeValues = {
      name: document.documentElement.dataset.theme ?? "tide",
      backgroundColor: toStageColor(rootStyle.getPropertyValue("--tide-bg").trim(), "#111923"),
      primaryColor: toStageColor(rootStyle.getPropertyValue("--tide-fg").trim(), "#f5f2ed"),
      accentColor: toStageColor(rootStyle.getPropertyValue("--tide-accent").trim(), "#83ddf1"),
      secondaryColor: toStageColor(rootStyle.getPropertyValue("--tide-muted").trim(), "#a8b8c8"),
      fontStyle: (fontPreset === "serif" || fontPreset === "song" ? "serif" : fontPreset === "mono" ? "mono" : "sans") as LyricStageTheme["fontStyle"],
      fontFamily: fontStack[0] ?? "sans-serif",
      fontFamilyStack: fontStack.length > 0 ? fontStack : ["sans-serif"],
      animationIntensity: (performanceTier === "vivid" ? "chaotic" : performanceTier === "balanced" ? "normal" : "calm") as LyricStageTheme["animationIntensity"],
    };
    const themeKey = JSON.stringify(themeValues);
    if (themeKey !== stageThemeKey) { stageThemeKey = themeKey; stageTheme = themeValues; }

    const metadataValues = { title: currentTrack?.title ?? "", artist: currentTrack?.artist ?? "", album: currentTrack?.albumTitle };
    const metadataKey = JSON.stringify(metadataValues);
    if (metadataKey !== stageMetadataKey) { stageMetadataKey = metadataKey; stageMetadata = metadataValues; }

    const rawColors = rootStyle.getPropertyValue("--generated-colors").trim();
    if (rawColors !== stageCoverColorsKey) {
      stageCoverColorsKey = rawColors;
      try {
        const colors: unknown = JSON.parse(rawColors || "[]");
        stageCoverColors = Array.isArray(colors)
          ? colors.filter((value): value is string => typeof value === "string").slice(0, 8).map(value => toStageColor(value, "#83ddf1"))
          : [];
      } catch { stageCoverColors = []; }
    }
    stageInputsValue = { theme: stageTheme!, metadata: stageMetadata, coverColors: stageCoverColors, performance: performanceTier };
    return stageInputsValue;
  };
  const stageState = (): LyricStageState => ({
    trackId: shownId,
    pack: selectedStagePack,
    ...stageLyrics(),
    durationMs: currentTrack?.durationMs,
    positionMs: lyricPosition(positionMs, offsetMs),
    playing: readAudioClock(shownId)?.playing ?? false,
    ...stageInputs(),
    coverBlob: null,
  });
  const clearStage = () => {
    stageEpoch += 1;
    stageHandle?.destroy();
    stageHandle = null;
    reading.classList.remove("has-lyric-stage");
    delete document.documentElement.dataset.lyricStage;
  };
  const stageFailed = (failedHandle?: LyricStageHandle, expectedEpoch?: number) => {
    if ((failedHandle && stageHandle !== failedHandle) || (expectedEpoch !== undefined && expectedEpoch !== stageEpoch)) return;
    if (selectedStagePack === null) return;
    clearTimeout(stageStatusTimer);
    clearStage();
    selectedStagePack = null;
    stagePicker.value = "";
    stageStatus.textContent = "舞台暂不可用，已恢复常规歌词";
    stageStatus.hidden = false;
    stageStatusTimer = window.setTimeout(() => { stageStatus.hidden = true; }, 5000);
  };
  const syncStage = () => {
    if (selectedStagePack === null) {
      if (stageHandle || reading.classList.contains("has-lyric-stage")) clearStage();
      return;
    }
    if (!hasStageLyrics()) {
      // 新曲的歌词还在路上：保留舞台最后一帧继续显示，不要退回常规歌词页。
      if (stageHandle && !lyricsSettled) {
        stageHandle.setVisible(stageVisible());
        return;
      }
      if (stageHandle || reading.classList.contains("has-lyric-stage")) clearStage();
      return;
    }
    const state = stageState();
    if (document.documentElement.dataset.mobile !== "true") document.documentElement.dataset.lyricStage = selectedStagePack;
    if (stageHandle) {
      stageHandle.update(state);
      stageHandle.setVisible(stageVisible());
      return;
    }
    const epoch = ++stageEpoch;
    stageStatus.textContent = "正在载入歌词舞台…";
    stageStatus.hidden = false;
    try {
      let handle: LyricStageHandle | null = null;
      handle = mountLyricStage(reading, state, () => {
        if (handle && epoch === stageEpoch && stageHandle === handle) stageFailed(handle, epoch);
      });
      stageHandle = handle;
      handle.setVisible(stageVisible());
      void handle.ready.then(() => {
        if (epoch !== stageEpoch || stageHandle !== handle) return;
        const stageHost = reading.querySelector<HTMLElement>(".tide-lyric-stage-host");
        if (reading.querySelector(".tide-lyric-stage-canvas") && stageHost && !stageHost.hidden) {
          reading.classList.add("has-lyric-stage");
          stageStatus.hidden = true;
        }
        else stageFailed(handle, epoch);
      }).catch(() => {
        if (epoch === stageEpoch && stageHandle === handle) stageFailed(handle, epoch);
      });
    } catch {
      stageFailed(undefined, epoch);
    }
  };
  stagePicker.addEventListener("change", () => {
    clearStage();
    selectedStagePack = stagePicker.value ? stagePicker.value as LyricStagePack : null;
    clearTimeout(stageStatusTimer);
    stageStatus.hidden = true;
    syncStage();
  });
  const themeObserver = new MutationObserver(() => { stageInputsDirty = true; if (stageHandle) syncStage(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-color-mode", "data-shell", "data-font", "data-performance", "style"] });
  const tick = (now: number) => {
    paintFrame = 0;
    if (disposed || !isRenderingActive() || document.documentElement.dataset.view !== "playing") return;
    if (linesDirty) renderLines();
    const clock = readAudioClock(shownId);
    lastPaint = now; paint(clock?.positionMs ?? pendingPosition);
    if (clock?.playing) {
      const interval=1000/(document.documentElement.dataset.performance==="vivid"?120:60);
      paintTimer=window.setTimeout(()=>{paintTimer=0;if(!disposed&&isRenderingActive()&&document.documentElement.dataset.view==="playing")paintFrame=requestAnimationFrame(tick);},Math.max(0,interval-(performance.now()-lastPaint)-1));
    }
  };
  const wake = () => {
    stageHandle?.setVisible(stageVisible());
    if (!isRenderingActive() || document.documentElement.dataset.view!=="playing") {cancelAnimationFrame(paintFrame);clearTimeout(paintTimer);paintFrame=paintTimer=0;return;}
    if (!disposed && !paintFrame && !paintTimer) paintFrame = requestAnimationFrame(tick);
  };
  const stopView = onShellView(wake);
  const stopAudioClock = onAudioClockChange(wake);
  document.addEventListener("visibilitychange", wake);
  let active = -1;
  let cueOriginals: LyricLine[] | null = null;
  let cuePairs: ReturnType<typeof pairLyrics> | null = null;
  let lastCueKey = "";
  const invalidateCueCache = () => {
    cueOriginals = null;
    cuePairs = null;
  };
  const publishCurrentLyric = (force = false) => {
    const originals = cueOriginals ??= bundles.yrc.length > 0
      ? bundles.yrc.map((row) => ({ timeMs: row.timeMs, text: row.text }))
      : bundles.original;
    const pairs = cuePairs ??= pairLyrics(originals, bundles.translation);
    const index = currentLyricIndex(originals, lyricPosition(positionMs, offsetMs));
    const originalText = index >= 0 ? originals[index]?.text ?? "" : "";
    const translationText = index >= 0 ? pairs[index]?.translation ?? "" : "";
    const cueKey = `${shownId ?? ""}\u0000${originalText}\u0000${translationText}`;
    if (!force && cueKey === lastCueKey) return;
    lastCueKey = cueKey;
    window.dispatchEvent(new CustomEvent("tide:lyric-current", {
      detail: {
        trackId: shownId,
        original: originalText,
        translation: translationText,
      },
    }));
  };
  const segment=(event:Event)=>{const result=(event as CustomEvent<import("../../core/ai-assist").AiResult>).detail;if(result.task!=="segment")return;const rows=bundles.yrc.length?bundles.yrc.map(row=>({timeMs:row.timeMs,text:row.text})):bundles.original;bundles.yrc=segmentLyricLines(rows,result.segments,bundles.yrc);invalidateCueCache();renderLines();syncStage();publishCurrentLyric();publishDesk();};
  window.addEventListener("tide:segments",segment);
  const usingYrc = (): boolean => (view === "both" || view === "original") && bundles.yrc.length > 0;

  let cachedRows: LyricLine[] | null = null;
  const computeRows = (): LyricLine[] => {
    if (usingYrc()) return bundles.yrc.map((row) => ({ timeMs: row.timeMs, text: row.text }));
    if (view === "both") {
      return pairLyrics(bundles.original, bundles.translation).map((row) => ({
        timeMs: row.timeMs,
        text: row.original,
      }));
    }
    return bundles[view];
  };

  const timedRows = () => cachedRows ??= computeRows();
  const wordPaint = new WeakMap<HTMLElement, string>();

  const publishDesk = () => {
    window.tide.pushDeskLines({
      trackId: shownId ?? "",
      title: title.textContent ?? "",
      original: bundles.original,
      translation: bundles.translation,
      yrc: bundles.yrc,
      offsetMs,
    });
  };

  const paintSweep = (index: number) => {
    const item = list.children.item(index);
    if (!(item instanceof HTMLElement)) return;
    const origin = item.querySelector(".lyric-origin");
    if (!(origin instanceof HTMLElement)) return;
    const at = lyricPosition(positionMs, offsetMs);
    const rows = timedRows();
    const row = rows[index];
    if (!row) return;
    const wordNodes = origin.querySelectorAll<HTMLElement>(".lyric-word");
    const wordLine = usingYrc() ? bundles.yrc[index] : undefined;
    if (wordNodes.length && wordLine) {
      wordNodes.forEach((node, cursor) => {
        const word = wordLine.words[cursor]; const fill = word ? wordFill(word, at) : 0;
        const value = `${(fill * 100).toFixed(2)}%`;
        if (wordPaint.get(node) === value) return;
        wordPaint.set(node, value); node.style.setProperty("--word-fill", value);
        const mask = node.querySelector<HTMLElement>(".word-mask"), hot = node.querySelector<HTMLElement>(".word-hot");
        if (mask && hot) writeLyricSweep(mask, hot, fill);
        node.classList.toggle("is-singing", fill > 0 && fill < 1);
      });
      return;
    }
    const mask = origin.querySelector<HTMLElement>(".lyric-mask");
    const hot = origin.querySelector<HTMLElement>(".lyric-hot");
    if (!mask || !hot) return;
    const yrc = usingYrc() ? bundles.yrc[index] : undefined;
    let progress = 0;
    if (yrc && yrc.words.length > 0) {
      const stored = origin.dataset.widths ?? "";
      const widths = stored.length > 0 ? stored.split(",").map(Number) : yrc.words.map((word) => measureWord(word.text));
      progress = sweepProgress(yrc.words, widths, at);
    } else {
      const next = rows[index + 1]?.timeMs ?? row.timeMs + 4000;
      progress = lineEase(at, row.timeMs, next);
    }
    writeLyricSweep(mask, hot, progress);
  };

  const paint = (nextPosition = positionMs) => {
    positionMs = nextPosition;
    syncStage();
    const lines = timedRows();
    if (lines.length === 0) return;
    const next = currentLyricIndex(lines, lyricPosition(positionMs, offsetMs));
    const changed = next !== active;
    active = next;
    if (changed) publishCurrentLyric();
    if (changed) {
      const items = list.querySelectorAll("li");
      items.forEach((item, index) => {
        item.classList.toggle("lyric-current", index === next);
        item.classList.toggle("lyric-passed", index < next);
        item.style.setProperty("--lyric-distance", String(Math.min(4, Math.abs(index - next))));
        if (index !== next) item.querySelectorAll<HTMLElement>(".lyric-word").forEach(word => {
          const value = index < next ? "100%" : "0%";
          if (wordPaint.get(word) !== value) {
            wordPaint.set(word, value); word.style.setProperty("--word-fill", value);
            const mask = word.querySelector<HTMLElement>(".word-mask"), hot = word.querySelector<HTMLElement>(".word-hot");
            if (mask && hot) writeLyricSweep(mask, hot, index < next ? 1 : 0);
          }
          word.classList.remove("is-singing");
        });
      });
    }
    if ((changed || !resume.hidden) && performance.now() >= manualUntil) {
      resume.hidden = true;
      const current = next >= 0 ? list.children.item(next) : null;
      if (current instanceof HTMLElement) {
        const top = current.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - list.clientHeight * 0.42 + current.clientHeight / 2;
        list.scrollTo({ top: Math.max(0, top), behavior: changed && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
      }
    }
    if (next >= 0) paintSweep(next);
  };

  const showOffset = () => {
    const seconds = offsetMs / 1000;
    offsetLabel.textContent = `偏移 ${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
  };

  const renderLines = () => {
    cachedRows = null;
    linesDirty = true;
    if (!isRenderingActive() || document.documentElement.dataset.view !== "playing") return;
    linesDirty = false;
    active = -1;
    list.replaceChildren();
    both.setAttribute("aria-pressed", view === "both" ? "true" : "false");
    original.setAttribute("aria-pressed", view === "original" ? "true" : "false");
    translation.setAttribute("aria-pressed", view === "translation" ? "true" : "false");
    romaji.setAttribute("aria-pressed", view === "romaji" ? "true" : "false");
    const lines = timedRows();
    if (lines.length === 0) {
      line.textContent = view === "translation"
        ? "这首没有翻译"
        : view === "romaji"
          ? "这首没有罗马音"
          : shownId ? "这首没有歌词" : "播放开始后，歌词会在这里展开。";
      return;
    }
    line.textContent = "";
    if (view === "both" || (view === "original" && usingYrc())) {
      const source = usingYrc()
        ? bundles.yrc.map((row) => ({ timeMs: row.timeMs, text: row.text }))
        : bundles.original;
      const paired = pairLyrics(source, view === "original" ? [] : bundles.translation);
      paired.forEach((row, index) => {
        const item = document.createElement("li");
        const origin = document.createElement("span");
        origin.className = "lyric-origin karaoke";
        origin.dataset.text = row.original;
        const words = usingYrc() ? bundles.yrc[index]?.words ?? [] : [];
        const run = document.createElement("span");
        run.className = "lyric-run";
        run.textContent = row.original;
        const mask = document.createElement("span");
        mask.className = "lyric-mask";
        const hot = document.createElement("span");
        hot.className = "lyric-hot";
        hot.textContent = row.original;
        mask.append(hot);
        if (words.length > 0) {
          for (const word of words) {
            const span = document.createElement("span"); span.className = "lyric-word";
            const base = document.createElement("span"); base.className = "word-base"; base.textContent = word.text;
            const mask = document.createElement("span"); mask.className = "word-mask"; mask.setAttribute("aria-hidden", "true");
            const hot = document.createElement("span"); hot.className = "word-hot"; hot.textContent = word.text;
            mask.append(hot); span.append(base, mask); origin.append(span);
          }
        } else origin.append(run, mask);
        if (words.length > 0) origin.dataset.widths = words.map((word) => String(measureWord(word.text))).join(",");
        item.append(origin);
        if (row.translation.length > 0) {
          const trans = document.createElement("span");
          trans.className = "lyric-trans";
          trans.textContent = row.translation;
          item.append(trans);
        }
        list.append(item);
      });
    } else {
      for (const row of lines) {
        const item = document.createElement("li");
        item.textContent = row.text;
        list.append(item);
      }
    }
    for (const [index, item] of Array.from(list.children).entries()) {
      if (!(item instanceof HTMLElement)) continue;
      const time = lines[index]?.timeMs ?? 0;
      item.tabIndex = 0; item.setAttribute("role", "button"); item.setAttribute("aria-label", `跳转到 ${item.textContent ?? "歌词"}`);
      const jump = () => { manualUntil = 0; resume.hidden = true; void window.tide.seek(Math.max(0, time - offsetMs)); };
      item.addEventListener("click", jump);
      item.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); jump(); } });
    }
    paint();
  };
  const measurements = new WeakMap<HTMLElement, string>();
  const measureLines = () => {
    if (!isRenderingActive() || document.documentElement.dataset.view !== "playing") return;
    let changed = false;
    for (const origin of Array.from(list.querySelectorAll<HTMLElement>(".lyric-origin"))) {
      const style = getComputedStyle(origin), height = Number.parseFloat(style.lineHeight) || 52;
      const key = `${origin.clientWidth}:${style.font}:${origin.dataset.text}`;
      if (measurements.get(origin) === key) continue;
      measurements.set(origin, key); changed = true;
      const measured = measureTextLayout(origin.dataset.text ?? "", style.font || "40px sans-serif", origin.clientWidth, height);
      origin.style.minHeight = `${measured.height}px`;
      origin.dataset.measuredLines = String(measured.lineCount);
    }
    if (changed && performance.now() >= manualUntil) { active = -1; paint(); }
  };
  const layoutObserver = new ResizeObserver(measureLines); layoutObserver.observe(list);
  resume.addEventListener("click", () => { manualUntil = 0; active = -1; paint(); });

  const choose = (next: LyricView) => {
    view = next;
    syncStage();
    renderLines();showOptions(false);
  };

  both.addEventListener("click", () => choose("both"));
  original.addEventListener("click", () => choose("original"));
  translation.addEventListener("click", () => choose("translation"));
  romaji.addEventListener("click", () => choose("romaji"));
  earlier.addEventListener("click", () => {
    offsetMs = nextLyricOffset(offsetMs, -1);
    showOffset();
    active = -1;
    paint();
    publishDesk();
  });
  later.addEventListener("click", () => {
    offsetMs = nextLyricOffset(offsetMs, 1);
    showOffset();
    active = -1;
    paint();
    publishDesk();
  });
  showOffset();

  const setTrack = (track: Track | null) => {
    const id = track?.id ?? null;
    if (currentTrack?.id !== id || currentTrack?.title !== track?.title || currentTrack?.artist !== track?.artist || currentTrack?.albumTitle !== track?.albumTitle) stageInputsDirty = true;
    currentTrack = track;
    if (id === shownId) {
      if (track) {
        if (title.textContent !== track.title) title.textContent = track.title; setArtists(track.artist);
        if (artCover.dataset.cover !== (track.cover ?? "")) { paintCover(artCover, track.cover); artCover.dataset.cover = track.cover ?? ""; }
      }
      syncStage();
      return;
    }
    shownId = id;
    lyricsSettled = false;
    generation += 1;
    const token = generation;
    bundles = { original: [], translation: [], romaji: [], yrc: [] };
    invalidateCueCache();
    active = -1;
    publishCurrentLyric(true);
    syncStage();
    list.replaceChildren();
    if (!track) {
      setAiTrack(null);title.textContent = "歌词层";
      setArtists("");sourceNote.textContent="";
      paintCover(artCover, undefined); artCover.dataset.cover = "";
      publishDesk();
      renderLines();
      return;
    }
    setAiTrack(track);title.textContent = track.title;
    setArtists(track.artist);
    paintCover(artCover, track.cover);
    artCover.dataset.cover = track.cover ?? "";
    sourceNote.textContent = "正在获取歌词";
    line.textContent = "正在读取歌词…";
    publishDesk();
    const cachedLyric = lyricCache.get(track.id);
    const pendingLyric = cachedLyric ? Promise.resolve<LyricPayload | { ok: false; message?: string }>(cachedLyric) : window.tide.lyric(track.id);
    prefetchNeighbours(track.id);
    void pendingLyric.then((result) => {
      if (token !== generation) return;
      lyricsSettled = true;
      if (!result.ok) {
        sourceNote.textContent = "暂无可用歌词";
        syncStage();
        renderLines();
        publishDesk();
        return;
      }
      lyricCache.set(result.trackId, result);
      bundles = {
        original: result.lines,
        translation: result.translation ?? [],
        romaji: result.romaji ?? [],
        yrc: result.yrc ?? [],
      };
      invalidateCueCache();
      syncStage();
      setAiLines((bundles.yrc.length?bundles.yrc:bundles.original).map(row=>row.text));
      sourceNote.textContent = result.source === "amll" ? `AMLL TTML DB${result.credits?.length ? ` · ${result.credits.join(" / ")}` : ""}` : "网易云歌词";
      renderLines();
      measureLines();
      publishCurrentLyric();
      publishDesk();
    }).catch(() => {
      if (token !== generation) return;
      lyricsSettled = true;
      sourceNote.textContent = "歌词暂不可用";
      syncStage();
      renderLines();
      publishDesk();
    });
  };

  setTrack(null);

  return {
    setTrack,
    setPosition(nextPosition: number) {
      pendingPosition = nextPosition;
      // Keep the home lyric in sync from the existing playback snapshots,
      // even when the full lyric renderer is dormant outside the playing view.
      positionMs = nextPosition;
      syncStage();
      publishCurrentLyric();
      wake();
    },
    captureStageFrame: () => stageHandle?.captureFrame() ?? Promise.resolve(null),
    destroy: () => {
      disposed = true; stopView(); stopAudioClock(); document.removeEventListener("visibilitychange", wake);
      if (paintFrame !== 0) cancelAnimationFrame(paintFrame);
      clearTimeout(paintTimer);
      layoutObserver.disconnect();
      themeObserver.disconnect();
      clearTimeout(stageStatusTimer);
      clearStage();
      window.removeEventListener("tide:segments",segment);
      stopCoverHalftone();
      root.replaceChildren();
    },
  };
}

let wordCanvas: CanvasRenderingContext2D | null = null;
const sweepLayouts = new WeakMap<HTMLElement, {key:string; rows:{width:number;top:number;bottom:number}[]}>();

/** One compositor sweep. The mask and the fill counter-scale so the edge can stop inside a glyph. */
function writeLyricSweep(mask: HTMLElement, hot: HTMLElement, progress: number): void {
  const amount = Math.min(1, Math.max(0, progress));
  const parent = mask.parentElement;
  const base = parent?.querySelector<HTMLElement>(".word-base,.lyric-run");
  if (parent && base) {
    const key = `${parent.clientWidth}:${parent.clientHeight}:${getComputedStyle(parent).font}`;
    let layout = sweepLayouts.get(mask);
    if (!layout || layout.key !== key) {
      const bounds = parent.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(base);
      const rows: {width:number;top:number;bottom:number}[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue;
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.top - (rect.top - bounds.top)) < 2) last.width += rect.width;
        else rows.push({width:rect.width,top:rect.top-bounds.top,bottom:rect.bottom-bounds.top});
      }
      layout = {key,rows}; sweepLayouts.set(mask,layout);
    }
    if (layout.rows.length > 1) {
      // A horizontal scale reveals the same x-coordinate on every wrapped row.
      // Consume visual row widths in reading order, revealing only completed rows.
      let remaining = amount * layout.rows.reduce((sum,row)=>sum+row.width,0);
      let row = layout.rows[0]!;
      for (const candidate of layout.rows) { row=candidate; if (remaining <= row.width) break; remaining-=row.width; }
      const x = Math.max(0,Math.min(row.width,remaining));
      const height = parent.getBoundingClientRect().height;
      const top = Math.max(0,row.top - 2), bottom = Math.min(height,row.bottom + 2);
      mask.style.opacity = amount <= .001 ? "0" : "1";
      mask.style.transform = "none"; hot.style.transform = "none";
      mask.style.clipPath = amount >= .999 ? "none" : `polygon(0 0,100% 0,100% ${top}px,${x}px ${top}px,${x}px ${bottom}px,0 ${bottom}px)`;
      return;
    }
  }
  mask.style.clipPath = "none";
  if (amount <= 0.001) {
    mask.style.opacity = "0";
    return;
  }
  const scale = amount >= 0.999 ? 1 : amount;
  mask.style.opacity = "1";
  mask.style.transform = `scaleX(${scale})`;
  hot.style.transform = `scaleX(${scale === 1 ? 1 : 1 / scale})`;
}

function measureWord(text: string): number {
  wordCanvas ??= document.createElement("canvas").getContext("2d");
  if (!wordCanvas) return Math.max(1, text.length);
  wordCanvas.font = "40px Segoe UI, PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif";
  return Math.max(1, wordCanvas.measureText(text).width);
}

function viewButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button lyric-toggle";
  button.textContent = label;
  return button;
}
