import { isRenderingActive } from "../render-activity";
import { currentLyricIndex, lineEase, lyricPosition, nextLyricOffset, pairLyrics, sweepProgress, wordFill, type LyricLine } from "../../core/lyrics";
import type { YrcLine } from "../../shared/contract";
import type { Track } from "../../core/playback/types";
import { MoreHorizontal } from "lucide";
import { ICON_SIZE, iconButton } from "../icons";
import { paintCover } from "../cover";
import { measureTextLayout } from "../text-metrics";
import { setAiTrack,setAiLines } from "../ai-context";
import { segmentLyricLines } from "../../core/ai-assist";
import { readAudioClock, onAudioClockChange } from "../audio-clock";
import { onShellView, toggleNowPlaying } from "../view";

type LyricView = "both" | "original" | "translation" | "romaji";

/** Full lyric text. Default is original stacked with translation. */
export function mountLyrics(root: HTMLElement): {
  setTrack: (track: Track | null) => void;
  setPosition: (positionMs: number) => void;
  destroy: () => void;
} {
  root.replaceChildren();

  const block = document.createElement("div");
  block.className = "lyrics-block";

  const kicker = document.createElement("p");
  kicker.className = "lyrics-kicker";
  kicker.setAttribute("aria-label","潮汐波动");
  const wave=document.createElementNS("http://www.w3.org/2000/svg","svg");wave.setAttribute("viewBox","0 0 160 34");wave.setAttribute("aria-hidden","true");
  for(let i=0;i<3;i++){const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",`M-20 ${12+i*6} Q0 ${-2+i*6} 20 ${12+i*6} T60 ${12+i*6} T100 ${12+i*6} T140 ${12+i*6} T180 ${12+i*6}`);path.setAttribute("fill","none");path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width",String(1.6-i*.35));path.style.animationDelay=`${i*-.6}s`;wave.append(path);}kicker.append(wave);

  const title = document.createElement("p");
  title.className = "lyrics-title";
  const art = document.createElement("div"); art.className = "lyrics-art";
  const artCover = document.createElement("button"); artCover.type = "button"; artCover.className = "lyrics-cover";
  artCover.setAttribute("aria-label", "返回上一页"); artCover.title = "返回上一页";
  artCover.addEventListener("click", toggleNowPlaying); paintCover(artCover, undefined);
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
  const optionsPanel=document.createElement("div");optionsPanel.className="lyric-options-panel";optionsPanel.hidden=true;optionsPanel.append(tools,offsetMenu);
  const showOptions=(open:boolean)=>{optionsPanel.hidden=!open;options.setAttribute("aria-expanded",String(open));};options.addEventListener("click",()=>{showOptions(optionsPanel.hidden);options.blur();});optionsPanel.addEventListener("pointerleave",()=>showOptions(false));
  reading.append(options,optionsPanel,line,list,resume);
  block.append(art, reading);
  root.append(block);

  let generation = 0;
  let shownId: string | null = null;
  let view: LyricView = "both";
  let offsetMs = 0;
  let positionMs = 0;
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[], yrc: [] as YrcLine[] };
  let pendingPosition = 0;
  let paintFrame = 0, paintTimer = 0, lastPaint = 0;
  let disposed = false, linesDirty = true;
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
    if (!isRenderingActive() || document.documentElement.dataset.view!=="playing") {cancelAnimationFrame(paintFrame);clearTimeout(paintTimer);paintFrame=paintTimer=0;return;}
    if (!disposed && !paintFrame && !paintTimer) paintFrame = requestAnimationFrame(tick);
  };
  const stopView = onShellView(wake);
  const stopAudioClock = onAudioClockChange(wake);
  document.addEventListener("visibilitychange", wake);
  let active = -1;
  const segment=(event:Event)=>{const result=(event as CustomEvent<import("../../core/ai-assist").AiResult>).detail;if(result.task!=="segment")return;const rows=bundles.yrc.length?bundles.yrc.map(row=>({timeMs:row.timeMs,text:row.text})):bundles.original;bundles.yrc=segmentLyricLines(rows,result.segments,bundles.yrc);renderLines();publishDesk();};
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
    const lines = timedRows();
    if (lines.length === 0) return;
    const next = currentLyricIndex(lines, lyricPosition(positionMs, offsetMs));
    const changed = next !== active;
    active = next;
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
    if (id === shownId) {
      if (track) {
        if (title.textContent !== track.title) title.textContent = track.title; setArtists(track.artist);
        if (artCover.dataset.cover !== (track.cover ?? "")) { paintCover(artCover, track.cover); artCover.dataset.cover = track.cover ?? ""; }
      }
      return;
    }
    shownId = id;
    generation += 1;
    const token = generation;
    bundles = { original: [], translation: [], romaji: [], yrc: [] };
    active = -1;
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
    void window.tide.lyric(track.id).then((result) => {
      if (token !== generation) return;
      if (!result.ok) {
        sourceNote.textContent = "暂无可用歌词";
        renderLines();
        publishDesk();
        return;
      }
      bundles = {
        original: result.lines,
        translation: result.translation ?? [],
        romaji: result.romaji ?? [],
        yrc: result.yrc ?? [],
      };
      setAiLines((bundles.yrc.length?bundles.yrc:bundles.original).map(row=>row.text));
      sourceNote.textContent = result.source === "amll" ? `AMLL TTML DB${result.credits?.length ? ` · ${result.credits.join(" / ")}` : ""}` : "网易云歌词";
      renderLines();
      measureLines();
      publishDesk();
    }).catch(() => {
      if (token !== generation) return;
      sourceNote.textContent = "歌词暂不可用";
      renderLines();
      publishDesk();
    });
  };

  setTrack(null);

  return {
    setTrack,
    setPosition(positionMs: number) {
      pendingPosition = positionMs;
      wake();
    },
    destroy: () => {
      disposed = true; stopView(); stopAudioClock(); document.removeEventListener("visibilitychange", wake);
      if (paintFrame !== 0) cancelAnimationFrame(paintFrame);
      clearTimeout(paintTimer);
      layoutObserver.disconnect();
      window.removeEventListener("tide:segments",segment);
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
