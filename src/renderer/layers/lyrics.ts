import { isRenderingActive } from "../render-activity";
import { currentLyricIndex, lineEase, lyricPosition, nextLyricOffset, pairLyrics, sweepProgress, wordFill, type LyricLine } from "../../core/lyrics";
import type { YrcLine } from "../../shared/contract";
import type { DeskLyricsSettings } from "../../core/desk-lyrics";
import type { Track } from "../../core/playback/types";
import { Music2 } from "lucide";
import { ICON_SIZE, prependIcon } from "../icons";
import { paintCover } from "../cover";
import { measureTextLayout } from "../text-metrics";
import { mountAiAssist } from "../ai-assist";
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
  kicker.textContent = "潮汐 Tide";
  prependIcon(kicker, "Music2", Music2, ICON_SIZE.row);

  const title = document.createElement("p");
  title.className = "lyrics-title";
  const art = document.createElement("div"); art.className = "lyrics-art";
  const artCover = document.createElement("button"); artCover.type = "button"; artCover.className = "lyrics-cover";
  artCover.setAttribute("aria-label", "返回上一页"); artCover.title = "返回上一页";
  artCover.addEventListener("click", toggleNowPlaying); paintCover(artCover, undefined);
  const artist = document.createElement("p"); artist.className = "lyrics-artist";
  const sourceNote = document.createElement("p"); sourceNote.className = "lyrics-source";
  const reading = document.createElement("div"); reading.className = "lyrics-reading";

  const tools = document.createElement("div");
  tools.className = "lyric-tools";
  const both = viewButton("双语");
  const original = viewButton("原文");
  const translation = viewButton("翻译");
  const romaji = viewButton("罗马音");
  const deskToggle = viewButton("桌面歌词");
  const deskMenu = document.createElement("details");
  deskMenu.className = "desk-menu";
  deskMenu.hidden = true;
  const deskSummary = document.createElement("summary");
  deskSummary.textContent = "桌面歌词";
  deskMenu.append(deskSummary, deskMenuBody());
  tools.append(both, original, translation, romaji, deskToggle, deskMenu);

  const offsetMenu = document.createElement("details");
  offsetMenu.className = "lyric-offset-menu";
  const offsetSummary = document.createElement("summary");
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

  art.append(artCover, kicker, title, artist, sourceNote);
  reading.append(tools, offsetMenu, line, list, resume);
  block.append(art, reading);
  root.append(block);

  let generation = 0;
  let shownId: string | null = null;
  let view: LyricView = "both";
  let offsetMs = 0;
  let positionMs = 0;
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[], yrc: [] as YrcLine[] };
  let pendingPosition = 0;
  let paintFrame = 0;
  let disposed = false;
  const tick = () => {
    paintFrame = 0;
    if (disposed || !isRenderingActive() || document.documentElement.dataset.view !== "playing") return;
    const clock = readAudioClock(shownId);
    paint(clock?.positionMs ?? pendingPosition);
    if (clock?.playing) paintFrame = requestAnimationFrame(tick);
  };
  const wake = () => { if (!disposed && !paintFrame) paintFrame = requestAnimationFrame(tick); };
  const stopView = onShellView(wake);
  const stopAudioClock = onAudioClockChange(wake);
  document.addEventListener("visibilitychange", wake);
  let active = -1;
  let deskOpen = false;
  const assist = mountAiAssist(task => ({ task, title: title.textContent ?? "", lines: (bundles.yrc.length ? bundles.yrc : bundles.original).map(row => row.text) }), () => artCover.dataset.cover, result => {
    if (result.task !== "segment") return;
    const rows = bundles.yrc.length ? bundles.yrc.map(row => ({ timeMs: row.timeMs, text: row.text })) : bundles.original;
    bundles.yrc = segmentLyricLines(rows, result.segments, bundles.yrc);
    sourceNote.textContent = bundles.yrc.some(row => row.estimated) ? "AI 分词 · 逐词时间为估算" : "AI 分词 · 保留原始逐词时间";
    renderLines(); publishDesk();
  });
  art.append(assist.element);

  const usingYrc = (): boolean => (view === "both" || view === "original") && bundles.yrc.length > 0;

  const timedRows = (): LyricLine[] => {
    if (usingYrc()) return bundles.yrc.map((row) => ({ timeMs: row.timeMs, text: row.text }));
    if (view === "both") {
      return pairLyrics(bundles.original, bundles.translation).map((row) => ({
        timeMs: row.timeMs,
        text: row.original,
      }));
    }
    return bundles[view];
  };

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
        node.style.setProperty("--word-fill", `${(fill * 100).toFixed(2)}%`);
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
          word.style.setProperty("--word-fill", index < next ? "100%" : "0%");
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
          for (const word of words) { const span = document.createElement("span"); span.className = "lyric-word"; span.textContent = word.text; origin.append(span); }
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
  const measureLines = () => {
    for (const origin of Array.from(list.querySelectorAll<HTMLElement>(".lyric-origin"))) {
      const style = getComputedStyle(origin), height = Number.parseFloat(style.lineHeight) || 52;
      const measured = measureTextLayout(origin.dataset.text ?? "", style.font || "40px sans-serif", origin.clientWidth, height);
      origin.style.minHeight = `${measured.height}px`;
      origin.dataset.measuredLines = String(measured.lineCount);
    }
    if (performance.now() >= manualUntil) { active = -1; paint(); }
  };
  const layoutObserver = new ResizeObserver(measureLines); layoutObserver.observe(list);
  resume.addEventListener("click", () => { manualUntil = 0; active = -1; paint(); });

  const choose = (next: LyricView) => {
    view = next;
    renderLines();
  };

  const syncDeskButton = (settings: DeskLyricsSettings) => {
    deskOpen = settings.open;
    deskToggle.setAttribute("aria-pressed", settings.open ? "true" : "false");
    const wasHidden = deskMenu.hidden;
    deskMenu.hidden = !settings.open;
    if (settings.open && wasHidden) deskMenu.open = true;
    paintDeskMenu(deskMenu, settings);
  };

  both.addEventListener("click", () => choose("both"));
  original.addEventListener("click", () => choose("original"));
  translation.addEventListener("click", () => choose("translation"));
  romaji.addEventListener("click", () => choose("romaji"));
  deskToggle.addEventListener("click", () => {
    void window.tide.setDeskLyrics({ open: !deskOpen }).then(syncDeskButton);
  });
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
  const stopDesk = window.tide.onDeskState(syncDeskButton);
  void window.tide.getDeskLyrics().then(syncDeskButton);

  const setTrack = (track: Track | null) => {
    const id = track?.id ?? null;
    if (id === shownId) {
      if (track) {
        title.textContent = track.title; artist.textContent = track.artist;
        if (artCover.dataset.cover !== (track.cover ?? "")) { paintCover(artCover, track.cover); artCover.dataset.cover = track.cover ?? ""; }
      }
      publishDesk();
      return;
    }
    shownId = id;
    generation += 1;
    const token = generation;
    bundles = { original: [], translation: [], romaji: [], yrc: [] };
    active = -1;
    list.replaceChildren();
    if (!track) {
      title.textContent = "歌词层";
      artist.textContent = sourceNote.textContent = "";
      paintCover(artCover, undefined); artCover.dataset.cover = "";
      publishDesk();
      renderLines();
      return;
    }
    title.textContent = track.title;
    artist.textContent = track.artist;
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
      stopDesk();
      layoutObserver.disconnect();
      assist.destroy();
      root.replaceChildren();
    },
  };
}

