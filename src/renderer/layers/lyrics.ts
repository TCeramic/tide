import { currentLyricIndex, lineEase, lyricPosition, nextLyricOffset, pairLyrics, sweepProgress, type LyricLine } from "../../core/lyrics";
import type { YrcLine } from "../../shared/contract";
import type { DeskLyricsSettings } from "../../core/desk-lyrics";
import type { Track } from "../../core/playback/types";
import { Music2 } from "lucide";
import { ICON_SIZE, prependIcon } from "../icons";

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

  block.append(kicker, title, tools, offsetMenu, line, list);
  root.append(block);

  let generation = 0;
  let shownId: string | null = null;
  let view: LyricView = "both";
  let offsetMs = 0;
  let positionMs = 0;
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[], yrc: [] as YrcLine[] };
  let pendingPosition = 0;
  let paintFrame = 0;
  let active = -1;
  let deskOpen = false;

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
      });
      const current = next >= 0 ? items.item(next) : null;
      if (current instanceof HTMLElement) {
        const top = current.offsetTop - list.clientHeight / 2 + current.clientHeight / 2;
        list.scrollTo({ top: Math.max(0, top), behavior: "auto" });
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
        origin.append(run, mask);
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
    paint();
  };

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
      if (track) title.textContent = track.title;
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
      publishDesk();
      renderLines();
      return;
    }
    title.textContent = track.title;
    line.textContent = "正在读取歌词…";
    publishDesk();
    void window.tide.lyric(track.id).then((result) => {
      if (token !== generation) return;
      if (!result.ok) {
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
      renderLines();
      publishDesk();
    }).catch(() => {
      if (token !== generation) return;
      renderLines();
      publishDesk();
    });
  };

  setTrack(null);

  return {
    setTrack,
    setPosition(positionMs: number) {
      pendingPosition = positionMs;
      if (paintFrame !== 0) return;
      paintFrame = requestAnimationFrame(() => {
        paintFrame = 0;
        paint(pendingPosition);
      });
    },
    destroy: () => {
      if (paintFrame !== 0) cancelAnimationFrame(paintFrame);
      stopDesk();
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
