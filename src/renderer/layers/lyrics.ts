import { currentLyricIndex, type LyricLine } from "../../core/lyrics";
import type { Track } from "../../core/playback/types";

/** Full lyric text. The current line follows playback. A missing lyric stays on this layer. */
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

  const line = document.createElement("p");
  line.className = "lyrics-line";

  const list = document.createElement("ol");
  list.className = "lyric-list";

  block.append(kicker, title, line, list);
  root.append(block);

  let generation = 0;
  let shownId: string | null = null;
  let lines: LyricLine[] = [];
  let active = -1;

  const paint = (positionMs: number) => {
    if (lines.length === 0) return;
    const next = currentLyricIndex(lines, positionMs);
    if (next === active) return;
    active = next;
    const items = list.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("lyric-current", index === next);
    });
    const current = next >= 0 ? items.item(next) : null;
    if (current instanceof HTMLElement) current.scrollIntoView({ block: "nearest" });
  };

  const setTrack = (track: Track | null) => {
    const id = track?.id ?? null;
    if (id === shownId) {
      if (track) title.textContent = track.title;
      return;
    }
    shownId = id;
    generation += 1;
    const token = generation;
    lines = [];
    active = -1;
    list.replaceChildren();
    if (!track) {
      title.textContent = "歌词层";
      line.textContent = "播放开始后，歌词会在这里展开。";
      return;
    }
    title.textContent = track.title;
    line.textContent = "正在读取歌词…";
    void window.tide.lyric(track.id).then((result) => {
      if (token !== generation) return;
      if (!result.ok || result.lines.length === 0) {
        line.textContent = "这首没有歌词";
        return;
      }
      lines = result.lines;
      line.textContent = "";
      for (const row of lines) {
        const item = document.createElement("li");
        item.textContent = row.text;
        list.append(item);
      }
      paint(0);
    }).catch(() => {
      if (token !== generation) return;
      line.textContent = "这首没有歌词";
    });
  };

  setTrack(null);

  return {
    setTrack,
    setPosition: paint,
    destroy: () => root.replaceChildren(),
  };
}
