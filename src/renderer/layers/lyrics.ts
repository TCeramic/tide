import type { Track } from "../../core/playback/types";

/** Lyric layer. Real lines arrive with a later milestone. */
export function mountLyrics(root: HTMLElement): { setTrack: (track: Track | null) => void; destroy: () => void } {
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

  block.append(kicker, title, line);
  root.append(block);

  const setTrack = (track: Track | null) => {
    if (!track) {
      title.textContent = "歌词层";
      line.textContent = "播放开始后，歌词会在这里展开。";
      return;
    }
    title.textContent = track.title;
    line.textContent = `${track.artist} · 歌词将随曲目在这里展开`;
  };

  setTrack(null);

  return {
    setTrack,
    destroy: () => root.replaceChildren(),
  };
}