let wordCanvas: CanvasRenderingContext2D | null = null;

/** One compositor sweep. The mask and the fill counter-scale so the edge can stop inside a glyph. */
function writeLyricSweep(mask: HTMLElement, hot: HTMLElement, progress: number): void {
  const amount = Math.min(1, Math.max(0, progress));
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

function deskMenuBody(): HTMLElement {
  const body = document.createElement("div");
  body.className = "desk-menu-body";
  const row = (label: string, key: "highlightFollow" | "motion" | "pair" | "wave" | "locked", pressed: boolean) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.dataset.desk = key;
    button.textContent = label;
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    button.addEventListener("click", () => {
      const on = button.getAttribute("aria-pressed") !== "true";
      void window.tide.setDeskLyrics({ [key]: on });
    });
    return button;
  };
  const orient = (label: string, value: "horizontal" | "vertical") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.dataset.desk = "orientation";
    button.dataset.value = value;
    button.textContent = label;
    button.setAttribute("aria-pressed", value === "horizontal" ? "true" : "false");
    button.addEventListener("click", () => {
      void window.tide.setDeskLyrics({ orientation: value });
    });
    return button;
  };
  body.append(
    orient("横列", "horizontal"),
    orient("竖列", "vertical"),
    row("字内扫过", "highlightFollow", true),
    row("动效", "motion", true),
    row("双行译文", "pair", false),
    row("字后波形", "wave", false),
    row("锁定", "locked", false),
  );
  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.min = "20";
  opacity.max = "100";
  opacity.value = "100";
  opacity.dataset.desk = "opacity";
  opacity.setAttribute("aria-label", "桌面歌词透明度");
  opacity.addEventListener("change", () => {
    void window.tide.setDeskLyrics({ opacity: Number(opacity.value) / 100 });
  });
  const glow = document.createElement("input");
  glow.type = "range";
  glow.min = "0";
  glow.max = "100";
  glow.value = "72";
  glow.dataset.desk = "glow";
  glow.setAttribute("aria-label", "桌面歌词光晕");
  glow.addEventListener("change", () => {
    void window.tide.setDeskLyrics({ glow: Number(glow.value) / 100 });
  });
  const motionLevel = document.createElement("input");
  motionLevel.type = "range";
  motionLevel.min = "35";
  motionLevel.max = "100";
  motionLevel.value = "100";
  motionLevel.dataset.desk = "motionLevel";
  motionLevel.setAttribute("aria-label", "桌面歌词动效强度");
  motionLevel.addEventListener("change", () => {
    void window.tide.setDeskLyrics({ motionLevel: Number(motionLevel.value) / 100 });
  });
  const backdrop = document.createElement("input");
  backdrop.type = "range";
  backdrop.min = "0";
  backdrop.max = "55";
  backdrop.value = "0";
  backdrop.dataset.desk = "backdrop";
  backdrop.setAttribute("aria-label", "桌面歌词背景");
  backdrop.addEventListener("change", () => {
    void window.tide.setDeskLyrics({ backdrop: Number(backdrop.value) / 100 });
  });
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "text-button";
  hide.textContent = "隐藏";
  hide.addEventListener("click", () => {
    void window.tide.setDeskLyrics({ open: false });
  });
  body.append(opacity, glow, motionLevel, backdrop, hide);
  return body;
}

