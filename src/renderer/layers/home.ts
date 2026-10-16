import type { PlaybackSnapshot, SearchHit, SessionSnapshot } from "../../shared/contract";
import { paintCover } from "../cover";
import { openNowPlaying } from "../view";

export interface HomeHooks {
  onPlaylists: () => void;
  onDaily: () => void;
  onTide: () => void;
  onLocal: () => void;
  onProof: () => void;
}

/** Cold-start cards: continue, library, today's tide, daily, local, proof tree. */
export function mountHome(root: HTMLElement, hooks: HomeHooks): {
  element: HTMLElement;
  setQueue: (snapshot: PlaybackSnapshot) => void;
  setSession: (session: SessionSnapshot | null) => void;
  setDiscover: (count: number, note: string) => void;
  setLocal: (hits: SearchHit[]) => void;
} {
  const grid = document.createElement("section");
  grid.className = "home-grid";
  grid.setAttribute("aria-label", "主页");

  const continueCard = card("继续播放", "当前没有在播的曲目", () => openNowPlaying(), "continue");
  const cover = document.createElement("span");
  cover.className = "home-cover";
  paintCover(cover, undefined);
  continueCard.prepend(cover);

  const libraryCard = card("歌单", "云端歌单在登录后出现", hooks.onPlaylists, "library");
  const tideCard = card("今日潮汐", "按听过的歌找相似的", hooks.onTide, "tide");
  const tideCover=document.createElement("img");tideCover.src="./assets/today-tide.png";tideCover.alt="";tideCover.className="home-tide-art";tideCover.decoding="async";tideCard.prepend(tideCover);
  const dailyCard = card("每日推荐", "登录后解锁", hooks.onDaily, "daily");
  const localCard = card("本地音乐", "不登录也能播", hooks.onLocal, "local");
  const proofCard = card("音乐脉络", "播放列表 → 歌手 → 专辑 → 单曲", hooks.onProof, "proof");

  grid.append(continueCard, libraryCard, tideCard, dailyCard, localCard, proofCard);
  root.append(grid);

  const setBody = (host: HTMLElement, text: string) => {
    const body = host.querySelector(".home-body");
    if (body) body.textContent = text;
  };

  return {
    element: grid,
    setQueue(snapshot) {
      const track = snapshot.index >= 0 ? snapshot.queue[snapshot.index] : undefined;
      setBody(continueCard, track ? `${track.title} · ${track.artist}` : "当前没有在播的曲目");
      if (cover.dataset.cover !== (track?.cover ?? "")) {
        cover.dataset.cover = track?.cover ?? "";
        paintCover(cover, track?.cover);
      }
    },
    setSession(session) {
      const signedIn = session?.state === "logged_in";
      setBody(libraryCard, signedIn ? `${session?.playlists.length ?? 0} 个歌单` : "云端歌单在登录后出现");
      setBody(dailyCard, signedIn ? "打开今天的推荐" : "登录后解锁");
    },
    setDiscover(count, note) {
      setBody(tideCard, count > 0 ? (note || `${count} 首`) : (note || "按听过的歌找相似的"));
    },
    setLocal(hits) {
      setBody(localCard, hits.length === 0 ? "不登录也能播" : `${hits.length} 首在这台机器上`);
    },
  };

  function card(title: string, body: string, onClick: () => void, glyph: string): HTMLElement {
    const element = document.createElement("article");
    element.className = "home-card";
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.append(icon(glyph));
    const heading = document.createElement("h2");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.className = "home-body";
    copy.textContent = body;
    element.append(heading, copy);
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    });
    return element;
  }
}

function icon(kind: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("class", "home-glyph");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  const paths: Record<string, string> = {
    continue: "M6 22c3-7 6-7 9 0s6 7 9 0",
    library: "M8 8h12v16H8zM12 8v16",
    tide: "M5 20c3-6 6-6 9 0s6 6 9 0M5 14c3-6 6-6 9 0s6 6 9 0",
    daily: "M16 7v3M16 22v3M7 16h3M22 16h3M9 9l2 2M21 21l2 2M23 9l-2 2M11 21l-2 2",
    local: "M8 22V10l14-3v15",
    proof: "M16 24 V16 M16 16 L8 10 M16 16 L24 10 M8 10 V6 M24 10 V6",
  };
  path.setAttribute("d", paths[kind] ?? paths.tide ?? "");
  svg.append(path);
  return svg;
}
