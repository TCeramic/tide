import { currentLyricIndex, lyricPosition, nextLyricOffset, pairLyrics, type LyricLine } from "../../core/lyrics";
import type { DeskLyricsSettings } from "../../core/desk-lyrics";
import type { Track } from "../../core/playback/types";

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

  const title = document.createElement("p");
  title.className = "lyrics-title";

  const tools = document.createElement("div");
  tools.className = "lyric-tools";
  const both = viewButton("双语");
  const original = viewButton("原文");
  const translation = viewButton("翻译");
  const romaji = viewButton("罗马音");
  const deskToggle = viewButton("桌面歌词");
  tools.append(both, original, translation, romaji, deskToggle);

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
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[] };
  let active = -1;
  let deskOpen = false;

  const timedRows = (): LyricLine[] => {
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
      offsetMs,
    });
  };

  const paint = (nextPosition = positionMs) => {
    positionMs = nextPosition;
    const lines = timedRows();
    if (lines.length === 0) return;
    const next = currentLyricIndex(lines, lyricPosition(positionMs, offsetMs));
    if (next === active) return;
    active = next;
    const items = list.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("lyric-current", index === next);
    });
    const current = next >= 0 ? items.item(next) : null;
    if (current instanceof HTMLElement) current.scrollIntoView({ block: "center" });
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
    if (view === "both") {
      for (const row of pairLyrics(bundles.original, bundles.translation)) {
        const item = document.createElement("li");
        const origin = document.createElement("span");
        origin.className = "lyric-origin";
        origin.textContent = row.original;
        item.append(origin);
        if (row.translation.length > 0) {
          const trans = document.createElement("span");
          trans.className = "lyric-trans";
          trans.textContent = row.translation;
          item.append(trans);
        }
        list.append(item);
      }
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
    bundles = { original: [], translation: [], romaji: [] };
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
    setPosition: paint,
    destroy: () => {
      stopDesk();
      root.replaceChildren();
    },
  };
}

function viewButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button lyric-toggle";
  button.textContent = label;
  return button;
}
