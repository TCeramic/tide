import { currentLyricIndex, lyricPosition, nextLyricOffset, type LyricLine } from "../../core/lyrics";
import type { Track } from "../../core/playback/types";

type LyricView = "original" | "translation" | "romaji";

/** Full lyric text, with translation, romaji, and a half-second offset. */
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
  const original = viewButton("原文");
  const translation = viewButton("翻译");
  const romaji = viewButton("罗马音");
  const earlier = viewButton("−0.5s");
  const later = viewButton("+0.5s");
  const offsetLabel = document.createElement("span");
  offsetLabel.className = "lyric-offset";
  tools.append(original, translation, romaji, earlier, later, offsetLabel);

  const line = document.createElement("p");
  line.className = "lyrics-line";

  const list = document.createElement("ol");
  list.className = "lyric-list";

  block.append(kicker, title, tools, line, list);
  root.append(block);

  let generation = 0;
  let shownId: string | null = null;
  let view: LyricView = "original";
  let offsetMs = 0;
  let positionMs = 0;
  let bundles = { original: [] as LyricLine[], translation: [] as LyricLine[], romaji: [] as LyricLine[] };
  let active = -1;

  const selected = () => bundles[view];

  const paint = (nextPosition = positionMs) => {
    positionMs = nextPosition;
    const lines = selected();
    if (lines.length === 0) return;
    const next = currentLyricIndex(lines, lyricPosition(positionMs, offsetMs));
    if (next === active) return;
    active = next;
    const items = list.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("lyric-current", index === next);
    });
    const current = next >= 0 ? items.item(next) : null;
    if (current instanceof HTMLElement) current.scrollIntoView({ block: "nearest" });
  };

  const showOffset = () => {
    const seconds = offsetMs / 1000;
    offsetLabel.textContent = `偏移 ${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
  };

  const renderLines = () => {
    active = -1;
    list.replaceChildren();
    const lines = selected();
    original.setAttribute("aria-pressed", view === "original" ? "true" : "false");
    translation.setAttribute("aria-pressed", view === "translation" ? "true" : "false");
    romaji.setAttribute("aria-pressed", view === "romaji" ? "true" : "false");
    if (lines.length === 0) {
      line.textContent = view === "translation"
        ? "这首没有翻译"
        : view === "romaji"
          ? "这首没有罗马音"
          : shownId ? "这首没有歌词" : "播放开始后，歌词会在这里展开。";
      return;
    }
    line.textContent = "";
    for (const row of lines) {
      const item = document.createElement("li");
      item.textContent = row.text;
      list.append(item);
    }
    paint();
  };

  const choose = (next: LyricView) => {
    view = next;
    renderLines();
  };

  original.addEventListener("click", () => choose("original"));
  translation.addEventListener("click", () => choose("translation"));
  romaji.addEventListener("click", () => choose("romaji"));
  earlier.addEventListener("click", () => {
    offsetMs = nextLyricOffset(offsetMs, -1);
    showOffset();
    active = -1;
    paint();
  });
  later.addEventListener("click", () => {
    offsetMs = nextLyricOffset(offsetMs, 1);
    showOffset();
    active = -1;
    paint();
  });
  showOffset();

  const setTrack = (track: Track | null) => {
    const id = track?.id ?? null;
    if (id === shownId) {
      if (track) title.textContent = track.title;
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
      renderLines();
      return;
    }
    title.textContent = track.title;
    line.textContent = "正在读取歌词…";
    void window.tide.lyric(track.id).then((result) => {
      if (token !== generation) return;
      if (!result.ok) {
        renderLines();
        return;
      }
      bundles = {
        original: result.lines,
        translation: result.translation ?? [],
        romaji: result.romaji ?? [],
      };
      renderLines();
    }).catch(() => {
      if (token !== generation) return;
      renderLines();
    });
  };

  setTrack(null);

  return {
    setTrack,
    setPosition: paint,
    destroy: () => root.replaceChildren(),
  };
}

function viewButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button lyric-toggle";
  button.textContent = label;
  return button;
}