function paintDeskMenu(menu: HTMLElement, settings: DeskLyricsSettings): void {
  menu.querySelectorAll<HTMLButtonElement>("button[data-desk]").forEach((button) => {
    const key = button.dataset.desk;
    if (key === "highlightFollow" || key === "motion" || key === "pair" || key === "wave" || key === "locked") {
      button.setAttribute("aria-pressed", settings[key] ? "true" : "false");
    }
    if (key === "orientation") {
      button.setAttribute("aria-pressed", button.dataset.value === settings.orientation ? "true" : "false");
    }
  });
  const opacity = menu.querySelector<HTMLInputElement>("input[data-desk=opacity]");
  const glow = menu.querySelector<HTMLInputElement>("input[data-desk=glow]");
  const motionLevel = menu.querySelector<HTMLInputElement>("input[data-desk=motionLevel]");
  const backdrop = menu.querySelector<HTMLInputElement>("input[data-desk=backdrop]");
  if (opacity && document.activeElement !== opacity) opacity.value = String(Math.round(settings.opacity * 100));
  if (glow && document.activeElement !== glow) glow.value = String(Math.round(settings.glow * 100));
  if (motionLevel && document.activeElement !== motionLevel) motionLevel.value = String(Math.round(settings.motionLevel * 100));
  if (backdrop && document.activeElement !== backdrop) backdrop.value = String(Math.round(settings.backdrop * 100));
}

function viewButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button lyric-toggle";
  button.textContent = label;
  return button;
}
